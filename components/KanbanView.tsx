"use client";

import { useEffect, useState } from "react";

// Ported from the Claude Design prototype "Kanban Board.dc.html"
// (project 9c8419c7-c45f-4aed-8d6a-b5fbc85f32e7) — same layout, colors and
// drag-and-drop interaction, wired to real data instead of mock projects.

const ACCENT_COLOR = "#6C5CE7";
const DENSITY: "cozy" | "compact" = "cozy";
const SHOW_DESCRIPTION_ON_CARD = true;

const PALETTE = ["#FFD9E8", "#FFE3C2", "#FFF3B0", "#C8F0DA", "#CBEBFF", "#E3D9FF"];
const PROJECT_HEADER_COLORS = ["#FFD9E8", "#CBEBFF", "#C8F0DA", "#FFE3C2", "#E3D9FF", "#FFF3B0"];

const PRIORITY_META: Record<string, { bg: string; fg: string; accent: string }> = {
  High: { bg: "#FFDCD3", fg: "#C0392B", accent: "#E8574C" },
  Medium: { bg: "#FFF0C2", fg: "#A9790A", accent: "#E8A23D" },
  Low: { bg: "#DCF3E4", fg: "#2F9E63", accent: "transparent" },
};

const COLUMNS: { id: string; label: string }[] = [
  { id: "To do", label: "To do" },
  { id: "In Progress", label: "In Progress" },
  { id: "Done", label: "Done" },
];

type KanbanTask = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: "High" | "Medium" | "Low";
  status: string;
  color: string | null;
  position: number;
  created_at: string;
};

type KanbanProject = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  position: number;
  created_at: string;
  kanban_tasks: KanbanTask[];
};

type ModalState =
  | { open: false }
  | {
      open: true;
      mode: "create" | "edit";
      projectId: string;
      columnId: string;
      taskId: string | null;
    };

type ModalForm = {
  title: string;
  dueDate: string;
  description: string;
  priority: "High" | "Medium" | "Low";
  color: string;
};

