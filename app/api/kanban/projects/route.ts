import { createSupabaseServer } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const name = (body.name ?? "").trim();
  const description = (body.description ?? "").trim();

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
    .insert({ user_id: user.id, name, description: description || null, position })
    .select("id, name, description, position, created_at")
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
