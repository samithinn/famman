import { createSupabaseServer } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

const PALETTE = ["#8B5CF6", "#3B82F6", "#10B981", "#F0623D", "#EAB308", "#EC4899"];
const TOTAL_WEEKS = 15;
const DEFAULT_TASK_TITLE = "Prepare slides";

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const semesterId = body.semester_id;
  const code = (body.code ?? "").trim();
  const title = (body.title ?? "").trim();

  if (!semesterId) return NextResponse.json({ error: "semester_id is required" }, { status: 400 });
  if (!code) return NextResponse.json({ error: "code is required" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  // Confirm the target semester belongs to this user before attaching a
  // course to it — RLS on teaching_courses only checks the course's own
  // user_id, not whether semester_id points at a semester this user owns.
  const { data: semester, error: semesterError } = await supabase
    .from("teaching_semesters")
    .select("id")
    .eq("id", semesterId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (semesterError) return NextResponse.json({ error: semesterError.message }, { status: 500 });
  if (!semester) return NextResponse.json({ error: "Semester not found or access denied" }, { status: 404 });

  const { count: courseCount, error: countError } = await supabase
    .from("teaching_courses")
    .select("id", { count: "exact", head: true })
    .eq("semester_id", semesterId);

  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
  const colorTheme = (body.color_theme ?? "").trim() || PALETTE[(courseCount ?? 0) % PALETTE.length];

  const { data: course, error } = await supabase
    .from("teaching_courses")
    .insert({ semester_id: semesterId, user_id: user.id, code, title, color_theme: colorTheme })
    .select("id, semester_id, code, title, color_theme, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Seed one default task per week so a freshly added course immediately
  // shows something in the weekly checklist, matching the design's
  // behavior of starting every course with a "Prepare slides" task.
  const seedTasks = Array.from({ length: TOTAL_WEEKS }, (_, i) => ({
    course_id: course.id,
    user_id: user.id,
    week_number: i + 1,
    title: DEFAULT_TASK_TITLE,
    is_completed: false,
  }));

  const { data: tasks, error: seedError } = await supabase
    .from("teaching_tasks")
    .insert(seedTasks)
    .select("id, course_id, week_number, title, is_completed, created_at");

  if (seedError) return NextResponse.json({ error: seedError.message }, { status: 500 });

  return NextResponse.json({ course: { ...course, teaching_tasks: tasks ?? [] } });
}
