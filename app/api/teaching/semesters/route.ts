import { createSupabaseServer } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

const SEMESTER_COLUMNS = "id, name, is_active, created_at";

export async function GET() {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("teaching_semesters")
    .select(SEMESTER_COLUMNS)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ semesters: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  // A user's very first semester is always the active one — there is
  // no valid state where the app has semesters but none is active.
  const { count, error: countError } = await supabase
    .from("teaching_semesters")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
  const isFirst = (count ?? 0) === 0;

  const { data, error } = await supabase
    .from("teaching_semesters")
    .insert({ user_id: user.id, name, is_active: isFirst })
    .select(SEMESTER_COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ semester: data });
}
