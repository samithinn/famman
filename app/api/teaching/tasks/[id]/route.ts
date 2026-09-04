import { createSupabaseServer } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

const TASK_COLUMNS = "id, course_id, week_number, title, is_completed, created_at";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const update: Record<string, unknown> = {};

  if (body.is_completed !== undefined) update.is_completed = !!body.is_completed;
  if (body.title !== undefined) {
    const title = (body.title ?? "").trim();
    if (!title) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
    update.title = title;
  }

  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });

  const { data, error } = await supabase
    .from("teaching_tasks")
    .update(update)
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select(TASK_COLUMNS);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0)
    return NextResponse.json({ error: "Task not found or access denied" }, { status: 404 });

  return NextResponse.json({ task: data[0] });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("teaching_tasks")
    .delete()
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0)
    return NextResponse.json({ error: "Task not found or access denied" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
