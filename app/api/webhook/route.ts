import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { amount, category, note, spender } = body as Record<string, unknown>;

  if (typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }
  if (typeof category !== "string" || !category.trim()) {
    return NextResponse.json({ error: "category is required" }, { status: 400 });
  }
  if (spender !== "Husband" && spender !== "Wife") {
    return NextResponse.json({ error: "spender must be 'Husband' or 'Wife'" }, { status: 400 });
  }

  const date = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("transactions")
    .insert([{ date, amount, category, note: note ?? "", spender }])
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, transaction: data }, { status: 201 });
}
