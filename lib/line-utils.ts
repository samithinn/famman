// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { type SupabaseClient } from "@supabase/supabase-js";
import { CATEGORY_ICONS } from "@/lib/category-icons";

const THAI_MONTHS = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม",
];

const PAGE_SIZE = 10;

// Pastel palette shared by every Flex bubble — keeps the "cute" look
// consistent across summary, deep-dive list, and recent-transactions cards.
const PASTEL = {
  income: "#1FD991", // bright pastel mint
  expense: "#FF5C93", // bright bubblegum pink
  warn: "#FFC02E", // bright pastel amber
  textLabel: "#8B7BB8", // soft periwinkle-gray
  textMuted: "#B6A8DB", // light lavender-gray
  textBody: "#4A3E73", // deep violet-ink
  track: "#FFDCEE", // bright pastel pink progress-bar track
  separator: "#FFD1E8", // bright pink divider
  accent: "#8B5CF6", // vivid pastel purple (primary buttons)
  headerTint: "#FFEAF6", // bright tint for header subtitle text
  pillBg: "#EAE0FF", // bright lavender pill background for secondary buttons
} as const;

// Bright pink → vivid purple gradient used on the two "hero" headers
// (summary + recent-transactions). Income/expense deep-dive headers stay
// solid pastel so their color still signals the transaction type.
const HERO_GRADIENT = {
  type: "linearGradient",
  angle: "135deg",
  startColor: "#FF6FB7",
  endColor: "#8B5CF6",
} as const;

function fmt(n: number): string {
  return `฿${Math.round(n).toLocaleString()}`;
}

