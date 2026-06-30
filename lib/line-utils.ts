// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { type SupabaseClient } from "@supabase/supabase-js";

const THAI_MONTHS = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม",
];

function fmt(n: number): string {
  return `฿${Math.round(n).toLocaleString()}`;
}

export async function buildMonthlySummary(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string
): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month + 1, 0).toISOString().split("T")[0];
  const monthLabel = `${THAI_MONTHS[month]} ${year}`;

  const [{ data: txns }, { data: profile }] = await Promise.all([
    supabase
      .from("transactions")
      .select("amount, type")
      .eq("user_id", userId)
      .gte("date", firstDay)
      .lte("date", lastDay),
    supabase
      .from("profiles")
      .select("monthly_budget")
      .eq("id", userId)
      .single(),
  ]);

  const expenses = (txns ?? [])
    .filter((t: { type: string }) => t.type === "expense")
    .reduce((sum: number, t: { amount: number }) => sum + t.amount, 0);
  const income = (txns ?? [])
    .filter((t: { type: string }) => t.type === "income")
    .reduce((sum: number, t: { amount: number }) => sum + t.amount, 0);
  const budget = profile?.monthly_budget ?? 0;
  const net = income - expenses;

  let msg = `📊 สรุป${monthLabel}\n`;
  msg += `━━━━━━━━━━━━━\n`;
  msg += `💸 รายจ่าย:  ${fmt(expenses)}\n`;
  msg += `💰 รายรับ:   ${fmt(income)}\n`;
  msg += `💵 คงเหลือ:  ${net >= 0 ? "+" : ""}${fmt(net)}\n`;

  if (budget > 0) {
    const pct = Math.min(Math.round((expenses / budget) * 100), 999);
    const filled = Math.min(Math.floor(pct / 10), 10);
    const bar = "█".repeat(filled) + "░".repeat(10 - filled);
    msg += `━━━━━━━━━━━━━\n`;
    msg += `🎯 งบเดือนนี้: ${fmt(budget)}\n`;
    msg += `${bar} ${pct}%\n`;
    if (pct >= 100) msg += `⚠️ เกินงบแล้วนะจ๊ะ!`;
    else if (pct >= 80) msg += `⚡ ใกล้เต็มงบแล้ว ระวังด้วย!`;
    else msg += `✅ เหลืองบอีก ${fmt(budget - expenses)}`;
  }

  return msg;
}

export async function pushToLine(lineUserId: string, text: string): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return;
  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to: lineUserId, messages: [{ type: "text", text }] }),
  });
}
