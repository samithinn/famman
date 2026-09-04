"use client";

import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";

interface TeachingTask {
  id: string;
  course_id: string;
  week_number: number;
  title: string;
  is_completed: boolean;
}

interface TeachingCourse {
  id: string;
  semester_id: string;
  code: string;
  title: string;
  color_theme: string;
  teaching_tasks: TeachingTask[];
}

interface TeachingSemester {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

type ViewMode = "week" | "matrix" | "semesters";

const TOTAL_WEEKS = 15;
const PALETTE = ["#8B5CF6", "#3B82F6", "#10B981", "#F0623D", "#EAB308", "#EC4899"];
const FONT = "var(--font-app), sans-serif";

function tint(hex: string) {
  return hex + "22";
}

function coursePercent(course: TeachingCourse, week: number) {
  const tasks = course.teaching_tasks.filter(t => t.week_number === week);
  if (!tasks.length) return 0;
  return Math.round((tasks.filter(t => t.is_completed).length / tasks.length) * 100);
}

function weekTotalPercent(courses: TeachingCourse[], week: number) {
  let done = 0, total = 0;
  courses.forEach(c => {
    const tasks = c.teaching_tasks.filter(t => t.week_number === week);
    total += tasks.length;
    done += tasks.filter(t => t.is_completed).length;
  });
  return total ? Math.round((done / total) * 100) : 0;
}

const cardStyle: React.CSSProperties = {
  background: "white",
  borderRadius: 16,
  boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
};

const inputStyle: React.CSSProperties = {
  fontFamily: FONT,
  border: "1px solid #EDEBE6",
  borderRadius: 9,
  padding: "9px 12px",
  fontSize: 13,
  width: "100%",
};

export default function TeachingChecklistView() {
  const [view, setView] = useState<ViewMode>("week");
  const [semesters, setSemesters] = useState<TeachingSemester[]>([]);
  const [matrixCache, setMatrixCache] = useState<Record<string, TeachingCourse[]>>({});
  const [currentWeek, setCurrentWeek] = useState(1);
  const [expandedSemesterId, setExpandedSemesterId] = useState<string | null>(null);
  const [newTaskInputs, setNewTaskInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [semesterModalOpen, setSemesterModalOpen] = useState(false);
  const [semesterNameInput, setSemesterNameInput] = useState("");
  const [courseModalSemesterId, setCourseModalSemesterId] = useState<string | null>(null);
  const [courseCodeInput, setCourseCodeInput] = useState("");
  const [courseTitleInput, setCourseTitleInput] = useState("");
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const activeSemester = semesters.find(s => s.is_active) ?? null;
  const activeCourses = activeSemester ? matrixCache[activeSemester.id] ?? [] : [];

  const fetchMatrix = useCallback(async (semesterId: string) => {
    const res = await fetch(`/api/teaching/matrix?semesterId=${semesterId}`);
    if (!res.ok) return;
    const json = await res.json();
    setMatrixCache(prev => ({ ...prev, [semesterId]: json.courses ?? [] }));
  }, []);

  const fetchSemesters = useCallback(async () => {
    const res = await fetch("/api/teaching/semesters");
    if (!res.ok) {
      setError("Failed to load semesters");
      return [];
    }
    const json = await res.json();
    const list: TeachingSemester[] = json.semesters ?? [];
    setSemesters(list);
    return list;
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const sems = await fetchSemesters();
      const active = sems.find(s => s.is_active);
      if (active) await fetchMatrix(active.id);
      setLoading(false);
    })();
  }, [fetchSemesters, fetchMatrix]);

