import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { bangkokDateStr, buildDailySummary, buildSummaryFlex, pushToLine, SummaryBlock } from "@/lib/line-utils";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Recurring monthly expenses (Settings-managed, web-only CRUD). Runs inside
// this same daily cron rather than a separate one — this project is on
// Vercel's Hobby plan, which only allows 1x/day crons (a stricter schedule
// silently broke the LINE push for hours once before).
async function chargeSubscriptions(
  supabase: ReturnType<typeof serviceClient>
): Promise<{ charged: number; errors: string[] }> {
  const now = new Date();
  const [year, month, day] = bangkokDateStr(now).split("-").map(Number); // month is 1-indexed
  const currentMonthKey = `${year}-${String(month).padStart(2, "0")}`;
  const daysInMonth = new Date(year, month, 0).getDate(); // last real day of `month`

  const { data: subs, error } = await supabase
    .from("subscriptions")
    .select("id, user_id, name, amount, category, payment_method, billing_day, last_charged_month")
    .eq("active", true);

  if (error) return { charged: 0, errors: [error.message] };

  // Batch-resolve spender names up front — profiles.full_name is this app's
  // source of truth for spender attribution (not auth user_metadata), and
  // transactions.spender is NOT NULL, so this must never be left blank.
  const userIds = Array.from(new Set((subs ?? []).map((s) => s.user_id)));
  const { data: profileRows } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
  const nameByUserId = new Map((profileRows ?? []).map((p) => [p.id, p.full_name]));

  let charged = 0;
  const errors: string[] = [];

  for (const sub of subs ?? []) {
    try {
      if (sub.last_charged_month === currentMonthKey) continue;
      const clampedDay = Math.min(sub.billing_day, daysInMonth); // e.g. day 31 fires on Feb 28/29
      if (day !== clampedDay) continue;

      const spender = nameByUserId.get(sub.user_id) ?? "Unknown";
      const { error: insErr } = await supabase.from("transactions").insert([{
        date: now.toISOString(),
        amount: sub.amount,
        category: sub.category,
        note: `${sub.name} (subscription)`,
        spender,
        user_id: sub.user_id,
        type: "expense",
        payment_method: sub.payment_method,
      }]);
      if (insErr) { errors.push(`sub ${sub.id}: ${insErr.message}`); continue; }

      await supabase.from("subscriptions").update({ last_charged_month: currentMonthKey }).eq("id", sub.id);
      charged++;
    } catch (err) {
      // One bad row must not stop the rest of the subscriptions from charging.
      errors.push(`sub ${sub.id}: ${String(err)}`);
    }
  }

  return { charged, errors };
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = serviceClient();

  // Isolated in its own try/catch so a bug in subscription charging can
  // never block the LINE daily summary push below, and vice versa (that
  // loop already has its own per-profile try/catch).
  let subscriptionResult: { charged: number; errors: string[] } = { charged: 0, errors: [] };
  try {
    subscriptionResult = await chargeSubscriptions(supabase);
  } catch (err) {
    subscriptionResult = { charged: 0, errors: [`subscription charging crashed: ${String(err)}`] };
  }

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, line_user_id, summary_preferences")
    .not("line_user_id", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: { id: string; status: string }[] = [];

  for (const profile of profiles ?? []) {
    try {
      const summary = await buildDailySummary(supabase, profile.id);
      const preferences = profile.summary_preferences as SummaryBlock[] | null;
      await pushToLine(profile.line_user_id, buildSummaryFlex(summary, preferences ?? undefined));
      results.push({ id: profile.id, status: "sent" });
    } catch (err) {
      results.push({ id: profile.id, status: `error: ${String(err)}` });
    }
  }

  return NextResponse.json({ ok: true, sent: results.length, results, subscriptions: subscriptionResult });
}
