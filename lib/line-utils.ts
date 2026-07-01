// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { type SupabaseClient } from "@supabase/supabase-js";
import { CATEGORY_ICONS } from "@/lib/category-icons";

const THAI_MONTHS = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม",
];

const PAGE_SIZE = 10;

function fmt(n: number): string {
  return `฿${Math.round(n).toLocaleString()}`;
}

function categoryIcon(category: string): string {
  return CATEGORY_ICONS[category]?.icon ?? CATEGORY_ICONS.Other.icon;
}

// --- Flex message JSON types (LINE has no official TS SDK types in use here) ---
export type FlexComponent = Record<string, unknown>;
export type LineMessagePayload =
  | { type: "text"; text: string }
  | { type: "flex"; altText: string; contents: FlexComponent };

export interface CategoryAmount {
  category: string;
  amount: number;
}

export type SummaryPeriod = "daily" | "monthly";

export interface SummaryData {
  period: SummaryPeriod;
  // "YYYY-MM-DD" for daily, "YYYY-MM" for monthly — used to build postback data
  periodKey: string;
  periodLabel: string;
  expenses: number;
  income: number;
  net: number;
  categoryBreakdown: CategoryAmount[];
  budget?: number;
  pct?: number;
}

type Txn = { amount: number; type: string; category: string | null };

function summarizeTxns(txns: Txn[]) {
  const expenses = txns
    .filter(t => t.type === "expense")
    .reduce((sum, t) => sum + t.amount, 0);
  const income = txns
    .filter(t => t.type === "income")
    .reduce((sum, t) => sum + t.amount, 0);

  const byCategory = new Map<string, number>();
  for (const t of txns) {
    if (t.type !== "expense") continue;
    const cat = t.category || "Other";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + t.amount);
  }
  const categoryBreakdown = Array.from(byCategory, ([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  return { expenses, income, net: income - expenses, categoryBreakdown };
}

export async function buildMonthlySummary(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string
): Promise<SummaryData> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month + 1, 0).toISOString().split("T")[0];
  const monthLabel = `${THAI_MONTHS[month]} ${year}`;
  const periodKey = `${year}-${String(month + 1).padStart(2, "0")}`;

  const [{ data: txns }, { data: profile }] = await Promise.all([
    supabase
      .from("transactions")
      .select("amount, type, category")
      .eq("user_id", userId)
      .gte("date", firstDay)
      .lte("date", lastDay),
    supabase
      .from("profiles")
      .select("monthly_budget")
      .eq("id", userId)
      .single(),
  ]);

  const { expenses, income, net, categoryBreakdown } = summarizeTxns((txns ?? []) as Txn[]);
  const budget = profile?.monthly_budget ?? 0;

  const data: SummaryData = {
    period: "monthly",
    periodKey,
    periodLabel: monthLabel,
    expenses,
    income,
    net,
    categoryBreakdown,
  };

  if (budget > 0) {
    data.budget = budget;
    data.pct = Math.min(Math.round((expenses / budget) * 100), 999);
  }

  return data;
}

export async function buildDailySummary(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string
): Promise<SummaryData> {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];
  const [labelYear, labelMonth, labelDay] = todayStr.split("-").map(Number);
  const dateLabel = `${labelDay} ${THAI_MONTHS[labelMonth - 1]} ${labelYear}`;

  // gte/lt range (not eq) because transaction dates are stored either as
  // plain "YYYY-MM-DD" (chat) or full ISO timestamps (shortcut/OCR).
  const { data: txns } = await supabase
    .from("transactions")
    .select("amount, type, category")
    .eq("user_id", userId)
    .gte("date", todayStr)
    .lt("date", tomorrowStr);

  const { expenses, income, net, categoryBreakdown } = summarizeTxns((txns ?? []) as Txn[]);

  return {
    period: "daily",
    periodKey: todayStr,
    periodLabel: dateLabel,
    expenses,
    income,
    net,
    categoryBreakdown,
  };
}

export interface TransactionListItem {
  category: string;
  note: string | null;
  amount: number;
}

export interface TransactionPage {
  items: TransactionListItem[];
  total: number;
  page: number;
}