  const toggleTask = (semesterId: string, task: TeachingTask) => {
    const nextDone = !task.is_completed;
    const applyDone = (done: boolean) =>
      setMatrixCache(prev => ({
        ...prev,
        [semesterId]: (prev[semesterId] ?? []).map(c =>
          c.id !== task.course_id
            ? c
            : { ...c, teaching_tasks: c.teaching_tasks.map(t => (t.id === task.id ? { ...t, is_completed: done } : t)) }
        ),
      }));

    applyDone(nextDone);
    fetch(`/api/teaching/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_completed: nextDone }),
    }).then(res => {
      if (!res.ok) applyDone(task.is_completed);
    });
  };

  const addTaskKey = (courseId: string, week: number) => `${courseId}_${week}`;

  const submitAddTask = async (semesterId: string, courseId: string, week: number) => {
    const key = addTaskKey(courseId, week);
    const title = (newTaskInputs[key] || "").trim();
    if (!title) return;
    setNewTaskInputs(prev => ({ ...prev, [key]: "" }));

    const res = await fetch("/api/teaching/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ course_id: courseId, week_number: week, title }),
    });
    if (!res.ok) return;
    const json = await res.json();
    setMatrixCache(prev => ({
      ...prev,
      [semesterId]: (prev[semesterId] ?? []).map(c =>
        c.id === courseId ? { ...c, teaching_tasks: [...c.teaching_tasks, json.task] } : c
      ),
    }));
  };

  const openAddCourse = (semesterId: string) => {
    setCourseModalSemesterId(semesterId);
    setCourseCodeInput("");
    setCourseTitleInput("");
  };

  const submitAddCourse = async () => {
    if (!courseModalSemesterId) return;
    const code = courseCodeInput.trim();
    const title = courseTitleInput.trim();
    if (!code || !title) return;
    const semesterId = courseModalSemesterId;

    const res = await fetch("/api/teaching/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ semester_id: semesterId, code, title }),
    });
    if (!res.ok) return;
    const json = await res.json();
    setMatrixCache(prev => ({ ...prev, [semesterId]: [...(prev[semesterId] ?? []), json.course] }));
    setCourseModalSemesterId(null);
  };

  const removeCourse = (semesterId: string, courseId: string) => {
    setConfirmState({
      message: "Delete this course and all its weekly tasks? This cannot be undone.",
      onConfirm: async () => {
        setConfirmState(null);
        setMatrixCache(prev => ({ ...prev, [semesterId]: (prev[semesterId] ?? []).filter(c => c.id !== courseId) }));
        await fetch(`/api/teaching/courses/${courseId}`, { method: "DELETE" });
      },
    });
  };

  const submitAddSemester = async () => {
    const name = semesterNameInput.trim();
    if (!name) return;

    const res = await fetch("/api/teaching/semesters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return;
    const json = await res.json();
    const newSemester: TeachingSemester = json.semester;
    setSemesters(prev => [newSemester, ...prev.map(s => (newSemester.is_active ? { ...s, is_active: false } : s))]);
    setSemesterModalOpen(false);
    setSemesterNameInput("");
    if (newSemester.is_active) {
      await fetchMatrix(newSemester.id);
      setCurrentWeek(1);
    }
  };

  const setActiveSemester = async (semesterId: string) => {
    if (activeSemester?.id === semesterId) return;
    setSemesters(prev => prev.map(s => ({ ...s, is_active: s.id === semesterId })));
    if (!matrixCache[semesterId]) await fetchMatrix(semesterId);
    await fetch(`/api/teaching/semesters/${semesterId}/active`, { method: "PUT" });
  };

  const removeSemester = (semesterId: string) => {
    setConfirmState({
      message: "Delete this semester, its courses, and all weekly tasks? This cannot be undone.",
      onConfirm: async () => {
        setConfirmState(null);
        const res = await fetch(`/api/teaching/semesters/${semesterId}`, { method: "DELETE" });
        if (!res.ok) return;
        const sems = await fetchSemesters();
        const active = sems.find(s => s.is_active);
        if (active && !matrixCache[active.id]) await fetchMatrix(active.id);
      },
    });
  };

  const toggleExpandSemester = (semesterId: string) => {
    setExpandedSemesterId(prev => (prev === semesterId ? null : semesterId));
    if (!matrixCache[semesterId]) fetchMatrix(semesterId);
  };

  const jumpToWeek = (week: number) => {
    setCurrentWeek(week);
    setView("week");
  };

  const navBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "9px 16px",
    borderRadius: 8,
    fontSize: 13.5,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
    border: active ? "1px solid #1A2033" : "1px solid transparent",
    background: active ? "white" : "transparent",
    color: active ? "#1A2033" : "#8A8F9C",
    fontFamily: FONT,
  });

  if (loading) {
    return <div style={{ padding: 40, color: "#8A8F9C", fontFamily: FONT }}>Loading…</div>;
  }

  return (
    <div style={{ minHeight: "100%", overflow: "auto", padding: "24px 32px 60px 32px", color: "#1A2033", fontFamily: FONT }}>
      {/* Top Nav */}
      <div
        style={{
          position: "sticky", top: 12, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "white", borderRadius: 16, boxShadow: "0 2px 10px rgba(0,0,0,0.06)", padding: "14px 20px",
          marginBottom: 20, flexWrap: "wrap", gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 11, background: "#F0623D", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ width: 18, height: 2.5, background: "white", borderRadius: 2 }} />
              <div style={{ width: 18, height: 2.5, background: "white", borderRadius: 2 }} />
              <div style={{ width: 12, height: 2.5, background: "white", borderRadius: 2 }} />
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>Teaching Weekly Checklist</div>
            <div style={{ fontSize: 12, color: "#8A8F9C" }}>15-Week Course Prep Matrix &amp; Weekly Tracker</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", background: "#FAF9F6", borderRadius: 11, padding: 4, gap: 2 }}>
            <button onClick={() => setView("week")} style={navBtnStyle(view === "week")}>This Week</button>
            <button onClick={() => setView("matrix")} style={navBtnStyle(view === "matrix")}>Master Matrix</button>
            <button onClick={() => setView("semesters")} style={navBtnStyle(view === "semesters")}>Semesters</button>
          </div>
          <button
            onClick={() => setSemesterModalOpen(true)}
            style={{ background: "#F0623D", color: "white", border: "none", padding: "10px 16px", borderRadius: 10, fontWeight: 600, fontSize: 13.5, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, fontFamily: FONT }}
          >
            + New Semester
          </button>
        </div>
      </div>

      {error && <div style={{ ...cardStyle, padding: 16, marginBottom: 16, color: "#D94F2C" }}>{error}</div>}

      {!activeSemester ? (
        <div style={{ ...cardStyle, padding: 40, textAlign: "center", color: "#8A8F9C" }}>
          No semester yet — click <strong>+ New Semester</strong> to get started.
        </div>
      ) : (
        <>
          {/* Semester banner */}
          <div style={{ ...cardStyle, padding: "18px 22px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 4, height: 34, background: "#F0623D", borderRadius: 3 }} />
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#F0623D" }}>ACTIVE TEACHING PERIOD</span>
                  <span style={{ fontSize: 11, fontWeight: 700, background: "#E4F6EC", color: "#1E9E5A", padding: "2px 9px", borderRadius: 20 }}>Current</span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{activeSemester.name}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => openAddCourse(activeSemester.id)}
                style={{ background: "#141C2E", color: "white", border: "none", padding: "10px 16px", borderRadius: 10, fontWeight: 600, fontSize: 13.5, cursor: "pointer", fontFamily: FONT }}
              >
                + Add Course
              </button>
              <select
                value={activeSemester.id}
                onChange={e => setActiveSemester(e.target.value)}
                style={{ border: "1px solid #EDEBE6", background: "#FAF9F6", padding: "10px 14px", borderRadius: 10, fontSize: 13.5, fontWeight: 600, color: "#1A2033", fontFamily: FONT }}
              >
                {semesters.map(sem => (
                  <option key={sem.id} value={sem.id}>{sem.name}{sem.is_active ? " (Current)" : ""}</option>
                ))}
              </select>
            </div>
          </div>

          {view === "week" && (
            <WeekView
              activeSemester={activeSemester}
              activeCourses={activeCourses}
              currentWeek={currentWeek}
              setCurrentWeek={setCurrentWeek}
              newTaskInputs={newTaskInputs}
              setNewTaskInputs={setNewTaskInputs}
              addTaskKey={addTaskKey}
              submitAddTask={submitAddTask}
              toggleTask={toggleTask}
            />
          )}

          {view === "matrix" && (
            <MatrixView
              activeSemester={activeSemester}
              activeCourses={activeCourses}
              currentWeek={currentWeek}
              jumpToWeek={jumpToWeek}
              newTaskInputs={newTaskInputs}
              setNewTaskInputs={setNewTaskInputs}
              addTaskKey={addTaskKey}
              submitAddTask={submitAddTask}
              toggleTask={toggleTask}
              openAddCourse={openAddCourse}
              removeCourse={removeCourse}
            />
          )}

          {view === "semesters" && (
            <SemestersView
              semesters={semesters}
              matrixCache={matrixCache}
              expandedSemesterId={expandedSemesterId}
              toggleExpandSemester={toggleExpandSemester}
              setActiveSemester={setActiveSemester}
              removeSemester={removeSemester}
              openAddCourse={openAddCourse}
              onNewSemester={() => setSemesterModalOpen(true)}
            />
          )}
        </>
      )}

      {/* New Semester modal */}
      {semesterModalOpen && (
        <ModalOverlay onClose={() => setSemesterModalOpen(false)}>
          <div style={{ fontWeight: 800, fontSize: 17.5, marginBottom: 14 }}>New Semester</div>
          <input
            autoFocus
            type="text"
            placeholder="e.g. Semester 1 / 2027"
            value={semesterNameInput}
            onChange={e => setSemesterNameInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") submitAddSemester(); }}
            style={{ ...inputStyle, marginBottom: 16 }}
          />
          <ModalActions onCancel={() => setSemesterModalOpen(false)} onConfirm={submitAddSemester} confirmLabel="Create" />
        </ModalOverlay>
      )}

      {/* Add Course modal */}
      {courseModalSemesterId && (
        <ModalOverlay onClose={() => setCourseModalSemesterId(null)}>
          <div style={{ fontWeight: 800, fontSize: 17.5, marginBottom: 14 }}>Add Course</div>
          <input
            autoFocus
            type="text"
            placeholder="Course code (e.g. EL101)"
            value={courseCodeInput}
            onChange={e => setCourseCodeInput(e.target.value)}
            style={{ ...inputStyle, marginBottom: 10 }}
          />
          <input
            type="text"
            placeholder="Course title (e.g. Academic English)"
            value={courseTitleInput}
            onChange={e => setCourseTitleInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") submitAddCourse(); }}
            style={{ ...inputStyle, marginBottom: 16 }}
          />
          <ModalActions onCancel={() => setCourseModalSemesterId(null)} onConfirm={submitAddCourse} confirmLabel="Add" />
        </ModalOverlay>
      )}

      <ConfirmDialog
        open={!!confirmState}
        message={confirmState?.message ?? ""}
        onConfirm={() => confirmState?.onConfirm()}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(26,32,51,0.32)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16 }}
    >
      <div onClick={e => e.stopPropagation()} style={{ background: "#FAF9F6", borderRadius: 20, padding: 24, width: 360, maxWidth: "100%", boxShadow: "0 24px 60px rgba(0,0,0,0.18)", fontFamily: FONT }}>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ onCancel, onConfirm, confirmLabel }: { onCancel: () => void; onConfirm: () => void; confirmLabel: string }) {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <button onClick={onCancel} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "1px solid #EDEBE6", background: "white", color: "#5B616E", fontFamily: FONT, fontWeight: 600, fontSize: 13.5, cursor: "pointer" }}>
        Cancel
      </button>
      <button onClick={onConfirm} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "none", background: "#F0623D", color: "white", fontFamily: FONT, fontWeight: 600, fontSize: 13.5, cursor: "pointer" }}>
        {confirmLabel}
      </button>
    </div>
  );
}

function WeekView({
  activeSemester, activeCourses, currentWeek, setCurrentWeek, newTaskInputs, setNewTaskInputs, addTaskKey, submitAddTask, toggleTask,
}: {
  activeSemester: TeachingSemester;
  activeCourses: TeachingCourse[];
  currentWeek: number;
  setCurrentWeek: React.Dispatch<React.SetStateAction<number>>;
  newTaskInputs: Record<string, string>;
  setNewTaskInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  addTaskKey: (courseId: string, week: number) => string;
  submitAddTask: (semesterId: string, courseId: string, week: number) => void;
  toggleTask: (semesterId: string, task: TeachingTask) => void;
}) {
  const weekTotalPct = weekTotalPercent(activeCourses, currentWeek);
  return (
    <div>
      <div style={{ ...cardStyle, padding: 22, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginBottom: 20 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#1E9E5A" }} />
              <span style={{ fontSize: 13, color: "#5B616E", fontWeight: 600 }}>Day-to-Day Teaching Checklist</span>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "0.01em" }}>THIS WEEK — Week {currentWeek}</div>
            <div style={{ fontSize: 13.5, color: "#8A8F9C", marginTop: 4 }}>Check off preparation items per course for this week.</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#FAF9F6", borderRadius: 10, padding: "8px 12px" }}>
            <button onClick={() => setCurrentWeek(w => Math.max(1, w - 1))} style={{ border: "none", background: "none", fontSize: 16, cursor: "pointer", color: "#4A4F5C" }}>‹</button>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Week {currentWeek}</span>
            <button onClick={() => setCurrentWeek(w => Math.min(TOTAL_WEEKS, w + 1))} style={{ border: "none", background: "none", fontSize: 16, cursor: "pointer", color: "#4A4F5C" }}>›</button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "#5B616E" }}>Week {currentWeek} Total Preparation</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#F0623D" }}>{weekTotalPct}% Completed</span>
        </div>
        <div style={{ height: 9, borderRadius: 6, background: "#EFEDE8", overflow: "hidden" }}>
          <div style={{ height: "100%", borderRadius: 6, width: `${weekTotalPct}%`, background: "linear-gradient(90deg,#F0623D,#F5B942,#3FBE7A)" }} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        {activeCourses.map(course => {
          const tasks = course.teaching_tasks.filter(t => t.week_number === currentWeek);
          const pct = coursePercent(course, currentWeek);
          const key = addTaskKey(course.id, currentWeek);
          return (
            <div key={course.id} style={{ ...cardStyle, flex: 1, minWidth: 300, overflow: "hidden" }}>
              <div style={{ height: 5, background: course.color_theme }} />
              <div style={{ padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 9, height: 9, borderRadius: "50%", background: course.color_theme }} />
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{course.code}</div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: tint(course.color_theme), color: course.color_theme }}>{pct}%</div>
                </div>
                <div style={{ fontSize: 13, color: "#8A8F9C", marginBottom: 16, marginLeft: 17 }}>{course.title}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 11, marginBottom: 18, minHeight: 20 }}>
                  {tasks.map(task => (
                    <label key={task.id} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <input type="checkbox" checked={task.is_completed} onChange={() => toggleTask(activeSemester.id, task)} />
                      <span style={task.is_completed ? { color: "#B7BAC2", textDecoration: "line-through" } : { color: "#1A2033" }}>{task.title}</span>
                    </label>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    placeholder="+ Add task (e.g. Prepare Quiz)"
                    value={newTaskInputs[key] || ""}
                    onChange={e => setNewTaskInputs(prev => ({ ...prev, [key]: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter") submitAddTask(activeSemester.id, course.id, currentWeek); }}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    onClick={() => submitAddTask(activeSemester.id, course.id, currentWeek)}
                    style={{ background: "#EFEDE8", color: "#5B616E", border: "none", padding: "9px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MatrixView({
  activeSemester, activeCourses, currentWeek, jumpToWeek, newTaskInputs, setNewTaskInputs, addTaskKey, submitAddTask, toggleTask, openAddCourse, removeCourse,
}: {
  activeSemester: TeachingSemester;
  activeCourses: TeachingCourse[];
  currentWeek: number;
  jumpToWeek: (week: number) => void;
  newTaskInputs: Record<string, string>;
  setNewTaskInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  addTaskKey: (courseId: string, week: number) => string;
  submitAddTask: (semesterId: string, courseId: string, week: number) => void;
  toggleTask: (semesterId: string, task: TeachingTask) => void;
  openAddCourse: (semesterId: string) => void;
  removeCourse: (semesterId: string, courseId: string) => void;
}) {
  const courseCount = activeCourses.length;
  return (
    <div>
      <div style={{ ...cardStyle, padding: "20px 22px", marginBottom: 18, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>Master Teaching Matrix — {activeSemester.name}</div>
          <div style={{ fontSize: 13.5, color: "#8A8F9C" }}>Columns are courses, rows are Weeks 1 through 15. Check off, add, or replicate tasks.</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => openAddCourse(activeSemester.id)}
            style={{ background: "#F0623D", color: "white", border: "none", padding: "10px 16px", borderRadius: 10, fontWeight: 600, fontSize: 13.5, cursor: "pointer", whiteSpace: "nowrap", fontFamily: FONT }}
          >
            + Add Course Column
          </button>
        </div>
      </div>

      <div style={{ ...cardStyle, overflow: "auto" }}>
        <div style={{ minWidth: 170 + courseCount * 220 }}>
          <div style={{ display: "grid", gridTemplateColumns: `170px repeat(${Math.max(courseCount, 1)}, 1fr)`, background: "#141C2E" }}>
            <div style={{ padding: "16px 18px", color: "#8DA0C4", fontSize: 12, fontWeight: 700, letterSpacing: "0.06em" }}>WEEK</div>
            {activeCourses.map(course => (
              <div key={course.id} style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: course.color_theme }} />
                    <span style={{ color: "white", fontWeight: 700, fontSize: 14 }}>{course.code}</span>
                  </div>
                  <div style={{ color: "#8DA0C4", fontSize: 11, marginLeft: 15, marginTop: 2 }}>{course.title}</div>
                </div>
                <span onClick={() => removeCourse(activeSemester.id, course.id)} style={{ color: "#5A6A8A", cursor: "pointer", fontSize: 13 }}>🗑</span>
              </div>
            ))}
          </div>

          {Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1).map(week => {
            const isCurrent = week === currentWeek;
            const pct = weekTotalPercent(activeCourses, week);
            return (
              <div key={week} style={{ display: "grid", gridTemplateColumns: `170px repeat(${Math.max(courseCount, 1)}, 1fr)`, borderTop: "1px solid #F1EFEA", background: isCurrent ? "#FEF6E7" : "white" }}>
                <div style={{ padding: "16px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>Week {week}</span>
                    {isCurrent ? (
                      <span style={{ fontSize: 10, fontWeight: 700, background: "#F0623D", color: "white", padding: "2px 7px", borderRadius: 20 }}>CURRENT</span>
                    ) : (
                      <button onClick={() => jumpToWeek(week)} style={{ fontSize: 11, fontWeight: 600, background: "#FAF9F6", border: "1px solid #EDEBE6", borderRadius: 20, padding: "2px 10px", cursor: "pointer", fontFamily: FONT }}>Jump</button>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "#8A8F9C", marginTop: 3 }}>{pct}% done</div>
                </div>
                {activeCourses.map(course => {
                  const tasks = course.teaching_tasks.filter(t => t.week_number === week);
                  const key = addTaskKey(course.id, week);
                  return (
                    <div key={course.id} style={{ padding: "14px 18px", borderLeft: "1px solid #F1EFEA" }}>
                      {tasks.map(task => (
                        <label key={task.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 6 }}>
                          <input type="checkbox" checked={task.is_completed} onChange={() => toggleTask(activeSemester.id, task)} />
                          <span style={task.is_completed ? { color: "#B7BAC2", textDecoration: "line-through", fontSize: 13 } : { color: "#1A2033", fontSize: 13 }}>{task.title}</span>
                        </label>
                      ))}
                      <input
                        type="text"
                        placeholder="+ task"
                        value={newTaskInputs[key] || ""}
                        onChange={e => setNewTaskInputs(prev => ({ ...prev, [key]: e.target.value }))}
                        onKeyDown={e => { if (e.key === "Enter") submitAddTask(activeSemester.id, course.id, week); }}
                        style={{ fontFamily: FONT, border: "none", background: "none", fontSize: 12.5, color: "#8A8F9C", width: "100%", padding: "2px 0" }}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SemestersView({
  semesters, matrixCache, expandedSemesterId, toggleExpandSemester, setActiveSemester, removeSemester, openAddCourse, onNewSemester,
}: {
  semesters: TeachingSemester[];
  matrixCache: Record<string, TeachingCourse[]>;
  expandedSemesterId: string | null;
  toggleExpandSemester: (id: string) => void;
  setActiveSemester: (id: string) => void;
  removeSemester: (id: string) => void;
  openAddCourse: (semesterId: string) => void;
  onNewSemester: () => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>Semester Archive</div>
          <div style={{ fontSize: 13.5, color: "#8A8F9C", marginTop: 3 }}>Expand past or upcoming semesters to review records or switch active view.</div>
        </div>
        <button onClick={onNewSemester} style={{ background: "#F0623D", color: "white", border: "none", padding: "10px 18px", borderRadius: 10, fontWeight: 600, fontSize: 13.5, cursor: "pointer", fontFamily: FONT }}>
          + New Semester
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {semesters.map(sem => {
          const expanded = expandedSemesterId === sem.id;
          const courses = matrixCache[sem.id] ?? [];
          return (
            <div key={sem.id} style={{ borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
              <div style={{ background: "#141C2E", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div onClick={() => toggleExpandSemester(sem.id)} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
                  <span style={{ color: "#8DA0C4", fontSize: 14, width: 16, display: "inline-block" }}>{expanded ? "⌄" : "›"}</span>
                  <span style={{ color: "white", fontWeight: 700, fontSize: 15 }}>{sem.name}</span>
                  {sem.is_active && (
                    <span style={{ fontSize: 10.5, fontWeight: 700, background: "#F0623D", color: "white", padding: "3px 10px", borderRadius: 20 }}>CURRENT</span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {!sem.is_active && (
                    <button onClick={() => setActiveSemester(sem.id)} style={{ background: "#F0623D", color: "white", border: "none", padding: "7px 16px", borderRadius: 20, fontWeight: 600, fontSize: 12.5, cursor: "pointer", fontFamily: FONT }}>
                      Set Active
                    </button>
                  )}
                  <span onClick={() => removeSemester(sem.id)} style={{ color: "#5A6A8A", cursor: "pointer", fontSize: 14 }}>🗑</span>
                </div>
              </div>

              {expanded && (
                <div style={{ background: "white", padding: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, color: "#5B616E", fontWeight: 600 }}>Courses:</span>
                    {courses.map(c => (
                      <span key={c.id} style={{ display: "flex", alignItems: "center", gap: 6, background: "#FAF9F6", border: "1px solid #EDEBE6", padding: "5px 12px", borderRadius: 20, fontSize: 12.5, fontWeight: 600 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: c.color_theme }} />{c.code}
                      </span>
                    ))}
                    <span onClick={() => openAddCourse(sem.id)} style={{ fontSize: 13, fontWeight: 600, color: "#F0623D", cursor: "pointer" }}>+ Add Course</span>
                  </div>

                  <div style={{ background: "#FAF9F6", borderRadius: 14, padding: 18 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "#8A8F9C", marginBottom: 14 }}>15-WEEK COMPLETION OVERVIEW</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
                      {Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1).map(week => {
                        const pct = weekTotalPercent(courses, week);
                        return (
                          <div key={week} style={{ background: "white", border: "1px solid #EDEBE6", borderRadius: 10, padding: "12px 14px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 700 }}>Week {week}</span>
                              <span style={{ fontSize: 12, fontWeight: 700, color: "#F0623D" }}>{pct}%</span>
                            </div>
                            <div style={{ height: 5, background: "#EFEDE8", borderRadius: 4, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${pct}%`, background: "#F0623D", borderRadius: 4 }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
