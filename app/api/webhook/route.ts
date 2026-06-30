import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";

function isValidApiKey(provided: string): boolean {
  const expected = process.env.WEBHOOK_API_KEY ?? "";
  if (!expected || provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!isValidApiKey(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Server misconfiguration: Supabase env vars not set" }, { status: 500 });
  }

  // Uses service role key so it bypasses RLS (webhook has no user session)
  const supabase = createClient(supabaseUrl, supabaseKey);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const amount = Number(body.amount);
  const category = body.category;
  const note = body.note;
  const type = body.type === "income" ? "income" : "expense";

  if (!isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }
  if (typeof category !== "string" || !category.trim()) {
    return NextResponse.json({ error: "category is required" }, { status: 400 });
  }

  const user_id = process.env.WEBHOOK_USER_ID;
  if (!user_id) {
    return NextResponse.json({ error: "Server misconfiguration: WEBHOOK_USER_ID not set" }, { status: 500 });
  }

  // Resolve spender from profile so old automations don't need to change
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user_id).single();
  const { data: authUser } = await supabase.auth.admin.getUserById(user_id);
  const spender =
    profile?.full_name ||
    authUser?.user?.user_metadata?.full_name ||
    authUser?.user?.email?.split("@")[0] ||
    null;

  const date = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("transactions")
    .insert([{ date, amount, category, note: note ?? "", spender, user_id, type }])
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, transaction: data }, { status: 201 });
}
