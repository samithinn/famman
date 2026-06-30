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

// Uses service role key so it bypasses RLS (webhook has no user session)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!isValidApiKey(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  console.log("Received payload:", JSON.stringify(body));

  const amount = Number(body.amount);
  const category = body.category;
  const note = body.note;
  const spender = body.spender;

  if (!isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }
  if (typeof category !== "string" || !category.trim()) {
    return NextResponse.json({ error: "category is required" }, { status: 400 });
  }
  if (spender !== "Husband" && spender !== "Wife") {
    return NextResponse.json({ error: "spender must be 'Husband' or 'Wife'" }, { status: 400 });
  }

  const user_id = process.env.WEBHOOK_USER_ID;
  if (!user_id) {
    return NextResponse.json({ error: "Server misconfiguration: WEBHOOK_USER_ID not set" }, { status: 500 });
  }

  const date = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("transactions")
    .insert([{ date, amount, category, note: note ?? "", spender, user_id }])
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, transaction: data }, { status: 201 });
}