// Same date-range rules as buildDailySummary/buildMonthlySummary: daily uses
// gte/lt on a day boundary, monthly uses gte/lte on first/last day of month.
function periodDateRange(period: SummaryPeriod, periodKey: string): { gte: string; lt?: string; lte?: string } {
  if (period === "daily") {
    const d = new Date(`${periodKey}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return { gte: periodKey, lt: d.toISOString().split("T")[0] };
  }
  const [year, month] = periodKey.split("-").map(Number);
  const lastDay = new Date(year, month, 0).toISOString().split("T")[0];
  return { gte: `${periodKey}-01`, lte: lastDay };
}

// Paginated fetch for the "Deep Dive" income/expense list. Ordered by
// created_at (not `date`) because every row in a daily view shares the same
// `date` value, which would make date-based ordering non-deterministic and
// corrupt range()-based pagination across pages.
export async function fetchTransactionPage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  period: SummaryPeriod,
  periodKey: string,
  type: "expense" | "income",
  page: number
): Promise<TransactionPage> {
  const range = periodDateRange(period, periodKey);
  let query = supabase
    .from("transactions")
    .select("category, note, amount", { count: "exact" })
    .eq("user_id", userId)
    .eq("type", type)
    .gte("date", range.gte);
  query = range.lt ? query.lt("date", range.lt) : query.lte("date", range.lte!);

  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data, count } = await query.order("created_at", { ascending: false }).range(from, to);

  return {
    items: (data ?? []) as TransactionListItem[],
    total: count ?? 0,
    page,
  };
}

// Formats a periodKey ("YYYY-MM-DD" for daily, "YYYY-MM" for monthly) into
// the same Thai label style used by buildDailySummary/buildMonthlySummary,
// so the Deep Dive list header matches the summary bubble it was opened from.
export function formatPeriodLabel(period: SummaryPeriod, periodKey: string): string {
  if (period === "daily") {
    const [year, month, day] = periodKey.split("-").map(Number);
    return `${day} ${THAI_MONTHS[month - 1]} ${year}`;
  }
  const [year, month] = periodKey.split("-").map(Number);
  return `${THAI_MONTHS[month - 1]} ${year}`;
}

function postbackData(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

function deepDiveAction(period: SummaryPeriod, type: "income" | "expense"): string {
  return `view_${period}_${type}`;
}

function summaryAction(period: SummaryPeriod): string {
  return period === "daily" ? "daily_summary" : "monthly_summary";
}

function periodKeyParam(period: SummaryPeriod): "date" | "month" {
  return period === "daily" ? "date" : "month";
}

function amountRow(label: string, value: string, color: string): FlexComponent {
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: label, size: "sm", color: "#666666", flex: 3 },
      { type: "text", text: value, size: "sm", weight: "bold", align: "end", color, flex: 2 },
    ],
  };
}

function viewDetailsButton(period: SummaryPeriod, type: "income" | "expense", periodKey: string): FlexComponent {
  return {
    type: "button",
    style: "link",
    height: "sm",
    action: {
      type: "postback",
      label: "ดูรายละเอียด",
      data: postbackData({ action: deepDiveAction(period, type), [periodKeyParam(period)]: periodKey, page: "0" }),
      displayText: type === "income" ? "ดูรายละเอียดรายรับ" : "ดูรายละเอียดรายจ่าย",
    },
  };
}

function categoryRow(item: CategoryAmount): FlexComponent {
  return {
    type: "box",
    layout: "horizontal",
    margin: "sm",
    contents: [
      { type: "text", text: `${categoryIcon(item.category)} ${item.category}`, size: "xs", color: "#555555", flex: 3 },
      { type: "text", text: fmt(item.amount), size: "xs", color: "#333333", align: "end", flex: 2 },
    ],
  };
}

export function buildSummaryFlex(data: SummaryData): LineMessagePayload {
  const title = data.period === "daily" ? "สรุปรายวัน" : "สรุปรายเดือน";
  const emoji = data.period === "daily" ? "📅" : "📊";
  const altText = `${emoji} ${title}: ${data.periodLabel}`;

  const body: FlexComponent[] = [
    amountRow("💰 รายรับ", fmt(data.income), "#16A34A"),
    { type: "box", layout: "vertical", margin: "xs", contents: [viewDetailsButton(data.period, "income", data.periodKey)] },
    { type: "separator", margin: "md" },
    amountRow("💸 รายจ่าย", fmt(data.expenses), "#DC2626"),
    { type: "box", layout: "vertical", margin: "xs", contents: [viewDetailsButton(data.period, "expense", data.periodKey)] },
    { type: "separator", margin: "md" },
    amountRow("คงเหลือ", `${data.net >= 0 ? "+" : ""}${fmt(data.net)}`, data.net >= 0 ? "#16A34A" : "#DC2626"),
  ];

  if (data.categoryBreakdown.length > 0) {
    body.push({ type: "separator", margin: "lg" });
    body.push({ type: "text", text: "แยกตามหมวดหมู่", size: "xs", color: "#999999", weight: "bold", margin: "lg" });
    const top = data.categoryBreakdown.slice(0, 5);
    const rest = data.categoryBreakdown.slice(5);
    for (const item of top) body.push(categoryRow(item));
    if (rest.length > 0) {
      const restTotal = rest.reduce((sum, r) => sum + r.amount, 0);
      body.push(categoryRow({ category: "Other", amount: restTotal }));
    }
  }

  if (data.budget && data.budget > 0) {
    const pct = data.pct ?? 0;
    const overBudget = pct >= 100;
    const barColor = overBudget ? "#DC2626" : pct >= 80 ? "#F59E0B" : "#16A34A";
    body.push({ type: "separator", margin: "lg" });
    body.push(amountRow("🎯 งบเดือนนี้", fmt(data.budget), "#333333"));
    body.push({
      type: "box",
      layout: "vertical",
      margin: "sm",
      height: "8px",
      backgroundColor: "#E5E7EB",
      cornerRadius: "4px",
      contents: [
        {
          type: "box",
          layout: "vertical",
          height: "8px",
          width: `${Math.min(Math.max(pct, 0), 100)}%`,
          backgroundColor: barColor,
          cornerRadius: "4px",
          contents: [{ type: "filler" }],
        },
      ],
    });
    body.push({
      type: "text",
      text: overBudget
        ? `⚠️ เกินงบแล้วนะจ๊ะ! (${pct}%)`
        : pct >= 80
          ? `⚡ ใกล้เต็มงบแล้ว ระวังด้วย! (${pct}%)`
          : `✅ เหลืองบอีก ${fmt(data.budget - data.expenses)} (${pct}%)`,
      size: "xs",
      margin: "sm",
      color: barColor,
      wrap: true,
    });
  }

  const contents: FlexComponent = {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#3B82F6",
      paddingAll: "20px",
      contents: [
        { type: "text", text: `${emoji} ${title}`, size: "sm", color: "#DBEAFE" },
        { type: "text", text: data.periodLabel, size: "xl", weight: "bold", color: "#FFFFFF", margin: "sm" },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "20px",
      contents: body,
    },
  };

  const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (dashboardUrl) {
    contents.footer = {
      type: "box",
      layout: "vertical",
      paddingAll: "12px",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#3B82F6",
          action: { type: "uri", label: "เปิดเว็บแดชบอร์ด", uri: `${dashboardUrl.replace(/\/$/, "")}/dashboard` },
        },
      ],
    };
  }

  return { type: "flex", altText, contents };
}

// "Deep Dive" list: full breakdown of every income/expense transaction for
// the given period, paginated 10-per-page via a `page` param round-tripped
// through the postback data (this route is stateless per-request).
export function buildTransactionListFlex(
  period: SummaryPeriod,
  periodKey: string,
  periodLabel: string,
  type: "income" | "expense",
  txnPage: TransactionPage
): LineMessagePayload {
  const typeLabel = type === "income" ? "รายรับ" : "รายจ่าย";
  const color = type === "income" ? "#16A34A" : "#DC2626";
  const altText = `${typeLabel}${period === "daily" ? "วันนี้" : "เดือนนี้"}: ${periodLabel}`;

  const body: FlexComponent[] = [];

  if (txnPage.items.length === 0) {
    body.push({ type: "text", text: `ไม่มีรายการ${typeLabel}`, size: "sm", color: "#999999", align: "center" });
  } else {
    txnPage.items.forEach((item, i) => {
      if (i > 0) body.push({ type: "separator", margin: "md" });
      body.push({
        type: "box",
        layout: "horizontal",
        margin: i === 0 ? "none" : "md",
        contents: [
          {
            type: "text",
            text: `${categoryIcon(item.category)} ${item.category}${item.note ? ` (${item.note})` : ""}`,
            size: "sm",
            color: "#555555",
            flex: 3,
            wrap: true,
          },
          { type: "text", text: fmt(item.amount), size: "sm", weight: "bold", align: "end", color, flex: 2 },
        ],
      });
    });

    const from = txnPage.page * PAGE_SIZE + 1;
    const to = Math.min(from + txnPage.items.length - 1, txnPage.total);
    body.push({ type: "separator", margin: "lg" });
    body.push({
      type: "text",
      text: `แสดง ${from}-${to} จาก ${txnPage.total} รายการ`,
      size: "xs",
      color: "#999999",
      margin: "lg",
      align: "center",
    });
  }

  const footerButtons: FlexComponent[] = [];
  const hasMore = (txnPage.page + 1) * PAGE_SIZE < txnPage.total;
  if (hasMore) {
    footerButtons.push({
      type: "button",
      style: "secondary",
      action: {
        type: "postback",
        label: "ดูเพิ่มเติม",
        data: postbackData({
          action: deepDiveAction(period, type),
          [periodKeyParam(period)]: periodKey,
          page: String(txnPage.page + 1),
        }),
        displayText: "ดูเพิ่มเติม",
      },
    });
  }
  footerButtons.push({
    type: "button",
    style: hasMore ? "link" : "secondary",
    action: {
      type: "postback",
      label: "ย้อนกลับไปเมนูหลัก",
      data: postbackData({ action: summaryAction(period) }),
      displayText: "ย้อนกลับไปเมนูหลัก",
    },
  });

  return {
    type: "flex",
    altText,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: color,
        paddingAll: "20px",
        contents: [
          { type: "text", text: `${typeLabel}${period === "daily" ? "วันนี้" : "เดือนนี้"}`, size: "sm", color: "#FFFFFF" },
          { type: "text", text: periodLabel, size: "lg", weight: "bold", color: "#FFFFFF", margin: "sm" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        contents: body,
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "12px",
        contents: footerButtons,
      },
    },
  };
}

export async function pushToLine(lineUserId: string, message: string | LineMessagePayload): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return;
  const messages: LineMessagePayload[] = typeof message === "string" ? [{ type: "text", text: message }] : [message];
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to: lineUserId, messages }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.log(`[pushToLine] LINE API error ${res.status}: ${body}`);
  }
}
