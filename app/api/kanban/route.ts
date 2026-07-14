import { createSupabaseServer } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("kanban_projects")
    .select(
      "id, name, description, color, icon, position, created_at, completed_at, kanban_tasks(id, project_id, title, description, due_date, priority, status, color, position, created_at)"
    )
    .eq("user_id", user.id)
    .order("position")
    .order("created_at")
    .order("status", { foreignTable: "kanban_tasks" })
    .order("position", { foreignTable: "kanban_tasks" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ projects: data ?? [] });
}
