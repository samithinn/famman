import { createSupabaseServer } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const name = (body.name ?? "").trim();
  const description = (body.description ?? "").trim();
  const color = (body.color ?? "").trim() || null;
  const icon = (body.icon ?? "").trim() || null;

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const { data: last, error: lastError } = await supabase
    .from("kanban_projects")
    .select("position")
    .eq("user_id", user.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastError) return NextResponse.json({ error: lastError.message }, { status: 500 });
  const position = last ? last.position + 1 : 0;

  const { data, error } = await supabase
    .from("kanban_projects")
    .insert({ user_id: user.id, name, description: description || null, color, icon, position })
    .select("id, name, description, color, icon, position, created_at, completed_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ project: { ...data, kanban_tasks: [] } });
}

export async function PUT(req: NextRequest) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const order: string[] = Array.isArray(body.order) ? body.order : [];
  if (order.length === 0) return NextResponse.json({ error: "order is required" }, { status: 400 });

  const results = await Promise.all(
    order.map((id, position) =>
      supabase.from("kanban_projects").update({ position }).eq("id", id).eq("user_id", user.id)
    )
  );

  const failed = results.find(r => r.error);
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const id = body.id;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = (body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    update.name = name;
  }
  if (body.description !== undefined) update.description = (body.description ?? "").trim() || null;
  if (body.color !== undefined) update.color = (body.color ?? "").trim() || null;
  if (body.icon !== undefined) update.icon = (body.icon ?? "").trim() || null;
  if (body.completed !== undefined) update.completed_at = body.completed ? new Date().toISOString() : null;

  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });

  const { data, error } = await supabase
    .from("kanban_projects")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, name, description, color, icon, position, created_at, completed_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0)
    return NextResponse.json({ error: "Project not found or access denied" }, { status: 404 });

  return NextResponse.json({ project: data[0] });
}