// DD/MM/YYYY, the single date format used across every LINE bot message.
export function formatDMY(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getFullYear()}`;
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

  const byCategory = new Map<string, { category: string; amount: number }>();
  for (const t of txns) {
    if (t.type !== "expense") continue;
    const cat = t.category || "Other";
    const key = cat.toLowerCase();
    const entry = byCategory.get(key) ?? { category: cat, amount: 0 };
    entry.amount += t.amount;
    byCategory.set(key, entry);
  }
  const categoryBreakdown = Array.from(byCategory.values())
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

// "YYYY-MM-DD" in Asia/Bangkok, not the server's system timezone — Vercel
// runs functions with TZ=UTC, so a naive `.toISOString()` calendar date is
// wrong for ~7 hours a day (Bangkok is UTC+7). Matters once the daily push
// can fire at any user-chosen time, not just the old fixed 22:00 ICT.
export function bangkokDateStr(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(date);
}

export async function buildDailySummary(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string
): Promise<SummaryData> {
  const now = new Date();
  const todayStr = bangkokDateStr(now);
  const tomorrowStr = bangkokDateStr(new Date(now.getTime() + 24 * 60 * 60 * 1000));
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
      { type: "text", text: label, size: "sm", color: PASTEL.textLabel, flex: 3 },
      { type: "text", text: value, size: "sm", weight: "bold", align: "end", color, flex: 2 },
    ],
  };
}

function viewDetailsButton(period: SummaryPeriod, type: "income" | "expense", periodKey: string): FlexComponent {
  return {
    type: "button",
    style: "link",
    height: "sm",
    color: type === "income" ? PASTEL.income : PASTEL.expense,
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
      { type: "text", text: `${categoryIcon(item.category)} ${item.category}`, size: "xs", color: PASTEL.textLabel, flex: 3 },
      { type: "text", text: fmt(item.amount), size: "xs", color: PASTEL.textBody, align: "end", flex: 2 },
    ],
  };
}

// Block keys accepted in profiles.summary_preferences — controls which
// optional sections the push-notification Flex message includes. Omit the
// param entirely (chat-triggered "สรุป" commands) to always show everything.
export type SummaryBlock = "income" | "expense" | "category_breakdown" | "budget";

export function buildSummaryFlex(data: SummaryData, preferences?: SummaryBlock[]): LineMessagePayload {
  const title = data.period === "daily" ? "สรุปรายวัน" : "สรุปรายเดือน";
  const emoji = data.period === "daily" ? "📅" : "📊";
  const altText = `${emoji} ${title}: ${data.periodLabel}`;
  const show = (block: SummaryBlock) => preferences === undefined || preferences.includes(block);

  const body: FlexComponent[] = [];

  if (show("income")) {
    body.push(
      amountRow("💰 รายรับ", fmt(data.income), PASTEL.income),
      { type: "box", layout: "vertical", margin: "xs", contents: [viewDetailsButton(data.period, "income", data.periodKey)] },
    );
  }
  if (show("expense")) {
    if (show("income")) body.push({ type: "separator", margin: "md", color: PASTEL.separator });
    body.push(
      amountRow("💸 รายจ่าย", fmt(data.expenses), PASTEL.expense),
      { type: "box", layout: "vertical", margin: "xs", contents: [viewDetailsButton(data.period, "expense", data.periodKey)] },
    );
  }
  if (show("income") || show("expense")) body.push({ type: "separator", margin: "md", color: PASTEL.separator });
  body.push(amountRow("คงเหลือ", `${data.net >= 0 ? "+" : ""}${fmt(data.net)}`, data.net >= 0 ? PASTEL.income : PASTEL.expense));

  if (show("category_breakdown") && data.categoryBreakdown.length > 0) {
    body.push({ type: "separator", margin: "lg", color: PASTEL.separator });
    body.push({ type: "text", text: "แยกตามหมวดหมู่", size: "xs", color: PASTEL.textMuted, weight: "bold", margin: "lg" });
    const top = data.categoryBreakdown.slice(0, 5);
    const rest = data.categoryBreakdown.slice(5);
    for (const item of top) body.push(categoryRow(item));
    if (rest.length > 0) {
      const restTotal = rest.reduce((sum, r) => sum + r.amount, 0);
      body.push(categoryRow({ category: "Other", amount: restTotal }));
    }
  }

  if (show("budget") && data.budget && data.budget > 0) {
    const pct = data.pct ?? 0;
    const overBudget = pct >= 100;
    const barColor = overBudget ? PASTEL.expense : pct >= 80 ? PASTEL.warn : PASTEL.income;
    body.push({ type: "separator", margin: "lg", color: PASTEL.separator });
    body.push(amountRow("🎯 งบเดือนนี้", fmt(data.budget), PASTEL.textBody));
    body.push({
      type: "box",
      layout: "vertical",
      margin: "sm",
      height: "8px",
      backgroundColor: PASTEL.track,
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
      background: HERO_GRADIENT,
      paddingAll: "20px",
      contents: [
        { type: "text", text: `${emoji} ${title}`, size: "sm", color: PASTEL.headerTint },
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
          color: PASTEL.accent,
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
  const color = type === "income" ? PASTEL.income : PASTEL.expense;
  const altText = `${typeLabel}${period === "daily" ? "วันนี้" : "เดือนนี้"}: ${periodLabel}`;

  const body: FlexComponent[] = [];

  if (txnPage.items.length === 0) {
    body.push({ type: "text", text: `ไม่มีรายการ${typeLabel}`, size: "sm", color: PASTEL.textMuted, align: "center" });
  } else {
    txnPage.items.forEach((item, i) => {
      if (i > 0) body.push({ type: "separator", margin: "md", color: PASTEL.separator });
      body.push({
        type: "box",
        layout: "horizontal",
        margin: i === 0 ? "none" : "md",
        contents: [
          {
            type: "text",
            text: `${categoryIcon(item.category)} ${item.category}${item.note ? ` (${item.note})` : ""}`,
            size: "sm",
            color: PASTEL.textLabel,
            flex: 3,
            wrap: true,
          },
          { type: "text", text: fmt(item.amount), size: "sm", weight: "bold", align: "end", color, flex: 2 },
        ],
      });
    });

    const from = txnPage.page * PAGE_SIZE + 1;
    const to = Math.min(from + txnPage.items.length - 1, txnPage.total);
    body.push({ type: "separator", margin: "lg", color: PASTEL.separator });
    body.push({
      type: "text",
      text: `แสดง ${from}-${to} จาก ${txnPage.total} รายการ`,
      size: "xs",
      color: PASTEL.textMuted,
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
      color: PASTEL.pillBg,
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
    color: hasMore ? PASTEL.accent : PASTEL.pillBg,
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

export interface RecentTransactionItem {
  amount: number;
  category: string | null;
  note: string | null;
  type: string;
  date: string;
}

// "show" command: last N transactions (income and expense mixed), newest first.
export function buildRecentTransactionsFlex(items: RecentTransactionItem[]): LineMessagePayload {
  const altText = `🧾 ${items.length} รายการล่าสุด`;

  const body: FlexComponent[] = [];
  items.forEach((item, i) => {
    if (i > 0) body.push({ type: "separator", margin: "md", color: PASTEL.separator });
    const color = item.type === "income" ? PASTEL.income : PASTEL.expense;
    const sign = item.type === "income" ? "+" : "-";
    const category = item.category || "Other";
    body.push({
      type: "box",
      layout: "horizontal",
      margin: i === 0 ? "none" : "md",
      contents: [
        {
          type: "box",
          layout: "vertical",
          flex: 3,
          contents: [
            {
              type: "text",
              text: `${categoryIcon(category)} ${category}${item.note ? ` (${item.note})` : ""}`,
              size: "sm",
              color: PASTEL.textLabel,
              wrap: true,
            },
            { type: "text", text: formatDMY(item.date), size: "xs", color: PASTEL.textMuted, margin: "xs" },
          ],
        },
        {
          type: "text",
          text: `${sign}${fmt(item.amount)}`,
          size: "sm",
          weight: "bold",
          align: "end",
          gravity: "center",
          color,
          flex: 2,
        },
      ],
    });
  });

  const contents: FlexComponent = {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      background: HERO_GRADIENT,
      paddingAll: "20px",
      contents: [{ type: "text", text: "🧾 รายการล่าสุด", size: "xl", weight: "bold", color: "#FFFFFF" }],
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
          color: PASTEL.accent,
          action: { type: "uri", label: "เปิดเว็บแดชบอร์ด", uri: `${dashboardUrl.replace(/\/$/, "")}/dashboard` },
        },
      ],
    };
  }

  return { type: "flex", altText, contents };
}

export interface SubscriptionListItem {
  name: string;
  amount: number;
  billing_day: number;
}

// "sub" command: active (non-paused) subscriptions, read-only, with a
// total monthly sum footer row.
export function buildSubscriptionsFlex(items: SubscriptionListItem[], total: number): LineMessagePayload {
  const altText = `🔁 Subscriptions: ${items.length} รายการ`;

  const body: FlexComponent[] = [];
  items.forEach((item, i) => {
    if (i > 0) body.push({ type: "separator", margin: "md", color: PASTEL.separator });
    body.push({
      type: "box",
      layout: "horizontal",
      margin: i === 0 ? "none" : "md",
      contents: [
        {
          type: "box",
          layout: "vertical",
          flex: 3,
          contents: [
            { type: "text", text: item.name, size: "sm", weight: "bold", color: PASTEL.textBody, wrap: true },
            { type: "text", text: `ทุกวันที่ ${item.billing_day} ของเดือน`, size: "xs", color: PASTEL.textMuted, margin: "xs" },
          ],
        },
        {
          type: "text",
          text: fmt(item.amount),
          size: "sm",
          weight: "bold",
          align: "end",
          gravity: "center",
          color: PASTEL.expense,
          flex: 2,
        },
      ],
    });
  });

  body.push({ type: "separator", margin: "lg", color: PASTEL.separator });
  body.push(amountRow("รวมต่อเดือน", fmt(total), PASTEL.expense));

  const contents: FlexComponent = {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      background: HERO_GRADIENT,
      paddingAll: "20px",
      contents: [{ type: "text", text: "🔁 Subscriptions", size: "xl", weight: "bold", color: "#FFFFFF" }],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "20px",
      contents: body,
    },
  };

  return { type: "flex", altText, contents };
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
