import { createSupabaseServer } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("category_rules")
    .select("id, keyword, category, created_at")
    .eq("user_id", user.id)
    .order("keyword");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { keyword, category } = await req.json();
  if (!keyword?.trim() || !category?.trim())
    return NextResponse.json({ error: "keyword and category are required" }, { status: 400 });

  const { data, error } = await supabase
    .from("category_rules")
    .insert({ user_id: user.id, keyword: keyword.trim().toLowerCase(), category: category.trim() })
    .select("id, keyword, category, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}
