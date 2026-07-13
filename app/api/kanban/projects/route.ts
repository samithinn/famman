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

  const { data, error } = await supabase
    .from("kanban_projects")
    .insert({ user_id: user.id, name, description: description || null })
    .select("id, name, description, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ project: { ...data, kanban_tasks: [] } });
}
