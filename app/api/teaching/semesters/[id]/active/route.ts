import { createSupabaseServer } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Confirm the target semester belongs to this user before touching
  // anything — RLS alone would reject the update below, but we want a
  // clean 404 rather than a silent no-op if a forged id is passed.
  const { data: target, error: targetError } = await supabase
    .from("teaching_semesters")
    .select("id")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (targetError) return NextResponse.json({ error: targetError.message }, { status: 500 });
  if (!target) return NextResponse.json({ error: "Semester not found or access denied" }, { status: 404 });

  const { error: deactivateError } = await supabase
    .from("teaching_semesters")
    .update({ is_active: false })
    .eq("user_id", user.id)
    .neq("id", params.id);

  if (deactivateError) return NextResponse.json({ error: deactivateError.message }, { status: 500 });

  const { data, error } = await supabase
    .from("teaching_semesters")
    .update({ is_active: true })
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select("id, name, is_active, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ semester: data });
}