function formatDate(iso: string | null): string {
  if (!iso) return "No date";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysLeftLabel(iso: string | null): string {
  if (!iso) return "";
  const due = new Date(iso + "T00:00:00");
  if (isNaN(due.getTime())) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return "Overdue";
  if (diff === 0) return "Due today";
  if (diff === 1) return "1 day left";
  return `${diff} days left`;
}

function priorityLabel(priority: string): string {
  return priority === "High" ? "High 🔥" : priority;
}

function colorIndexForId(id: string, mod: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % mod;
}

function isUrgent(iso: string | null): boolean {
  if (!iso) return false;
  const due = new Date(iso + "T00:00:00");
  if (isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  return diff <= 1;
}

const EMPTY_FORM: ModalForm = { title: "", dueDate: "", description: "", priority: "Medium", color: PALETTE[0] };

export default function KanbanView() {
  const [projects, setProjects] = useState<KanbanProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [projectDragOverId, setProjectDragOverId] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalState>({ open: false });
  const [modalForm, setModalForm] = useState<ModalForm>(EMPTY_FORM);

  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [newProjectColor, setNewProjectColor] = useState(PROJECT_HEADER_COLORS[0]);
  const [savingProject, setSavingProject] = useState(false);

  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editProjectName, setEditProjectName] = useState("");
  const [editProjectDescription, setEditProjectDescription] = useState("");
  const [editProjectColor, setEditProjectColor] = useState(PROJECT_HEADER_COLORS[0]);
  const [savingProjectEdit, setSavingProjectEdit] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    setLoading(true);
    setError("");
    const res = await fetch("/api/kanban");
    if (!res.ok) {
      setError("Failed to load Kanban boards.");
      setLoading(false);
      return;
    }
    const { projects: list } = await res.json();
    setProjects(list ?? []);
    setLoading(false);
  }

  async function createProject() {
    const name = newProjectName.trim();
    if (!name) return;
    setSavingProject(true);
    const res = await fetch("/api/kanban/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: newProjectDescription.trim(), color: newProjectColor }),
    });
    setSavingProject(false);
    if (!res.ok) {
      setError("Failed to create project.");
      return;
    }
    const { project } = await res.json();
    setProjects(prev => [...prev, project]);
    setNewProjectName("");
    setNewProjectDescription("");
    setNewProjectColor(PROJECT_HEADER_COLORS[0]);
    setAddProjectOpen(false);
  }

  function startEditProject(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const projectId = e.currentTarget.getAttribute("data-project-id")!;
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    setEditingProjectId(projectId);
    setEditProjectName(project.name);
    setEditProjectDescription(project.description ?? "");
    setEditProjectColor(project.color ?? PROJECT_HEADER_COLORS[colorIndexForId(project.id, PROJECT_HEADER_COLORS.length)]);
  }

  function cancelEditProject() {
    setEditingProjectId(null);
  }

  async function saveProjectEdit() {
    if (!editingProjectId) return;
    const name = editProjectName.trim();
    if (!name) return;
    setSavingProjectEdit(true);
    const res = await fetch("/api/kanban/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editingProjectId, name, description: editProjectDescription.trim(), color: editProjectColor }),
    });
    setSavingProjectEdit(false);
    if (!res.ok) {
      setError("Failed to update project.");
      return;
    }
    const { project } = await res.json();
    setProjects(prev =>
      prev.map(p => (p.id === project.id ? { ...p, name: project.name, description: project.description, color: project.color } : p))
    );
    setEditingProjectId(null);
  }

  async function deleteProject(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const projectId = e.currentTarget.getAttribute("data-project-id")!;
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    if (!window.confirm(`Delete project "${project.name}"? This will also delete all its tasks.`)) return;

    setProjects(prev => prev.filter(p => p.id !== projectId));
    const res = await fetch(`/api/kanban/projects/${projectId}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Failed to delete project.");
      loadProjects();
    }
  }

  function onAddTaskClick(e: React.MouseEvent<HTMLButtonElement>) {
    const projectId = e.currentTarget.getAttribute("data-project-id")!;
    const columnId = e.currentTarget.getAttribute("data-column-id")!;
    setModal({ open: true, mode: "create", projectId, columnId, taskId: null });
    setModalForm({ ...EMPTY_FORM, color: PALETTE[0] });
  }

  function onCardClick(e: React.MouseEvent<HTMLDivElement>) {
    const projectId = e.currentTarget.getAttribute("data-project-id")!;
    const taskId = e.currentTarget.getAttribute("data-task-id")!;
    const project = projects.find(p => p.id === projectId);
    const task = project?.kanban_tasks.find(t => t.id === taskId);
    if (!task) return;
    setModal({ open: true, mode: "edit", projectId, columnId: task.status, taskId: task.id });
    setModalForm({
      title: task.title,
      dueDate: task.due_date ?? "",
      description: task.description ?? "",
      priority: task.priority,
      color: task.color ?? PALETTE[0],
    });
  }

  async function deleteTask(projectId: string, taskId: string) {
    setProjects(prev =>
      prev.map(p => (p.id === projectId ? { ...p, kanban_tasks: p.kanban_tasks.filter(t => t.id !== taskId) } : p))
    );
    const res = await fetch(`/api/kanban/tasks/${taskId}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Failed to delete task.");
      loadProjects();
    }
  }

  function onDeleteCardClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const projectId = e.currentTarget.getAttribute("data-project-id")!;
    const taskId = e.currentTarget.getAttribute("data-task-id")!;
    deleteTask(projectId, taskId);
  }

  function closeModal() {
    setModal({ open: false });
  }

  function onFormChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    const key = name === "name" ? "title" : (name as keyof ModalForm);
    setModalForm(prev => ({ ...prev, [key]: value }));
  }

  function onColorSelect(e: React.MouseEvent<HTMLButtonElement>) {
    const color = e.currentTarget.getAttribute("data-color")!;
    setModalForm(prev => ({ ...prev, color }));
  }

  async function saveTask() {
    if (!modal.open) return;
    const form = modalForm;
    const title = form.title.trim() || "Untitled task";

    if (modal.mode === "edit" && modal.taskId) {
      const res = await fetch("/api/kanban/tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: modal.taskId,
          title,
          description: form.description,
          due_date: form.dueDate || null,
          priority: form.priority,
          color: form.color,
        }),
      });
      if (!res.ok) {
        setError("Failed to update task.");
        return;
      }
      const { task } = await res.json();
      setProjects(prev =>
        prev.map(p =>
          p.id === modal.projectId
            ? { ...p, kanban_tasks: p.kanban_tasks.map(t => (t.id === task.id ? task : t)) }
            : p
        )
      );
    } else {
      const project = projects.find(p => p.id === modal.projectId);
      const columnTasks = (project?.kanban_tasks ?? []).filter(t => t.status === modal.columnId);
      const position = columnTasks.length ? Math.max(...columnTasks.map(t => t.position)) + 1 : 0;

      const res = await fetch("/api/kanban/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: modal.projectId,
          title,
          description: form.description,
          due_date: form.dueDate || null,
          priority: form.priority,
          status: modal.columnId,
          color: form.color,
          position,
        }),
      });
      if (!res.ok) {
        setError("Failed to create task.");
        return;
      }
      const { task } = await res.json();
      setProjects(prev =>
        prev.map(p => (p.id === modal.projectId ? { ...p, kanban_tasks: [...p.kanban_tasks, task] } : p))
      );
    }
    setModal({ open: false });
  }

  function deleteTaskFromModal() {
    if (!modal.open || !modal.taskId) return;
    deleteTask(modal.projectId, modal.taskId);
    setModal({ open: false });
  }

  function onCardDragStart(e: React.DragEvent<HTMLDivElement>) {
    const projectId = e.currentTarget.getAttribute("data-project-id")!;
    const taskId = e.currentTarget.getAttribute("data-task-id")!;
    e.dataTransfer.setData("text/plain", JSON.stringify({ projectId, taskId }));
    e.dataTransfer.effectAllowed = "move";
  }

  function onColDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const key = e.currentTarget.getAttribute("data-project-id") + ":" + e.currentTarget.getAttribute("data-column-id");
    if (dragOverKey !== key) setDragOverKey(key);
  }

  function onColDragLeave() {
    setDragOverKey(null);
  }

  async function onColDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOverKey(null);
    const targetProjectId = e.currentTarget.getAttribute("data-project-id")!;
    const status = e.currentTarget.getAttribute("data-column-id")!;
    let payload: { projectId: string; taskId: string } | null = null;
    try {
      payload = JSON.parse(e.dataTransfer.getData("text/plain"));
    } catch {
      payload = null;
    }
    if (!payload || payload.projectId !== targetProjectId) return;

    const project = projects.find(p => p.id === targetProjectId);
    const task = project?.kanban_tasks.find(t => t.id === payload!.taskId);
    if (!task || task.status === status) return;

    const columnTasks = (project?.kanban_tasks ?? []).filter(t => t.status === status);
    const position = columnTasks.length ? Math.max(...columnTasks.map(t => t.position)) + 1 : 0;

    setProjects(prev =>
      prev.map(p =>
        p.id === targetProjectId
          ? { ...p, kanban_tasks: p.kanban_tasks.map(t => (t.id === task.id ? { ...t, status, position } : t)) }
          : p
      )
    );

    const res = await fetch("/api/kanban/tasks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id, status, position }),
    });
    if (!res.ok) {
      setError("Failed to move task.");
      loadProjects();
    }
  }

  function onProjectDragStart(e: React.DragEvent<HTMLDivElement>) {
    const projectId = e.currentTarget.getAttribute("data-project-id")!;
    e.dataTransfer.setData("application/x-kanban-project", projectId);
    e.dataTransfer.effectAllowed = "move";
    setDraggedProjectId(projectId);
  }

  function onProjectDragEnd() {
    setDraggedProjectId(null);
    setProjectDragOverId(null);
  }

  function onProjectDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes("application/x-kanban-project")) return;
    e.preventDefault();
    const projectId = e.currentTarget.getAttribute("data-project-id")!;
    if (projectDragOverId !== projectId) setProjectDragOverId(projectId);
  }

  function onProjectDragLeave() {
    setProjectDragOverId(null);
  }

  async function onProjectDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes("application/x-kanban-project")) return;
    e.preventDefault();
    setProjectDragOverId(null);
    const targetId = e.currentTarget.getAttribute("data-project-id")!;
    const draggedId = draggedProjectId;
    setDraggedProjectId(null);
    if (!draggedId || draggedId === targetId) return;

    const fromIdx = projects.findIndex(p => p.id === draggedId);
    const toIdx = projects.findIndex(p => p.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const reordered = [...projects];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setProjects(reordered);

    const res = await fetch("/api/kanban/projects", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: reordered.map(p => p.id) }),
    });
    if (!res.ok) {
      setError("Failed to reorder projects.");
      loadProjects();
    }
  }

  const cardPadding = DENSITY === "compact" ? "11px 12px" : "15px 16px";
  const cardGap = DENSITY === "compact" ? "8px" : "12px";
  const query = searchQuery.trim().toLowerCase();
  const modalMeta = PRIORITY_META[modalForm.priority] ?? PRIORITY_META.Medium;

  return (
    <div style={{ minHeight: "100%", width: "100%", background: "#FAF8FF", fontFamily: "'Nunito',sans-serif", color: "#2D2B3A", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 32px", borderBottom: "1px solid #ECE7FA", background: "#FFFFFF" }}>
        <div style={{ width: 36, height: 36, borderRadius: 11, background: ACCENT_COLOR, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 3px 8px rgba(108,92,231,0.35)" }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="4.5" height="16" rx="1.5" fill="#fff" fillOpacity="0.95" />
            <rect x="6.75" y="1" width="4.5" height="10" rx="1.5" fill="#fff" fillOpacity="0.75" />
            <rect x="12.5" y="1" width="4.5" height="13" rx="1.5" fill="#fff" fillOpacity="0.55" />
          </svg>
        </div>
        <span style={{ fontFamily: "'Baloo 2',sans-serif", fontWeight: 700, fontSize: 21 }}>
          <span style={{ color: "#2D2B3A" }}>FamMan</span>
          <span style={{ color: "#C7C0DC", margin: "0 7px", fontWeight: 800 }}>×</span>
          <span style={{ color: ACCENT_COLOR, letterSpacing: "0.03em" }}>KANBAN</span>
        </span>
      </div>

      {/* Filters toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 32px", borderBottom: "1px solid #F1EDFA", background: "#FEFDFF", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F7F5FC", borderRadius: 10, padding: "8px 12px", flex: "0 0 auto", width: 260 }}>
          <span style={{ color: "#B0A9C4", fontSize: 13 }}>⌕</span>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search tasks..."
            style={{ border: "none", background: "transparent", outline: "none", fontFamily: "'Nunito',sans-serif", fontSize: 13.5, color: "#332F45", width: "100%" }}
          />
        </div>
        <select
          value={priorityFilter}
          onChange={e => setPriorityFilter(e.target.value)}
          style={{ background: "#F7F5FC", border: "none", borderRadius: 10, padding: "8px 12px", fontFamily: "'Nunito',sans-serif", fontSize: 13, fontWeight: 700, color: "#5C5570", outline: "none", cursor: "pointer" }}
        >
          <option value="All">All priorities</option>
          <option value="High">High 🔥</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setAddProjectOpen(v => !v)}
          style={{ background: ACCENT_COLOR, border: "none", borderRadius: 10, padding: "9px 16px", color: "#fff", fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 13, cursor: "pointer" }}
        >
          + New Project
        </button>
      </div>

      {addProjectOpen && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 32px", borderBottom: "1px solid #F1EDFA", background: "#FBF9FF", flexWrap: "wrap" }}>
          <input
            value={newProjectName}
            onChange={e => setNewProjectName(e.target.value)}
            placeholder="Project name"
            style={{ padding: "9px 12px", borderRadius: 10, border: "1.5px solid #EAE5F7", fontFamily: "'Nunito',sans-serif", fontSize: 13.5, outline: "none", width: 220 }}
          />
          <input
            value={newProjectDescription}
            onChange={e => setNewProjectDescription(e.target.value)}
            placeholder="Description (optional)"
            style={{ padding: "9px 12px", borderRadius: 10, border: "1.5px solid #EAE5F7", fontFamily: "'Nunito',sans-serif", fontSize: 13.5, outline: "none", flex: 1, minWidth: 200 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            {PROJECT_HEADER_COLORS.map(hex => (
              <button
                key={hex}
                onClick={() => setNewProjectColor(hex)}
                style={{ width: 26, height: 26, borderRadius: "50%", background: hex, cursor: "pointer", border: `2.5px solid ${hex === newProjectColor ? ACCENT_COLOR : "#ffffff"}` }}
              />
            ))}
          </div>
          <button
            onClick={createProject}
            disabled={savingProject || !newProjectName.trim()}
            style={{ background: ACCENT_COLOR, border: "none", borderRadius: 10, padding: "9px 16px", color: "#fff", fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 13, cursor: "pointer", opacity: savingProject || !newProjectName.trim() ? 0.6 : 1 }}
          >
            Create
          </button>
          <button
            onClick={() => setAddProjectOpen(false)}
            style={{ background: "#F3F0FC", border: "none", borderRadius: 10, padding: "9px 16px", color: "#6C5CE7", fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 13, cursor: "pointer" }}
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <div style={{ padding: "10px 32px", color: "#C0392B", fontSize: 13, fontWeight: 700, background: "#FFF0EE" }}>{error}</div>
      )}

      {/* Swimlanes */}
      <div style={{ flex: 1, padding: 32, overflow: "auto", display: "flex", flexDirection: "column", gap: 44 }}>
        {loading ? (
          <div style={{ color: "#9A93AC", fontSize: 14 }}>Loading...</div>
        ) : projects.length === 0 ? (
          <div style={{ color: "#9A93AC", fontSize: 14 }}>No projects yet — click "+ New Project" to create your first Kanban board.</div>
        ) : (
          projects.map((project, pIdx) => {
            const allTasks = project.kanban_tasks;
            const cardBg = pIdx % 2 === 0 ? "#FFFFFF" : "#FBF9FF";
            const headerColor = project.color ?? PROJECT_HEADER_COLORS[colorIndexForId(project.id, PROJECT_HEADER_COLORS.length)];

            const isProjectDragOver = projectDragOverId === project.id && draggedProjectId !== project.id;

            return (
              <div
                key={project.id}
                data-project-id={project.id}
                onDragOver={onProjectDragOver}
                onDragLeave={onProjectDragLeave}
                onDrop={onProjectDrop}
                style={{ borderRadius: 20, outline: isProjectDragOver ? `2px dashed ${ACCENT_COLOR}` : "2px dashed transparent", outlineOffset: 4, opacity: draggedProjectId === project.id ? 0.5 : 1, transition: "opacity 0.15s" }}
              >
                <div style={{ background: cardBg, border: "1px solid #EFEAFA", borderRadius: 20, padding: "22px 22px 24px", boxShadow: "0 1px 3px rgba(45,43,58,0.04)" }}>
                  {/* Project header */}
                  <div
                    draggable={editingProjectId !== project.id}
                    data-project-id={project.id}
                    onDragStart={onProjectDragStart}
                    onDragEnd={onProjectDragEnd}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, gap: 16, flexWrap: "wrap", cursor: editingProjectId === project.id ? "default" : "grab" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 220 }}>
                      <span style={{ color: "#C7C0DC", fontSize: 15, lineHeight: 1, userSelect: "none" }}>⠿</span>
                      <div style={{ width: 38, height: 38, borderRadius: 12, background: editingProjectId === project.id ? editProjectColor : headerColor, flexShrink: 0 }} />
                      {editingProjectId === project.id ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 200 }}>
                          <input
                            value={editProjectName}
                            onChange={e => setEditProjectName(e.target.value)}
                            onClick={e => e.stopPropagation()}
                            style={{ padding: "6px 10px", borderRadius: 8, border: "1.5px solid #EAE5F7", fontFamily: "'Baloo 2',sans-serif", fontWeight: 700, fontSize: 15, outline: "none" }}
                          />
                          <input
                            value={editProjectDescription}
                            onChange={e => setEditProjectDescription(e.target.value)}
                            onClick={e => e.stopPropagation()}
                            placeholder="Description (optional)"
                            style={{ padding: "6px 10px", borderRadius: 8, border: "1.5px solid #EAE5F7", fontFamily: "'Nunito',sans-serif", fontSize: 13, outline: "none" }}
                          />
                          <div style={{ display: "flex", gap: 6 }}>
                            {PROJECT_HEADER_COLORS.map(hex => (
                              <button
                                key={hex}
                                onClick={e => {
                                  e.stopPropagation();
                                  setEditProjectColor(hex);
                                }}
                                style={{ width: 22, height: 22, borderRadius: "50%", background: hex, cursor: "pointer", border: `2.5px solid ${hex === editProjectColor ? ACCENT_COLOR : "#ffffff"}` }}
                              />
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontFamily: "'Baloo 2',sans-serif", fontWeight: 700, fontSize: 19 }}>{project.name}</div>
                          <div style={{ fontSize: 13, color: "#9A93AC" }}>{project.description}</div>
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ background: "#EDE9F9", color: "#6C5CE7", fontSize: 12, fontWeight: 800, padding: "4px 12px", borderRadius: 100, whiteSpace: "nowrap" }}>
                        {allTasks.length} tasks
                      </span>
                      {editingProjectId === project.id ? (
                        <>
                          <button
                            onClick={saveProjectEdit}
                            disabled={savingProjectEdit || !editProjectName.trim()}
                            style={{ background: ACCENT_COLOR, border: "none", borderRadius: 8, padding: "6px 12px", color: "#fff", fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 12, cursor: "pointer", opacity: savingProjectEdit || !editProjectName.trim() ? 0.6 : 1 }}
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEditProject}
                            style={{ background: "#F3F0FC", border: "none", borderRadius: 8, padding: "6px 12px", color: "#6C5CE7", fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 12, cursor: "pointer" }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            data-project-id={project.id}
                            onClick={startEditProject}
                            title="Edit project"
                            style={{ width: 26, height: 26, border: "none", background: "rgba(255,255,255,0.6)", borderRadius: "50%", color: "#6C5CE7", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                          >
                            ✎
                          </button>
                          <button
                            data-project-id={project.id}
                            onClick={deleteProject}
                            title="Delete project"
                            style={{ width: 26, height: 26, border: "none", background: "rgba(255,255,255,0.6)", borderRadius: "50%", color: "#D64545", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Board */}
                  <div style={{ display: "flex", gap: 18, overflowX: "auto", paddingBottom: 6 }}>
                    {COLUMNS.map(col => {
                      const tasks = allTasks
                        .filter(t => t.status === col.id)
                        .filter(t => !query || t.title.toLowerCase().includes(query))
                        .filter(t => priorityFilter === "All" || t.priority === priorityFilter)
                        .sort((a, b) => a.position - b.position);
                      const key = project.id + ":" + col.id;
                      const isOver = dragOverKey === key;

                      return (
                        <div
                          key={col.id}
                          data-project-id={project.id}
                          data-column-id={col.id}
                          onDragOver={onColDragOver}
                          onDragLeave={onColDragLeave}
                          onDrop={onColDrop}
                          style={{ flex: "0 0 280px", minWidth: 280, background: isOver ? "#F1EDFC" : "#F7F5FC", borderRadius: 16, padding: 14, transition: "background 0.15s", border: `2px dashed ${isOver ? ACCENT_COLOR : "transparent"}` }}
                        >
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "4px 6px 12px", flexWrap: "wrap" }}>
                            <span style={{ fontFamily: "'Baloo 2',sans-serif", fontWeight: 700, fontSize: 14.5 }}>{col.label}</span>
                            <span style={{ background: "#EDE9F9", color: "#6C5CE7", fontSize: 11.5, fontWeight: 800, padding: "2px 8px", borderRadius: 100 }}>{tasks.length}</span>
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: cardGap }}>
                            {tasks.map(task => {
                              const meta = PRIORITY_META[task.priority] ?? PRIORITY_META.Medium;
                              const urgent = isUrgent(task.due_date);
                              return (
                                <div
                                  key={task.id}
                                  draggable
                                  data-project-id={project.id}
                                  data-task-id={task.id}
                                  onDragStart={onCardDragStart}
                                  onClick={onCardClick}
                                  style={{
                                    position: "relative",
                                    background: task.color ?? PALETTE[0],
                                    borderRadius: 14,
                                    borderLeft: meta.accent === "transparent" ? "4px solid transparent" : `4px solid ${meta.accent}`,
                                    padding: cardPadding,
                                    cursor: "grab",
                                    boxShadow: "0 1px 2px rgba(45,43,58,0.06)",
                                  }}
                                >
                                  <button
                                    data-project-id={project.id}
                                    data-task-id={task.id}
                                    onClick={onDeleteCardClick}
                                    style={{ position: "absolute", top: 8, right: 8, width: 20, height: 20, border: "none", background: "rgba(255,255,255,0.55)", borderRadius: "50%", color: "#6b6480", fontSize: 12, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                                  >
                                    ✕
                                  </button>
                                  <div style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 14.5, margin: "0 22px 6px 0", color: "#332F45" }}>{task.title}</div>
                                  {SHOW_DESCRIPTION_ON_CARD && task.description && (
                                    <div style={{ fontSize: 12.5, color: "#5C5570", marginBottom: 10, lineHeight: 1.4 }}>{task.description}</div>
                                  )}
                                  <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                                    <span style={{ fontSize: 11.5, fontWeight: 700, color: urgent ? "#C0392B" : "#5C5570", background: "rgba(255,255,255,0.55)", padding: "3px 9px", borderRadius: 100, whiteSpace: "nowrap" }}>
                                      {formatDate(task.due_date)}
                                    </span>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: urgent ? "#C0392B" : "#5C5570", whiteSpace: "nowrap" }}>({daysLeftLabel(task.due_date)})</span>
                                    <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 100, background: meta.bg, color: meta.fg, whiteSpace: "nowrap" }}>{priorityLabel(task.priority)}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <button
                            data-project-id={project.id}
                            data-column-id={col.id}
                            onClick={onAddTaskClick}
                            style={{ width: "100%", marginTop: 10, background: "rgba(255,255,255,0.5)", border: "1.5px dashed #D6CDEF", color: "#8B84A0", fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 13.5, padding: 12, borderRadius: 12, cursor: "pointer", textAlign: "center" }}
                          >
                            + Add task
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <hr style={{ border: "none", borderTop: "1px solid #ECE6FA", margin: "36px 12px 0" }} />
              </div>
            );
          })
        )}
      </div>

      {/* Modal / slide-over */}
      {modal.open && (
        <>
          <div onClick={closeModal} style={{ position: "fixed", inset: 0, background: "rgba(45,43,58,0.32)", zIndex: 40 }} />
          <div style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 420, maxWidth: "92vw", background: "#fff", zIndex: 41, boxShadow: "-16px 0 48px rgba(45,43,58,0.16)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "24px 26px", borderBottom: "1px solid #F1EDFA", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontFamily: "'Baloo 2',sans-serif", fontWeight: 700, fontSize: 19 }}>{modal.mode === "edit" ? "Edit task" : "New task"}</div>
              <button onClick={closeModal} style={{ border: "none", background: "#F5F2FC", width: 30, height: 30, borderRadius: "50%", color: "#6b6480", fontSize: 14, cursor: "pointer" }}>✕</button>
            </div>

            <div style={{ padding: "24px 26px", overflow: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 800, color: "#6C5CE7", marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.03em" }}>Task name</label>
                <input
                  name="name"
                  value={modalForm.title}
                  onChange={onFormChange}
                  placeholder="e.g. Design onboarding flow"
                  style={{ width: "100%", padding: "11px 13px", borderRadius: 11, border: "1.5px solid #EAE5F7", fontFamily: "'Nunito',sans-serif", fontSize: 14.5, outline: "none" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 800, color: "#6C5CE7", marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.03em" }}>Due date</label>
                <input
                  type="date"
                  name="dueDate"
                  value={modalForm.dueDate}
                  onChange={onFormChange}
                  style={{ width: "100%", padding: "11px 13px", borderRadius: 11, border: "1.5px solid #EAE5F7", fontFamily: "'Nunito',sans-serif", fontSize: 14.5, outline: "none", color: "#332F45" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 800, color: "#6C5CE7", marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.03em" }}>Description</label>
                <textarea
                  name="description"
                  value={modalForm.description}
                  onChange={onFormChange}
                  placeholder="Add more detail..."
                  rows={4}
                  style={{ width: "100%", padding: "11px 13px", borderRadius: 11, border: "1.5px solid #EAE5F7", fontFamily: "'Nunito',sans-serif", fontSize: 14.5, outline: "none", resize: "vertical" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 800, color: "#6C5CE7", marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.03em" }}>Priority</label>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <select
                    name="priority"
                    value={modalForm.priority}
                    onChange={onFormChange}
                    style={{ flex: 1, padding: "11px 13px", borderRadius: 11, border: "1.5px solid #EAE5F7", fontFamily: "'Nunito',sans-serif", fontSize: 14.5, outline: "none", background: "#fff" }}
                  >
                    <option value="High">High 🔥</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                  <span style={{ fontSize: 11.5, fontWeight: 800, padding: "6px 12px", borderRadius: 100, whiteSpace: "nowrap", background: modalMeta.bg, color: modalMeta.fg }}>{priorityLabel(modalForm.priority)}</span>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 800, color: "#6C5CE7", marginBottom: 9, textTransform: "uppercase", letterSpacing: "0.03em" }}>Card color</label>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {PALETTE.map(hex => (
                    <button
                      key={hex}
                      data-color={hex}
                      onClick={onColorSelect}
                      style={{ width: 34, height: 34, borderRadius: "50%", background: hex, cursor: "pointer", border: `3px solid ${hex === modalForm.color ? ACCENT_COLOR : "#ffffff"}` }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div style={{ padding: "20px 26px", borderTop: "1px solid #F1EDFA", display: "flex", gap: 10 }}>
              {modal.mode === "edit" && (
                <button onClick={deleteTaskFromModal} style={{ padding: "12px 18px", borderRadius: 12, border: "none", background: "#FFF0EE", color: "#D64545", fontWeight: 800, fontSize: 13.5, cursor: "pointer" }}>Delete</button>
              )}
              <div style={{ flex: 1 }} />
              <button onClick={closeModal} style={{ padding: "12px 18px", borderRadius: 12, border: "none", background: "#F3F0FC", color: "#6C5CE7", fontWeight: 800, fontSize: 13.5, cursor: "pointer" }}>Cancel</button>
              <button onClick={saveTask} style={{ padding: "12px 22px", borderRadius: 12, border: "none", background: ACCENT_COLOR, color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: "pointer" }}>Save task</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
