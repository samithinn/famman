import { createSupabaseServer } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const name = (body.name ?? "").trim();
  const amount = Number(body.amount);
  const billingDay = Number(body.billing_day);
  const category = (body.category ?? "").trim();
  const paymentMethod = body.payment_method === "Credit Card" ? "Credit Card" : "Cash";
  const active = body.active !== false; // pause/resume flows through this field, defaults true unless explicitly false

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!isFinite(amount) || amount <= 0)
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31)
    return NextResponse.json({ error: "billing_day must be between 1 and 31" }, { status: 400 });
  if (!category) return NextResponse.json({ error: "category is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("subscriptions")
    .update({
      name,
      amount,
      billing_day: billingDay,
      category,
      payment_method: paymentMethod,
      active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select("id, name, amount, billing_day, category, payment_method, active, last_charged_month, created_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0)
    return NextResponse.json({ error: "Subscription not found or access denied" }, { status: 404 });

  return NextResponse.json({ subscription: data[0] });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("subscriptions")
    .delete()
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0)
    return NextResponse.json({ error: "Subscription not found or access denied" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
