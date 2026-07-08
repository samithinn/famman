import { createSupabaseServer } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("subscriptions")
    .select("id, name, amount, billing_day, category, payment_method, active, last_charged_month, created_at")
    .eq("user_id", user.id)
    .order("billing_day");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ subscriptions: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const name = (body.name ?? "").trim();
  const amount = Number(body.amount);
  const billingDay = Number(body.billing_day);
  const category = (body.category ?? "").trim();
  // Whitelist to "Credit Card" or default "Cash" — never trust an arbitrary string.
  const paymentMethod = body.payment_method === "Credit Card" ? "Credit Card" : "Cash";

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!isFinite(amount) || amount <= 0)
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31)
    return NextResponse.json({ error: "billing_day must be between 1 and 31" }, { status: 400 });
  if (!category) return NextResponse.json({ error: "category is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("subscriptions")
    .insert({
      user_id: user.id,
      name,
      amount,
      billing_day: billingDay,
      category,
      payment_method: paymentMethod,
      active: true,
      last_charged_month: null,
    })
    .select("id, name, amount, billing_day, category, payment_method, active, last_charged_month, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ subscription: data });
}
