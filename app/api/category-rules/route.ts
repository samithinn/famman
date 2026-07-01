import { createSupabaseServer } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("category_rules")
    .select("id, keyword, category, source_type, created_at")
    .eq("user_id", user.id)
    .order("keyword");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { keyword, category, source_type } = await req.json();
  if (!keyword?.trim() || !category?.trim())
    return NextResponse.json({ error: "keyword and category are required" }, { status: 400 });
  if (source_type !== undefined && source_type !== "ocr" && source_type !== "chat")
    return NextResponse.json({ error: "source_type must be 'ocr' or 'chat'" }, { status: 400 });

  const { data, error } = await supabase
    .from("category_rules")
    .insert({
      user_id: user.id,
      keyword: keyword.trim().toLowerCase(),
      category: category.trim(),
      source_type: source_type ?? "ocr",
    })
    .select("id, keyword, category, source_type, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}
