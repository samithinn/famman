import { createSupabaseServer } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const semesterId = req.nextUrl.searchParams.get("semesterId");
  if (!semesterId) return NextResponse.json({ error: "semesterId is required" }, { status: 400 });

  // Confirm the semester belongs to this user before returning anything —
  // RLS already scopes the nested select below to this user's own rows,
  // but a semesterId owned by someone else should read as "not found",
  // not an empty courses list.
  const { data: semester, error: semesterError } = await supabase
    .from("teaching_semesters")
    .select("id, name, is_active, created_at")
    .eq("id", semesterId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (semesterError) return NextResponse.json({ error: semesterError.message }, { status: 500 });
  if (!semester) return NextResponse.json({ error: "Semester not found or access denied" }, { status: 404 });

  const { data: courses, error } = await supabase
    .from("teaching_courses")
    .select(
      "id, semester_id, code, title, color_theme, created_at, teaching_tasks(id, course_id, week_number, title, is_completed, created_at)"
    )
    .eq("semester_id", semesterId)
    .eq("user_id", user.id)
    .order("created_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ semester, courses: courses ?? [] });
}
