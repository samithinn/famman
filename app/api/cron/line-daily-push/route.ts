import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { buildDailySummary, buildSummaryFlex, pushToLine, SummaryBlock } from "@/lib/line-utils";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// "HH:MM" in Asia/Bangkok, matching the format users pick in Settings for
// profiles.daily_summary_time. Vercel Cron invokes this route once per
// minute (vercel.json: "* * * * *"), so exact-string match is enough —
// no need to round/window seconds.
function currentBangkokHHMM(): string {
  // hourCycle: "h23" (not hour12: false) — some ICU builds render midnight
  // as "24:00" with hour12: false, which would never match a "00:00" setting.
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
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
  const nowHHMM = currentBangkokHHMM();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, line_user_id, summary_preferences")
    .not("line_user_id", "is", null)
    .eq("daily_summary_time", nowHHMM);

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

  return NextResponse.json({ ok: true, matchedTime: nowHHMM, sent: results.length, results });
}
