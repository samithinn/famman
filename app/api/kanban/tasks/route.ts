import { createSupabaseServer } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

const PRIORITIES = ["High", "Medium", "Low"];
const STATUSES = ["To do", "In Progress", "Done"];

const TASK_COLUMNS =
  "id, project_id, title, description, due_date, priority, status, color, position, created_at, source";

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const projectId = body.project_id;
  const title = (body.title ?? "").trim();
  const description = (body.description ?? "").trim();
  const source = (body.source ?? "").trim();
  const dueDate = body.due_date || null;
  const priority = PRIORITIES.includes(body.priority) ? body.priority : "Medium";
  const status = STATUSES.includes(body.status) ? body.status : "To do";
  const color = (body.color ?? "").trim() || null;
  const position = isFinite(Number(body.position)) ? Number(body.position) : 0;

  if (!projectId) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  // Confirm the project belongs to this user before attaching a task to it —
  // the kanban_tasks RLS policy only checks the task's own user_id, not
  // whether project_id points at a project this user actually owns.
  const { data: project, error: projectError } = await supabase
    .from("kanban_projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (projectError) return NextResponse.json({ error: projectError.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: "Project not found or access denied" }, { status: 404 });

  const { data, error } = await supabase
    .from("kanban_tasks")
    .insert({
      project_id: projectId,
      user_id: user.id,
      title,
      description: description || null,
      source: source || null,
      due_date: dueDate,
      priority,
      status,
      color,
      position,
    })
    .select(TASK_COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}

export async function PUT(req: NextRequest) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const id = body.id;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const title = (body.title ?? "").trim();
    if (!title) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
    update.title = title;
  }
  if (body.description !== undefined) update.description = (body.description ?? "").trim() || null;
  if (body.source !== undefined) update.source = (body.source ?? "").trim() || null;
  if (body.due_date !== undefined) update.due_date = body.due_date || null;
  if (body.color !== undefined) update.color = (body.color ?? "").trim() || null;
  if (body.priority !== undefined) {
    if (!PRIORITIES.includes(body.priority))
      return NextResponse.json({ error: "priority must be one of High/Medium/Low" }, { status: 400 });
    update.priority = body.priority;
  }
  if (body.status !== undefined) {
    // Drag-and-drop between columns updates status; reordering within/across
    // columns updates position. Both may arrive together in one drop event.
    if (!STATUSES.includes(body.status))
      return NextResponse.json({ error: "status must be one of To do/In Progress/Done" }, { status: 400 });
    update.status = body.status;
  }
  if (body.position !== undefined) {
    if (!isFinite(Number(body.position)))
      return NextResponse.json({ error: "position must be a number" }, { status: 400 });
    update.position = Number(body.position);
  }

  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });

  const { data, error } = await supabase
    .from("kanban_tasks")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select(TASK_COLUMNS);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0)
    return NextResponse.json({ error: "Task not found or access denied" }, { status: 404 });

  return NextResponse.json({ task: data[0] });
}
