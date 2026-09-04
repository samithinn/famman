import { createSupabaseServer } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("teaching_semesters")
    .delete()
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select("id, is_active");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0)
    return NextResponse.json({ error: "Semester not found or access denied" }, { status: 404 });

  // Deleting the active semester would leave the app with no current
  // semester at all — promote the most recently created remaining one.
  if (data[0].is_active) {
    const { data: next } = await supabase
      .from("teaching_semesters")
      .select("id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (next) {
      await supabase
        .from("teaching_semesters")
        .update({ is_active: true })
        .eq("id", next.id)
        .eq("user_id", user.id);
    }
  }

  return NextResponse.json({ ok: true });
}
