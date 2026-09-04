import { createSupabaseServer } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

const TASK_COLUMNS = "id, course_id, week_number, title, is_completed, created_at";

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const courseId = body.course_id;
  const title = (body.title ?? "").trim();
  const weekNumber = Number(body.week_number);

  if (!courseId) return NextResponse.json({ error: "course_id is required" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 15)
    return NextResponse.json({ error: "week_number must be an integer between 1 and 15" }, { status: 400 });

  // Confirm the target course belongs to this user before attaching a
  // task to it — RLS on teaching_tasks only checks the task's own
  // user_id, not whether course_id points at a course this user owns.
  const { data: course, error: courseError } = await supabase
    .from("teaching_courses")
    .select("id")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (courseError) return NextResponse.json({ error: courseError.message }, { status: 500 });
  if (!course) return NextResponse.json({ error: "Course not found or access denied" }, { status: 404 });

  const { data, error } = await supabase
    .from("teaching_tasks")
    .insert({ course_id: courseId, user_id: user.id, week_number: weekNumber, title, is_completed: false })
    .select(TASK_COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}
