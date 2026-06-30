import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { buildMonthlySummary, pushToLine } from "@/lib/line-utils";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
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
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, line_user_id")
    .not("line_user_id", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: { id: string; status: string }[] = [];

  for (const profile of profiles ?? []) {
    try {
      const summary = await buildMonthlySummary(supabase, profile.id);
      await pushToLine(profile.line_user_id, `🌙 สรุปค่าใช้จ่ายประจำวันนี้\n\n${summary}`);
      results.push({ id: profile.id, status: "sent" });
    } catch (err) {
      results.push({ id: profile.id, status: `error: ${String(err)}` });
    }
  }

  return NextResponse.json({ ok: true, sent: results.length, results });
}
