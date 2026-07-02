import { createClient } from "@supabase/supabase-js";
import { ImageAnnotatorClient } from "@google-cloud/vision";
import { createHmac, timingSafeEqual } from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import { NextRequest, NextResponse } from "next/server";
import {
  buildDailySummary,
  buildMonthlySummary,
  buildRecentTransactionsFlex,
  buildSummaryFlex,
  buildTransactionListFlex,
  fetchTransactionPage,
  formatPeriodLabel,
  pushToLine,
  type LineMessagePayload,
  type SummaryPeriod,
} from "@/lib/line-utils";

type LineSource = { userId?: string; type: string };
type LineMessage = { type: string; id?: string; text?: string };
type LinePostback = { data: string };
type LineEvent = {
  type: string;
  replyToken?: string;
  source?: LineSource;
  message?: LineMessage;
  postback?: LinePostback;
};

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

let visionClient: ImageAnnotatorClient | null = null;
function getVisionClient(): ImageAnnotatorClient {
  if (!visionClient) {
    visionClient = new ImageAnnotatorClient({ keyFilename: "./google-credentials.json" });
  }
  return visionClient;
}

async function downloadLineImage(messageId: string): Promise<Buffer> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`LINE content download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function verifySignature(body: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET ?? "";
  if (!secret || !signature) return false;
  const digest = createHmac("sha256", secret).update(body).digest("base64");
  if (digest.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

// Reply messages (using the replyToken from an incoming webhook event) are
// free and unlimited; push messages are metered against LINE's monthly quota
// (300/month on the free plan) and exhausting it makes the bot look "dead" —
// see the "bot has no response" incident. So every response to a live LINE
// event should go through `respond()` below, which replies for free when a
// still-usable token is available for the event currently being processed,
// and only falls back to push when it isn't (expired/already-used token,
// reply API error, or no event at all — e.g. the iOS Shortcut endpoint and
// the daily cron push, which never have a replyToken to begin with).
type ReplyContext = { replyToken: string; used: boolean };
const replyContextStorage = new AsyncLocalStorage<ReplyContext>();

async function tryReplyToLine(replyToken: string, message: string | LineMessagePayload): Promise<boolean> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return false;
  const messages: LineMessagePayload[] = typeof message === "string" ? [{ type: "text", text: message }] : [message];
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ replyToken, messages }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.log(`[tryReplyToLine] LINE API error ${res.status}: ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.log("[tryReplyToLine] request failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

async function respond(lineUserId: string, message: string | LineMessagePayload): Promise<void> {
  const ctx = replyContextStorage.getStore();
  if (ctx && !ctx.used && ctx.replyToken) {
    ctx.used = true;
    if (await tryReplyToLine(ctx.replyToken, message)) return;
  }
  await pushToLine(lineUserId, message);
}

function parseTransaction(
  text: string,
  categories: string[],
  mode: "chat" | "ocr" = "chat"
): { amount: number; category: string; note: string; type: "expense" | "income" } | null {
  const trimmed = text.trim();
  const isIncome = trimmed.startsWith("+");
  const raw = isIncome ? trimmed.slice(1).trim() : trimmed;
  const type: "expense" | "income" = isIncome ? "income" : "expense";

  // Chat shorthand: "<amount> <category/keyword> <note>" typed manually, in
  // any order and any capitalization — whichever token is a bare number is
  // the amount, a token matching a known category name is the category
  // (category_rules keywords are applied afterwards by applyCategoryRules),
  // and every other token is the note. Skipped for multi-line/date-looking
  // text so a pasted receipt still falls through to the OCR extraction
  // below instead of getting tokenized into a garbage note.
  const looksLikeReceiptBlob = /[\n\r]/.test(raw) || /\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}/.test(raw) || /\d{1,2}:\d{2}/.test(raw);
  if (mode === "chat" && !looksLikeReceiptBlob) {
    const parts = raw.split(/\s+/).filter(Boolean);
    const amountIndex = parts.findIndex(p => isFinite(Number(p)) && Number(p) > 0);

    if (amountIndex !== -1) {
      const amount = Number(parts[amountIndex]);
      const remaining = parts.filter((_, i) => i !== amountIndex);

      const categoryIndex = remaining.findIndex(p => categories.some(c => c.toLowerCase() === p.toLowerCase()));
      if (categoryIndex === -1) {
        return { amount, category: "Other", note: remaining.join(" "), type };
      }
      const category = categories.find(c => c.toLowerCase() === remaining[categoryIndex].toLowerCase())!;
      const note = remaining.filter((_, i) => i !== categoryIndex).join(" ");
      return { amount, category, note, type };
    }
  }

  // Receipt extraction mode: handle free-form text like "10:00 30/06/2026 ข้าวราดแกง 50 บาท"
  const cleaned = raw
    .replace(/\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}/g, "")  // YYYY-MM-DD
    .replace(/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/g, "") // DD/MM/YYYY
    .replace(/\d{1,2}:\d{2}(:\d{2})?/g, "")              // HH:MM or HH:MM:SS
    .replace(/\s{2,}/g, " ")
    .trim();

  let amount = 0;
  let rawAmountToken = "";

  // Prefer number tagged with บาท or ฿
  const bahtMatch = cleaned.match(/([\d,]+(?:\.\d{1,2})?)\s*บาท/);
  const symbolMatch = cleaned.match(/฿\s*([\d,]+(?:\.\d{1,2})?)/);

  // Government co-pay / bill-payment slips can show a gross price and a
  // discount line before the real paid amount (e.g. "ค่าสินค้า/บริการ 95
  // บาท" then "สิทธิไทยช่วยไทยพลัส -57 บาท") — a bare bahtMatch above greedily
  // grabs the first (gross) number. The explicit "จำนวนเงินที่ชำระ" (amount
  // actually paid) label is authoritative when present and wins over it.
  const paidLabelMatch = cleaned.match(/จำนวนเงินที่ชำระ[^\d]*([\d,]+(?:\.\d{1,2})?)\s*บาท/);

  if (paidLabelMatch) {
    amount = parseFloat(paidLabelMatch[1].replace(/,/g, ""));
    rawAmountToken = paidLabelMatch[0];
  } else if (bahtMatch) {
    amount = parseFloat(bahtMatch[1].replace(/,/g, ""));
    rawAmountToken = bahtMatch[0];
  } else if (symbolMatch) {
    amount = parseFloat(symbolMatch[1].replace(/,/g, ""));
    rawAmountToken = symbolMatch[0];
  } else {
    // Priority: numbers with exactly 2 decimal places look like prices (50.00, 1,234.00)
    const decimalCandidates = Array.from(cleaned.matchAll(/([\d,]+\.\d{2})(?!\d)/g))
      .map(m => ({ val: parseFloat(m[0].replace(/,/g, "")), token: m[0] }))
      .filter(c => isFinite(c.val) && c.val > 0);

    if (decimalCandidates.length > 0) {
      // Largest 2-decimal number is most likely the total
      const best = decimalCandidates.reduce((a, b) => (b.val > a.val ? b : a));
      amount = best.val;
      rawAmountToken = best.token;
    } else {
      // Last resort: largest number, skipping year-like values (1900–2099)
      const candidates = Array.from(cleaned.matchAll(/([\d,]+(?:\.\d{1,2})?)/g))
        .map(m => ({ val: parseFloat(m[0].replace(/,/g, "")), token: m[0] }))
        .filter(c => {
          if (!isFinite(c.val) || c.val <= 0) return false;
          if (/^\d{4}$/.test(c.token) && c.val >= 1900 && c.val <= 2099) return false;
          return true;
        });
      if (candidates.length === 0) return null;
      const best = candidates.reduce((a, b) => (b.val > a.val ? b : a));
      amount = best.val;
      rawAmountToken = best.token;
    }
  }

  if (!isFinite(amount) || amount <= 0) return null;

  const note = cleaned
    .replace(rawAmountToken, "")
    .replace(/\bบาท\b/g, "")
    .replace(/฿/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  const noteLower = note.toLowerCase();
  const matched = categories.find(c => noteLower.includes(c.toLowerCase()));

  return { amount, category: matched ?? "Other", note, type };
}

// Looks up the user's category_rules and, if the input text contains a
// matching keyword, overrides an "Other" category with the rule's category.
// Mutates `parsed.category` in place so every caller sees the final value.
//
// Rules are scoped by source: OCR (iOS Shortcut receipt parsing) and chat
// (LINE text commands) are separate rule sets. A "chat" source checks chat
// rules first, then falls back to ocr rules (so existing ocr-only rules
// still work from chat). An "ocr" source only ever checks ocr rules.
async function applyCategoryRules(
  supabase: ReturnType<typeof serviceClient>,
  profileId: string,
  rawText: string,
  parsed: { amount: number; category: string; note: string; type: "expense" | "income" },
  source: "ocr" | "chat"
): Promise<void> {
  if (parsed.category !== "Other") {
    console.log(`[category-rules] category already resolved to "${parsed.category}" — skipping rule check`);
    return;
  }

  const { data: rules, error } = await supabase
    .from("category_rules")
    .select("keyword, category, source_type")
    .eq("user_id", profileId);

  if (error) {
    console.log("[category-rules] failed to load category_rules:", error.message);
    return;
  }

  const lowerText = rawText.toLowerCase();
  const allRules = (rules ?? []) as { keyword: string; category: string; source_type: string }[];
  const find = (type: string) =>
    allRules.filter(r => r.source_type === type).find(r => lowerText.includes(r.keyword.toLowerCase()));

  const hit = source === "chat" ? find("chat") ?? find("ocr") : find("ocr");

  if (hit) {
    console.log(
      `[category-rules] source="${source}" matched keyword "${hit.keyword}" in "${rawText}" -> category "${hit.category}" (was "Other")`
    );
    parsed.category = hit.category;

    // The keyword is often just a shorthand trigger (e.g. "แฟ 20" meaning
    // "coffee 20") rather than real note content, since it leaked into
    // `parsed.note` only because it didn't match a category name during
    // parsing. Strip it back out so it doesn't get saved as a bogus note.
    const escapedKeyword = hit.keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    parsed.note = parsed.note
      .replace(new RegExp(escapedKeyword, "gi"), "")
      .replace(/\s{2,}/g, " ")
      .trim();
  } else {
    console.log(`[category-rules] source="${source}" no keyword match in "${rawText}" among ${allRules.length} rule(s) — keeping "Other"`);
  }
}

const PERSONALITY_FALLBACK: Record<"expense" | "income", string[]> = {
  expense: [
    "บันทึกให้ละจ้า ไม่ต้องบ่นเรื่องเงินเลยนะ!",
    "จัดไป! บันทึกยอดให้แล้วครับเจ้านาย",
    "เรียบร้อย! หวังว่าวันนี้จะเหลือเงินกินข้าวนะ",
  ],
  income: [
    "บันทึกรายรับให้แล้วครับ! รวยขึ้นอีกก้าวนะ",
    "เงินเข้าแล้ว! จัดการบันทึกให้เรียบร้อยจ้า",
    "เยี่ยม! บันทึกรายรับให้แล้วนะครับ ยินดีด้วย!",
  ],
};

// Database-driven bot replies, split strictly by transaction type so an
// income transaction can never surface an expense-flavored template.
// Selection order: type-scoped category match -> type-scoped "general" -> hardcoded fallback for that type.
async function pickPersonalityResponse(
  supabase: ReturnType<typeof serviceClient>,
  category: string,
  type: "expense" | "income",
  profileId: string,
  lastResponse: string | null
): Promise<string> {
  const fallbackPool = PERSONALITY_FALLBACK[type];
  const pickFallback = () => fallbackPool[Math.floor(Math.random() * fallbackPool.length)];

  try {
    const { data, error } = await supabase
      .from("line_responses")
      .select("category, response_text")
      .eq("type", type);

    if (error) {
      console.log(`[personality] failed to load "${type}" responses:`, error.message);
      return pickFallback();
    }

    const responses = (data ?? []) as { category: string; response_text: string }[];
    if (responses.length === 0) {
      console.log(`[personality] no "${type}" responses in DB — using hardcoded fallback`);
      return pickFallback();
    }

    const catLower = category.toLowerCase();
    const matched = responses.filter(
      r => r.category !== "general" && catLower.includes(r.category.toLowerCase())
    );
    const fullPool = matched.length > 0
      ? matched
      : responses.filter(r => r.category === "general");

    if (fullPool.length === 0) {
      console.log(`[personality] no "${type}" response for category "${category}" (and no general fallback) — using hardcoded fallback`);
      return pickFallback();
    }

    // Exclude the last-used response so it never repeats consecutively
    const pool = fullPool.length > 1
      ? fullPool.filter(r => r.response_text !== lastResponse)
      : fullPool;

    const chosen = pool[Math.floor(Math.random() * pool.length)].response_text;
    console.log(`[personality] type="${type}" category="${category}" -> picked from ${fullPool.length} candidate(s): "${chosen}"`);

    // Persist the chosen response so next call can exclude it
    await supabase
      .from("profiles")
      .update({ line_last_response: chosen })
      .eq("id", profileId);

    return chosen;
  } catch (err) {
    console.log(`[personality] unexpected error selecting "${type}" response:`, err);
    return pickFallback();
  }
}

const FORMAT_ERROR_MESSAGES = [
  "พิมพ์อะไรมาเนี่ยยย อ่านไม่ออกโว้ย! 😅 ต้องมีตัวเลขกับหมวดหมู่นะเจ้านาย จะพิมพ์อันไหนก่อนก็ได้ เช่น '500 food' หรือ 'food 500' เอาใหม่ๆ!",
  "โอ๊ยยย บอทสับสน! 😵‍💫 ขอแค่มีตัวเลขกับหมวดหมู่ครบ สลับที่กันยังไงก็อ่านออกครับพี่! ลองพิมพ์ใหม่นะ เช่น '50 กาแฟ' หรือ 'กาแฟ 50'",
  "เห้ยๆ พิมพ์ผิดป่าว! บอทรับ [ตัวเลข] กับ [หมวดหมู่/โน้ต] สลับที่กันได้หมดนะจ๊ะ 😤 เช่น '120 food' หรือ 'food 120' เข้าใจมะ? ลองใหม่!",
  "อ่านไม่ออกจ้าาา ภาษามนุษย์ต่างดาวปะเนี่ย? 👽 พิมพ์ตัวเลขยอดเงินกับหมวดหมู่มาด้วยกันก่อน จะเรียงยังไงก็ได้! เช่น '300 fuel' หรือ 'fuel 300'",
  "ใจเย็นๆ ลูกพี่! ค่อยๆ พิมพ์นะ... แค่มี 'ตัวเลข' กับ 'หมวดหมู่' ครบ สลับที่กันก็ไม่เป็นไรครับ เช่น '200 ช้อปปิ้ง' หรือ 'ช้อปปิ้ง 200' ลองใหม่นะจ๊ะ!",
];

function randomFormatError(): string {
  return FORMAT_ERROR_MESSAGES[Math.floor(Math.random() * FORMAT_ERROR_MESSAGES.length)];
}

const HELP_MESSAGE_FALLBACK = [
  "📖 คำสั่งที่ใช้ได้ทั้งหมด",
  "━━━━━━━━━━━━━",
  "💸 บันทึกรายจ่าย:",
  "[จำนวน] [หมวดหมู่/คำค้น] สลับที่กันได้ (เช่น 20 กาแฟ หรือ กาแฟ 20)",
  "",
  "✏️ แก้ไขยอด/หมวดหมู่ของรายการล่าสุด:",
  "edit [จำนวน] [หมวดหมู่] สลับที่กันได้ เช่น edit 150 food หรือ edit food 150",
  "หรือพิมพ์ edit เฉยๆ บอทจะถามว่าต้องการแก้ไขเป็นอะไร",
  "",
  "📝 เพิ่ม/แก้ไข Note ของรายการล่าสุด:",
  "note [ข้อความ] เช่น note กินข้าวกับเพื่อน",
  "",
  "🗑️ ลบรายการล่าสุด (ลบทันที ไม่ถาม):",
  "delete หรือ ลบ",
  "↩️ กู้คืนรายการที่เพิ่งลบ:",
  "undo หรือ กู้คืน",
  "",
  "🧾 ดูรายการล่าสุด 5 รายการ:",
  "show หรือ แสดง",
  "",
  "📂 ดูหมวดหมู่ทั้งหมด:",
  "cats (แสดงรายชื่อหมวดหมู่)",
  "",
  "📂 เพิ่มหมวดหมู่ใหม่:",
  "cat (บอทจะถามว่าต้องการเพิ่มหมวดอะไร)",
  "",
  "🔖 เพิ่มกฎผ่านแชท:",
  "rule chat: [keyword] = [category]",
  "",
  "🧾 เพิ่มกฎผ่านสลิป:",
  "rule slip: [keyword] = [category]",
  "",
  "📊 ดูสรุปวันนี้:",
  "สรุปรายวัน, รายวัน หรือ daily",
  "",
  "📊 ดูสรุปเดือนนี้:",
  "สรุปรายเดือน, รายเดือน หรือ monthly",
  "",
  "📊 ดูสรุป (เลือกวัน/เดือน):",
  "summary หรือ สรุป",
  "━━━━━━━━━━━━━",
  "❓ พิมพ์ help หรือ ช่วยด้วย เพื่อดูคำสั่งนี้อีกครั้ง",
].join("\n");

// Admin-editable via Settings → Bot Help Message (bot_settings table),
// so the reply text can change without a code deploy.
async function buildHelpMessage(supabase: ReturnType<typeof serviceClient>): Promise<string> {
  const { data, error } = await supabase
    .from("bot_settings")
    .select("value")
    .eq("key", "help_message")
    .single();

  if (error || !data?.value) return HELP_MESSAGE_FALLBACK;
  return data.value;
}

// Shared by the "สรุปรายวัน/สรุปรายเดือน" text commands and the matching
// Rich Menu postback actions so both entry points behave identically.
async function handleSummaryCommand(
  supabase: ReturnType<typeof serviceClient>,
  lineUserId: string,
  period: "daily" | "monthly"
): Promise<void> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("line_user_id", lineUserId)
    .single();

  if (!profile) {
    await respond(lineUserId, "ยังไม่ได้เชื่อมต่อบัญชีนะ ไปที่ Settings → Connect LINE ก่อนเลย");
    return;
  }

  const summary =
    period === "daily"
      ? await buildDailySummary(supabase, profile.id)
      : await buildMonthlySummary(supabase, profile.id);
  await respond(lineUserId, buildSummaryFlex(summary));
}

// "Deep Dive" — the "ดูรายละเอียด" buttons under รายรับ/รายจ่าย in the
// summary Flex message, and the "ดูเพิ่มเติม" pagination button on the
// resulting list, all route back here with an incrementing `page`.
async function handleDeepDiveCommand(
  supabase: ReturnType<typeof serviceClient>,
  lineUserId: string,
  period: SummaryPeriod,
  periodKey: string,
  type: "income" | "expense",
  page: number
): Promise<void> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("line_user_id", lineUserId)
    .single();

  if (!profile) {
    await respond(lineUserId, "ยังไม่ได้เชื่อมต่อบัญชีนะ ไปที่ Settings → Connect LINE ก่อนเลย");
    return;
  }

  const txnPage = await fetchTransactionPage(supabase, profile.id, period, periodKey, type, page);
  const periodLabel = formatPeriodLabel(period, periodKey);
  await respond(lineUserId, buildTransactionListFlex(period, periodKey, periodLabel, type, txnPage));
}

// --- Guided "add rule" flow (triggered by the "เพิ่มกฎ" Rich Menu button) ---
// Multi-step conversations are tracked via profiles.line_pending_action /
// line_pending_data since the webhook itself is stateless per-request.
type AddRuleFlowData = { source?: "chat" | "slip"; keyword?: string };
type AddCategoryFlowData = { categoryName?: string };

const ADD_RULE_CANCELLED = "ยกเลิกแล้วครับ";
const ADD_CATEGORY_CANCELLED = "ยกเลิกแล้วครับ";

async function startAddCategoryFlow(
  supabase: ReturnType<typeof serviceClient>,
  lineUserId: string
): Promise<void> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("line_user_id", lineUserId)
    .single();

  if (!profile) {
    await respond(lineUserId, "ยังไม่ได้เชื่อมต่อบัญชีนะ ไปที่ Settings → Connect LINE ก่อนเลย");
    return;
  }

  const { error } = await supabase
    .from("profiles")
    .update({ line_pending_action: "add_category_name", line_pending_data: null })
    .eq("id", profile.id);

  if (error) {
    console.log("[add-category-flow] failed to save pending state:", error.message);
    await respond(lineUserId, "เริ่มขั้นตอนไม่สำเร็จ ลองใหม่อีกครั้งนะครับ");
    return;
  }

  await respond(lineUserId, "ต้องการจะเพิ่มหมวดหมู่อะไรดีครับ? (เช่น Parking)\n\nพิมพ์ cc เพื่อยกเลิก");
}

async function continueAddCategoryFlow(
  supabase: ReturnType<typeof serviceClient>,
  lineUserId: string,
  profileId: string,
  pendingAction: string,
  pendingData: AddCategoryFlowData | null,
  text: string
): Promise<void> {
  if (/^(cancel|cc|ยกเลิก)$/i.test(text)) {
    await supabase
      .from("profiles")
      .update({ line_pending_action: null, line_pending_data: null })
      .eq("id", profileId);
    await respond(lineUserId, ADD_CATEGORY_CANCELLED);
    return;
  }

  const data = pendingData ?? {};

  if (pendingAction === "add_category_name") {
    const categoryName = text.trim();
    if (!categoryName) {
      await respond(lineUserId, "พิมพ์ชื่อหมวดหมู่ด้วยนะครับ");
      return;
    }

    await supabase
      .from("profiles")
      .update({ line_pending_action: "add_category_type", line_pending_data: { categoryName } })
      .eq("id", profileId);

    await respond(lineUserId, "นี่คือรายรับหรือรายจ่ายดีรับ?\n\nพิมพ์ 1 สำหรับ รายจ่าย (expense)\nพิมพ์ 2 สำหรับ รายรับ (income)\n\nพิมพ์ cc เพื่อยกเลิก");
    return;
  }

  if (pendingAction === "add_category_type") {
    const normalized = text.trim();
    const type: "expense" | "income" | null =
      normalized === "1" || /^(expense|รายจ่าย)$/i.test(normalized) ? "expense"
      : normalized === "2" || /^(income|รายรับ)$/i.test(normalized) ? "income"
      : null;

    if (!type) {
      await respond(lineUserId, "พิมพ์ 1 สำหรับ รายจ่าย หรือ 2 สำหรับ รายรับ (หรือพิมพ์ cc เพื่อยกเลิก)");
      return;
    }

    const categoryName = data.categoryName ?? "";
    if (!categoryName) {
      await supabase
        .from("profiles")
        .update({ line_pending_action: null, line_pending_data: null })
        .eq("id", profileId);
      await respond(lineUserId, "เกิดข้อผิดพลาด ลองใหม่อีกครั้งนะครับ");
      return;
    }

    await supabase
      .from("profiles")
      .update({ line_pending_action: null, line_pending_data: null })
      .eq("id", profileId);

    const typeLabel = type === "expense" ? "รายจ่าย" : "รายรับ";

    const { data: existingCats } = await supabase
      .from("categories")
      .select("name")
      .eq("user_id", profileId)
      .eq("type", type);
    const dup = (existingCats ?? []).find(
      (c: { name: string }) => c.name.toLowerCase() === categoryName.toLowerCase()
    );
    if (dup) {
      await respond(lineUserId, `หมวดหมู่ "${dup.name}" มีอยู่แล้วครับ (${typeLabel})`);
      return;
    }

    const { error } = await supabase
      .from("categories")
      .insert({ user_id: profileId, name: categoryName, type });

    await respond(
      lineUserId,
      error
        ? "เพิ่มหมวดหมู่ไม่สำเร็จ ลองใหม่อีกครั้งนะครับ"
        : `เพิ่มหมวดหมู่ "${categoryName}" (${typeLabel}) เรียบร้อยแล้วครับ!`
    );
    return;
  }

  // Unrecognized state — clear it
  await supabase
    .from("profiles")
    .update({ line_pending_action: null, line_pending_data: null })
    .eq("id", profileId);
}

// Shared by the "cats"/"categories" text command and the "หมวดหมู่"
// Rich Menu submenu option 1, so both entry points behave identically.
async function sendCategoryList(
  supabase: ReturnType<typeof serviceClient>,
  lineUserId: string,
  profileId: string
): Promise<void> {
  const { data: categories } = await supabase
    .from("categories")
    .select("name, type")
    .eq("user_id", profileId)
    .order("name");

  if (!categories || categories.length === 0) {
    await respond(lineUserId, "ไม่มีหมวดหมู่ให้ใช้ ลองพิมพ์ 'cat' เพื่อเพิ่มหมวดหมู่ใหม่");
    return;
  }

  const expenses = categories.filter((c) => c.type === "expense").map((c) => c.name);
  const incomes = categories.filter((c) => c.type === "income").map((c) => c.name);

  let message = "📂 หมวดหมู่ที่มี\n━━━━━━━━━━━━━\n";
  if (expenses.length > 0) {
    message += "💸 รายจ่าย:\n" + expenses.map((c) => `• ${c}`).join("\n") + "\n\n";
  }
  if (incomes.length > 0) {
    message += "💰 รายรับ:\n" + incomes.map((c) => `• ${c}`).join("\n");
  }

  await respond(lineUserId, message);
}

// --- Category submenu (Rich Menu "หมวดหมู่" button) ---
// Asks the user to choose "1: view all" or "2: add new" before acting,
// same pending-state pattern as the add-rule/add-category flows.
async function startCategoryMenuFlow(
  supabase: ReturnType<typeof serviceClient>,
  lineUserId: string
): Promise<void> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("line_user_id", lineUserId)
    .single();

  if (!profile) {
    await respond(lineUserId, "ยังไม่ได้เชื่อมต่อบัญชีนะ ไปที่ Settings → Connect LINE ก่อนเลย");
    return;
  }

  const { error } = await supabase
    .from("profiles")
    .update({ line_pending_action: "category_menu", line_pending_data: null })
    .eq("id", profile.id);

  if (error) {
    console.log("[category-menu-flow] failed to save pending state:", error.message);
    await respond(lineUserId, "เริ่มขั้นตอนไม่สำเร็จ ลองใหม่อีกครั้งนะครับ");
    return;
  }

  await respond(
    lineUserId,
    "เลือกทำรายการ:\n1: แสดงหมวดหมู่ทั้งหมด\n2: เพิ่มหมวดหมู่/กฎใหม่\n\nพิมพ์ cc เพื่อยกเลิก"
  );
}

async function continueCategoryMenuFlow(
  supabase: ReturnType<typeof serviceClient>,
  lineUserId: string,
  profileId: string,
  text: string
): Promise<void> {
  if (/^(cancel|cc|ยกเลิก)$/i.test(text)) {
    await supabase
      .from("profiles")
      .update({ line_pending_action: null, line_pending_data: null })
      .eq("id", profileId);
    await respond(lineUserId, "ยกเลิกแล้วครับ");
    return;
  }

  if (text === "1" || /^แสดงหมวดหมู่/i.test(text)) {
    await supabase
      .from("profiles")
      .update({ line_pending_action: null, line_pending_data: null })
      .eq("id", profileId);
    await sendCategoryList(supabase, lineUserId, profileId);
    return;
  }

  if (text === "2" || /^เพิ่มหมวดหมู่/i.test(text)) {
    await supabase
      .from("profiles")
      .update({ line_pending_action: null, line_pending_data: null })
      .eq("id", profileId);
    await startAddCategoryFlow(supabase, lineUserId);
    return;
  }

  await respond(lineUserId, "พิมพ์ 1 หรือ 2 นะครับ (หรือ cc เพื่อยกเลิก)");
}

// Bare "สรุป" is ambiguous (daily vs monthly), so it asks instead of
// guessing — same pending-state pattern as the category menu above.
async function startSummaryMenuFlow(
  supabase: ReturnType<typeof serviceClient>,
  lineUserId: string
): Promise<void> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("line_user_id", lineUserId)
    .single();

  if (!profile) {
    await respond(lineUserId, "ยังไม่ได้เชื่อมต่อบัญชีนะ ไปที่ Settings → Connect LINE ก่อนเลย");
    return;
  }

  const { error } = await supabase
    .from("profiles")
    .update({ line_pending_action: "summary_menu", line_pending_data: null })
    .eq("id", profile.id);

  if (error) {
    console.log("[summary-menu-flow] failed to save pending state:", error.message);
    await respond(lineUserId, "เริ่มขั้นตอนไม่สำเร็จ ลองใหม่อีกครั้งนะครับ");
    return;
  }

  await respond(lineUserId, "กด 1 เพื่อดูสรุปรายวัน หรือกด 2 เพื่อดูสรุปรายเดือน\n\nพิมพ์ cc เพื่อยกเลิก");
}

async function continueSummaryMenuFlow(
  supabase: ReturnType<typeof serviceClient>,
  lineUserId: string,
  profileId: string,
  text: string
): Promise<void> {
  if (/^(cancel|cc|ยกเลิก)$/i.test(text)) {
    await supabase
      .from("profiles")
      .update({ line_pending_action: null, line_pending_data: null })
      .eq("id", profileId);
    await respond(lineUserId, "ยกเลิกแล้วครับ");
    return;
  }

  if (text === "1") {
    await supabase
      .from("profiles")
      .update({ line_pending_action: null, line_pending_data: null })
      .eq("id", profileId);
    await handleSummaryCommand(supabase, lineUserId, "daily");
    return;
  }

  if (text === "2") {
    await supabase
      .from("profiles")
      .update({ line_pending_action: null, line_pending_data: null })
      .eq("id", profileId);
    await handleSummaryCommand(supabase, lineUserId, "monthly");
    return;
  }

  await respond(lineUserId, "กด 1 เพื่อดูสรุปรายวัน หรือกด 2 เพื่อดูสรุปรายเดือน (หรือ cc เพื่อยกเลิก)");
}

async function startAddRuleFlow(
  supabase: ReturnType<typeof serviceClient>,
  lineUserId: string
): Promise<void> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("line_user_id", lineUserId)
    .single();

  if (!profile) {
    await respond(lineUserId, "ยังไม่ได้เชื่อมต่อบัญชีนะ ไปที่ Settings → Connect LINE ก่อนเลย");
    return;
  }

  const { error } = await supabase
    .from("profiles")
    .update({ line_pending_action: "add_rule_source", line_pending_data: null })
    .eq("id", profile.id);

  if (error) {
    console.log("[add-rule-flow] failed to save pending state:", error.message);
    await respond(lineUserId, "เริ่มขั้นตอนไม่สำเร็จ ลองใหม่อีกครั้งนะครับ");
    return;
  }

  await respond(
    lineUserId,
    "ต้องการเพิ่มกฎ chat หรือ slip ดีครับ?\nพิมพ์ 1 สำหรับ chat (ข้อความในแชท)\nพิมพ์ 2 สำหรับ slip (สลิป/ใบเสร็จ)\n\nพิมพ์ cancel เพื่อยกเลิก"
  );
}

// Bare "edit" flow: waits for the next message, then applies it
async function continueEditTransactionFlow(
  supabase: ReturnType<typeof serviceClient>,
  lineUserId: string,
  profileId: string,
  text: string
): Promise<void> {
  if (/^(cancel|cc|ยกเลิก)$/i.test(text)) {
    await supabase
      .from("profiles")
      .update({ line_pending_action: null, line_pending_data: null })
      .eq("id", profileId);
    await respond(lineUserId, "ยกเลิกแล้วครับ");
    return;
  }

  await applyEditToLastTransaction(supabase, lineUserId, profileId, text);
}

// Parses new amount/category (and optional trailing note) and applies it to
// the last transaction immediately. Shared by the bare "edit" flow above and
// the one-shot "edit <amount> <category> [note]" trigger.
async function applyEditToLastTransaction(
  supabase: ReturnType<typeof serviceClient>,
  lineUserId: string,
  profileId: string,
  text: string
): Promise<void> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, line_last_transaction_id, line_last_response")
    .eq("id", profileId)
    .single();

  if (!profile?.line_last_transaction_id) {
    await supabase
      .from("profiles")
      .update({ line_pending_action: null, line_pending_data: null })
      .eq("id", profileId);
    await respond(lineUserId, "ไม่พบรายการที่จะแก้ไข ลองใหม่อีกครั้งนะครับ");
    return;
  }

  const { data: cats } = await supabase
    .from("categories")
    .select("name")
    .eq("user_id", profileId);
  const categoryNames = (cats ?? []).map((c: { name: string }) => c.name);

  const editParsed = parseTransaction(text, categoryNames);
  if (!editParsed) {
    await respond(lineUserId, randomFormatError());
    return;
  }

  await applyCategoryRules(supabase, profileId, text, editParsed, "chat");

  // Trailing text after amount+category (if any) also updates the note;
  // otherwise the existing note is left untouched.
  const hasNote = editParsed.note.trim().length > 0;
  const { error: updateError } = await supabase
    .from("transactions")
    .update({
      amount: editParsed.amount,
      category: editParsed.category,
      type: editParsed.type,
      ...(hasNote ? { note: editParsed.note } : {}),
    })
    .eq("id", profile.line_last_transaction_id);

  await supabase
    .from("profiles")
    .update({ line_pending_action: null, line_pending_data: null })
    .eq("id", profileId);

  if (updateError) {
    await respond(lineUserId, "แก้ไขรายการไม่สำเร็จ ลองใหม่อีกครั้งนะครับ");
  } else {
    const catLabel = hasNote ? `${editParsed.category} (${editParsed.note})` : editParsed.category;
    const personality = await pickPersonalityResponse(supabase, editParsed.category, editParsed.type, profileId, (profile as Record<string, unknown>).line_last_response as string ?? null);
    await respond(lineUserId, buildSuccessMessage(personality, editParsed.amount, catLabel));
  }
}

// Note flow: set the note on the last transaction immediately, no confirmation
async function continueNoteStep(
  supabase: ReturnType<typeof serviceClient>,
  lineUserId: string,
  profileId: string,
  text: string
): Promise<void> {
  if (/^(cancel|cc|ยกเลิก)$/i.test(text)) {
    await supabase
      .from("profiles")
      .update({ line_pending_action: null, line_pending_data: null })
      .eq("id", profileId);
    await respond(lineUserId, "ยกเลิกแล้วครับ");
    return;
  }

  await applyNoteToLastTransaction(supabase, lineUserId, profileId, text.trim());
}

// Shared by both the one-shot "note <text>" trigger and the two-step "note" flow
async function applyNoteToLastTransaction(
  supabase: ReturnType<typeof serviceClient>,
  lineUserId: string,
  profileId: string,
  newNote: string
): Promise<void> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, line_last_transaction_id")
    .eq("id", profileId)
    .single();

  await supabase
    .from("profiles")
    .update({ line_pending_action: null, line_pending_data: null })
    .eq("id", profileId);

  if (!profile?.line_last_transaction_id) {
    await respond(lineUserId, "ไม่พบรายการที่จะแก้ไข ลองใหม่อีกครั้งนะครับ");
    return;
  }

  const { error: updateError } = await supabase
    .from("transactions")
    .update({ note: newNote })
    .eq("id", profile.line_last_transaction_id);

  if (updateError) {
    await respond(lineUserId, "แก้ไข Note ไม่สำเร็จ ลองใหม่อีกครั้งนะครับ");
  } else {
    await respond(lineUserId, newNote ? `เพิ่ม Note แล้วครับ: ${newNote}` : "ลบ Note แล้วครับ");
  }
}

// Advances one step of the pending "เพิ่มกฎ" conversation for a user who
// already has a `line_pending_action` set. Returns without side effects if
// `pendingAction` isn't a step this flow recognizes (defensive: clears it).
async function continueAddRuleFlow(
  supabase: ReturnType<typeof serviceClient>,
  lineUserId: string,
  profileId: string,
  pendingAction: string,
  pendingData: AddRuleFlowData | null,
  text: string
): Promise<void> {
  if (/^(cancel|cc|ยกเลิก)$/i.test(text)) {
    await supabase
      .from("profiles")
      .update({ line_pending_action: null, line_pending_data: null })
      .eq("id", profileId);
    await respond(lineUserId, ADD_RULE_CANCELLED);
    return;
  }

  const data = pendingData ?? {};

  if (pendingAction === "add_rule_source") {
    const normalized = text.trim();
    const source: "chat" | "slip" | null =
      normalized === "1" || /^chat$/i.test(normalized) ? "chat"
      : normalized === "2" || /^slip$/i.test(normalized) ? "slip"
      : null;

    if (!source) {
      await respond(lineUserId, "พิมพ์ 1 สำหรับ chat หรือ 2 สำหรับ slip นะครับ (หรือพิมพ์ cancel เพื่อยกเลิก)");
      return;
    }

    await supabase
      .from("profiles")
      .update({ line_pending_action: "add_rule_keyword", line_pending_data: { source } })
      .eq("id", profileId);
    await respond(lineUserId, "โอเค! พิมพ์คำ (keyword) ที่ต้องการให้บอทจับคู่ เช่น ข้าว");
    return;
  }

  if (pendingAction === "add_rule_keyword") {
    const keyword = text.trim();
    if (!keyword) {
      await respond(lineUserId, "พิมพ์คำ (keyword) ที่ต้องการให้บอทจับคู่ด้วยนะครับ");
      return;
    }

    await supabase
      .from("profiles")
      .update({ line_pending_action: "add_rule_category", line_pending_data: { ...data, keyword } })
      .eq("id", profileId);
    await respond(lineUserId, "เกือบเสร็จแล้ว! พิมพ์หมวดหมู่ (category) ที่ต้องการให้จัดเข้า เช่น food");
    return;
  }

  if (pendingAction === "add_rule_category") {
    const category = text.trim();
    if (!category) {
      await respond(lineUserId, "พิมพ์หมวดหมู่ (category) ด้วยนะครับ");
      return;
    }

    const source = data.source ?? "chat";
    const keyword = data.keyword ?? "";
    const sourceType = source === "chat" ? "chat" : "ocr";

    const { error } = await supabase
      .from("category_rules")
      .insert({ user_id: profileId, keyword: keyword.toLowerCase(), category, source_type: sourceType });

    await supabase
      .from("profiles")
      .update({ line_pending_action: null, line_pending_data: null })
      .eq("id", profileId);

    await respond(
      lineUserId,
      error
        ? "บันทึกกฎไม่สำเร็จ ลองใหม่อีกครั้งนะครับ"
        : `บันทึกกฎเรียบร้อย! ถ้าเจอ "${keyword}" ใน ${source} จะจัดเป็น ${category} ให้ครับ`
    );
    return;
  }

  // Unrecognized state — clear it so the user isn't stuck mid-flow forever.
  await supabase
    .from("profiles")
    .update({ line_pending_action: null, line_pending_data: null })
    .eq("id", profileId);
}

// Routes Rich Menu button taps (LINE "postback" events). Data is a query
// string so it's extensible, e.g. "action=daily_summary".
async function handlePostback(
  supabase: ReturnType<typeof serviceClient>,
  lineUserId: string,
  data: string
): Promise<void> {
  const params = new URLSearchParams(data);
  const action = params.get("action");

  switch (action) {
    case "daily_summary":
      await handleSummaryCommand(supabase, lineUserId, "daily");
      return;
    case "monthly_summary":
      await handleSummaryCommand(supabase, lineUserId, "monthly");
      return;
    case "help":
      await respond(lineUserId, await buildHelpMessage(supabase));
      return;
    case "add_rule":
      await startAddRuleFlow(supabase, lineUserId);
      return;
    case "view_daily_income":
    case "view_daily_expense":
    case "view_monthly_income":
    case "view_monthly_expense": {
      const period: "daily" | "monthly" = action.startsWith("view_daily") ? "daily" : "monthly";
      const type: "income" | "expense" = action.endsWith("income") ? "income" : "expense";
      const periodKey = params.get(period === "daily" ? "date" : "month");
      const page = Math.max(Number(params.get("page") ?? "0") || 0, 0);
      if (!periodKey) {
        console.log(`[postback] missing ${period === "daily" ? "date" : "month"} param in data "${data}"`);
        return;
      }
      await handleDeepDiveCommand(supabase, lineUserId, period, periodKey, type, page);
      return;
    }
    default:
      console.log(`[postback] unrecognized action in data "${data}"`);
  }
}

function buildSuccessMessage(personality: string, amount: number, catLabel: string): string {
  const summaries = [
    `(จัดไป: ฿${amount.toLocaleString()} - ${catLabel})`,
    `(บันทึกเรียบร้อยละจ้า ฿${amount.toLocaleString()} หมวด ${catLabel})`,
    `(เช็คให้ละ ฿${amount.toLocaleString()} สำหรับ ${catLabel})`,
  ];
  const summary = summaries[Math.floor(Math.random() * summaries.length)];
  return `${personality} ${summary}`;
}

// Extracts the "ALLCAPS (Name)" parenthetical (e.g. "TUNGNGERN (NALINEE)" ->
// "NALINEE"), since that is the actual person, not the wallet/service label.
// Leaves other candidates untouched.
function stripParenName(candidate: string): string {
  const match = candidate.match(/^[A-Z][A-Z\s]*\(([^)]+)\)$/);
  return match ? match[1].trim() : candidate;
}

function extractRecipientName(rawText: string): string | null {
  const lines = rawText.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);

  // Priority 1: explicit "ผู้รับโอน" label — inline or next line
  for (let i = 0; i < lines.length; i++) {
    const inlineMatch = lines[i].match(/ผู้รับโอน[:\s]+(.+)/);
    if (inlineMatch) return stripParenName(inlineMatch[1].trim());
    if (lines[i] === "ผู้รับโอน" && lines[i + 1]) return stripParenName(lines[i + 1].trim());
  }

  // Priority 2: line after "ไปยัง" that has a Thai honorific
  for (let i = 0; i < lines.length; i++) {
    if (/^ไปยัง/.test(lines[i]) && lines[i + 1]) {
      const next = lines[i + 1].trim();
      if (/^(นาย|นาง(?:สาว)?|น\.ส\.)/.test(next)) return stripParenName(next);
    }
  }

  // Priority 2.5: anchor on "ถุงเงิน" — the merchant-side receiving-app icon
  // label on ภาครัฐ (government) co-pay QR slips (e.g. "ไทยช่วยไทยพลัส"),
  // where a user's เป๋าตัง app pays into a merchant's ถุงเงิน app. These slips
  // have no masked account line for Priority 3 to anchor on, and the merchant
  // name is a single word with no space, so it also fails the Thai-name-lines
  // fallback below (which requires 2+ space-separated words) — that fallback
  // was matching the category description line instead (e.g. "อาหาร ของหวาน
  // เครื่องดื่ม"), a real bug seen on a live slip. The merchant name is always
  // the very next line after the "ถุงเงิน" icon label.
  const tungngoenIndex = lines.findIndex((line) => line === "ถุงเงิน");
  if (tungngoenIndex !== -1 && lines[tungngoenIndex + 1]) {
    return lines[tungngoenIndex + 1].trim();
  }

  // Priority 3: anchor on the sender's masked account number line — shape:
  // dash-separated groups of digits/X-mask, e.g. "XXX-X-XX244-5",
  // "xxx-x-x0459-x", "XXX-X-x8589-x" (verified against real OCR output from
  // multiple banks, see Ex_Slip/ + Vercel logs). The recipient's name/label
  // is the *last* substantive line between that anchor and the start of the
  // footer (transaction ref / amount / fee section). This beats trying to
  // recognize "what a name looks like" (Thai, English caps, brackets,
  // lowercase, alphanumeric biller codes — an unbounded space that kept
  // breaking on new formats); instead it relies on the one thing that is
  // actually guaranteed — sender-then-receiver order — plus a small,
  // enumerable footer/junk vocabulary.
  const maskedAccountIndex = lines.findIndex(
    (line) => /[Xx]/.test(line) && /^[Xx0-9]{1,6}(-[Xx0-9]{1,6}){2,4}$/.test(line)
  );
  if (maskedAccountIndex !== -1) {
    const footerLabelPrefix = /^(เลขที่รายการ|จำนวน|ค่าธรรมเนียม|รหัสอ้างอิง|บันทึกช่วยจำ|รายละเอียด|หมายเลขบัตร|สแกนตรวจสอบสลิป|ตรวจสอบสลิป|Amount|Fee|Transaction ID)/i;
    const strayTokens = new Set(["ttb", "TTB", "tub", "tb", "K+", "SCB", "BBL", "KTB", "BAY", "GSB", "TMB", "UOB", "CIMB", "พร้อมเพย์", "LINEPay"]);
    // Reference/serial codes (all-caps + digits, e.g. "DL020004260600072069"),
    // account numbers whether masked or not (dash-separated digit/X groups,
    // e.g. "xxx-xxx-7235", "004-99920510-0687" — case-insensitive, since some
    // banks mask with lowercase x), plain numeric/currency amounts, and
    // parenthesized codes are all junk, never the recipient.
    const isJunkLine = (line: string): boolean =>
      /^[A-Z0-9]+$/.test(line) ||
      /^[Xx0-9]{1,10}(-[Xx0-9]{1,10}){1,4}$/.test(line) ||
      /^[\d\s.,]+$/.test(line) ||
      /^[\d,]+(\.\d+)?\s*บาท$/.test(line) ||
      /^\(.*\)$/.test(line);

    const footerStart = lines.findIndex((line, idx) => idx > maskedAccountIndex && footerLabelPrefix.test(line));
    const searchEnd = footerStart === -1 ? lines.length : footerStart;
    const candidates = lines
      .slice(maskedAccountIndex + 1, searchEnd)
      .filter((line) => !strayTokens.has(line) && !isJunkLine(line) && /[A-Za-z฀-๿]/.test(line));
    if (candidates.length > 0) return stripParenName(candidates[candidates.length - 1]);
  }

  // Fallback priorities below are for slips where no masked-account line was
  // recognized at all; kept from earlier fixes but not re-verified against
  // real OCR output the way Priority 3 above was.

  // Thai name lines — honorific-prefixed or bare, last one wins.
  const nameLineBlacklist = new Set(["โอนเงินสำเร็จ", "ทำรายการสำเร็จ", "ค่าธรรมเนียม", "พร้อมเพย์", "บันทึกช่วยจำ"]);
  const nameLines = lines.filter(
    (line) => !nameLineBlacklist.has(line) && /^[฀-๿][฀-๿.]*(?:\s+[฀-๿.]+)+$/.test(line)
  );
  if (nameLines.length > 0) return nameLines[nameLines.length - 1];

  // Company / partnership — same "last one is the receiver" rule.
  const companyLines = lines.filter((line) => /^(บริษัท|ห้างหุ้นส่วน)/.test(line));
  if (companyLines.length > 0) return companyLines[companyLines.length - 1];

  // Bill-payment "Payment to X" label — take verbatim.
  for (const line of lines) {
    if (/^payment to\s+/i.test(line)) return line;
  }

  // ALL-CAPS English name lines, last one wins.
  const englishLineBlacklist = new Set(["TRANSFER", "COMPLETED", "TRANSFER COMPLETED", "AMOUNT", "FEE"]);
  const englishNameLines = lines.filter(
    (line) => !englishLineBlacklist.has(line) && /^[A-Z]+(?:\s+[A-Z]+)+$/.test(line)
  );
  if (englishNameLines.length > 0) return englishNameLines[englishNameLines.length - 1];

  // Single ALL-CAPS English merchant name (no counterpart to disambiguate
  // against, so just take the first one).
  for (const line of lines) {
    if (/^[A-Z][A-Z\s]{2,}$/.test(line)) return line;
  }

  return null;
}

function buildShortcutReply(
  personality: string,
  amount: number,
  category: string,
  recipientName: string | null,
  userNote: string,
  isOther: boolean
): string {
  const detailLine = userNote ? `โน้ต: ${userNote}` : `โอนให้: ${recipientName ?? "ร้านค้า/ผู้รับ"}`;
  let msg = `${personality}\nยอด: ฿${amount.toLocaleString()}\n${detailLine}\nหมวด: ${category}`;
  if (isOther) msg += `\n💡 ยังจัดหมวดไม่ได้ แก้ที่แอพฯ ได้เลยนะ!`;
  return msg;
}

// One-line summary for the iOS Shortcut's local notification (limited
// banner space, unlike the full chat-style reply above) — just enough to
// confirm at a glance that the right amount/category/item was saved. Same
// userNote-over-recipientName priority as buildShortcutReply, so both the
// "with note" and "without note" Shortcut variants show the right detail.
function buildShortcutNotification(
  amount: number,
  category: string,
  recipientName: string | null,
  userNote: string,
  isOther: boolean
): string {
  const flag = isOther ? "⚠️" : "✅";
  const detail = userNote || recipientName;
  const label = detail ? `${category} · ${detail}` : category;
  return `${flag} ฿${amount.toLocaleString()} - ${label}`;
}

function isValidApiKey(provided: string): boolean {
  const expected = process.env.WEBHOOK_API_KEY ?? "";
  if (!expected || provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

function isValidShortcutKey(provided: string): boolean {
  const expected = process.env.SHORTCUT_SECRET ?? "";
  if (!expected || provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function handleShortcutRequest(
  req: NextRequest,
  body: { userId: string; rawText: string; note?: string }
): Promise<NextResponse> {
  // Accept x-shortcut-key (new) or Authorization: Bearer (legacy)
  const shortcutKey = req.headers.get("x-shortcut-key") ?? "";
  if (shortcutKey) {
    if (!isValidShortcutKey(shortcutKey)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!isValidApiKey(token)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = serviceClient();
  const lineUserId = (body.userId ?? "").trim();
  const text = body.rawText.trim();

  // TEMP DEBUG: capture real OCR line output to fix extractRecipientName
  // against ground truth instead of hand-transcribed guesses. Remove once
  // recipient extraction is rebuilt on real data.
  console.log("[shortcut] raw OCR lines:", JSON.stringify(text.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean)));

  console.log("[shortcut] looking up line_user_id:", JSON.stringify(lineUserId));

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, line_last_response")
    .eq("line_user_id", lineUserId)
    .single();

  console.log("[shortcut] profile result:", JSON.stringify(profile), "error:", JSON.stringify(profileError));

  if (!profile) {
    return NextResponse.json(
      { error: `No profile found for line_user_id: ${lineUserId}`, detail: profileError?.message ?? null },
      { status: 404 }
    );
  }

  const { data: cats } = await supabase
    .from("categories")
    .select("name")
    .eq("user_id", profile.id);
  const categoryNames = (cats ?? []).map((c: { name: string }) => c.name);

  const parsed = parseTransaction(text, categoryNames, "ocr");
  if (!parsed) {
    console.log("[shortcut] parseTransaction failed. rawText:", JSON.stringify(text));
    return NextResponse.json(
      { error: "Unrecognized format", receivedText: text, message: "❌ Couldn't read amount/category — save it manually" },
      { status: 400 }
    );
  }

  // Smart categorization: scan rawText against the user's OCR category_rules
  await applyCategoryRules(supabase, profile.id, text, parsed, "ocr");

  const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
  const spender =
    profile.full_name ||
    authUser?.user?.user_metadata?.full_name ||
    authUser?.user?.email?.split("@")[0] ||
    null;

  // Receipt-extraction mode leaves parsed.note as almost the entire slip
  // (only the amount/date/time tokens are stripped) — keep just the
  // recipient name instead, so edit/delete/show don't echo the whole slip.
  // A user-typed note always wins over the (sometimes unreliable) extracted
  // recipient name.
  const recipientName = extractRecipientName(text);
  const userNote = (body.note ?? "").trim();
  const note = userNote || recipientName || parsed.note.slice(0, 60).trim();

  const date = new Date().toISOString();
  const { data: txData, error: txError } = await supabase
    .from("transactions")
    .insert([{ date, amount: parsed.amount, category: parsed.category, note, spender, user_id: profile.id, type: parsed.type }])
    .select("id");

  if (txError) {
    return NextResponse.json({ error: txError.message }, { status: 500 });
  }

  // Save the last transaction ID for edit/delete functionality
  const transactionId = txData?.[0]?.id;
  if (transactionId) {
    await supabase
      .from("profiles")
      .update({ line_last_transaction_id: transactionId })
      .eq("id", profile.id);
  }

  // No LINE push here on purpose — this endpoint is hit directly by the iOS
  // Shortcut (not a LINE webhook event), so there's no replyToken to reply
  // with either. The Shortcut shows `message` as a local notification
  // instead, keeping OCR entries off LINE's metered Push quota entirely
  // (reserved for the daily cron summary only — see respond()/ReplyContext above).
  // Kept short (unlike buildShortcutReply's chat-style message) since
  // notification banner space is limited.
  const notification = buildShortcutNotification(parsed.amount, parsed.category, recipientName, userNote, parsed.category === "Other");

  return NextResponse.json({ ok: true, message: notification });
}

// Bank-slip photo sent directly in LINE chat. Runs the image through Google
// Cloud Vision OCR, then hands off to the same parsing pipeline as the iOS
// Shortcut flow (parseTransaction + extractRecipientName + applyCategoryRules)
// so both OCR entry points behave identically instead of duplicating regexes.
async function handleSlipImage(
  supabase: ReturnType<typeof serviceClient>,
  lineUserId: string,
  messageId: string
): Promise<void> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, line_last_response")
    .eq("line_user_id", lineUserId)
    .single();

  if (!profile) {
    await respond(lineUserId, "ยังไม่ได้เชื่อมต่อบัญชีนะ ไปที่ Settings → Connect LINE ก่อนเลย");
    return;
  }

  let text = "";
  try {
    const imageBuffer = await downloadLineImage(messageId);
    const [result] = await getVisionClient().textDetection({ image: { content: imageBuffer } });
    text = result.fullTextAnnotation?.text ?? "";
  } catch (err) {
    console.log("[slip-ocr] Vision API failed:", err instanceof Error ? err.message : err);
    await respond(lineUserId, "อ่านสลิปไม่สำเร็จ ลองส่งรูปใหม่ หรือพิมพ์ยอดเองก็ได้ครับ");
    return;
  }

  console.log("[slip-ocr] raw OCR lines:", JSON.stringify(text.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean)));

  if (!text.trim()) {
    await respond(lineUserId, "อ่านตัวหนังสือในรูปไม่ออกเลยครับ ลองส่งรูปที่ชัดกว่านี้ดูนะ");
    return;
  }

  const { data: cats } = await supabase
    .from("categories")
    .select("name")
    .eq("user_id", profile.id);
  const categoryNames = (cats ?? []).map((c: { name: string }) => c.name);

  const parsed = parseTransaction(text, categoryNames, "ocr");
  if (!parsed) {
    console.log("[slip-ocr] parseTransaction failed. OCR text:", JSON.stringify(text));
    await respond(lineUserId, randomFormatError());
    return;
  }

  // Smart categorization: scan OCR text against the user's "rule slip" (source_type='ocr') rules
  await applyCategoryRules(supabase, profile.id, text, parsed, "ocr");

  const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
  const spender =
    profile.full_name ||
    authUser?.user?.user_metadata?.full_name ||
    authUser?.user?.email?.split("@")[0] ||
    null;

  const recipientName = extractRecipientName(text);
  const note = recipientName || "อ่านจากสลิป";

  const date = new Date().toISOString();
  const { data: txData, error: txError } = await supabase
    .from("transactions")
    .insert([{ date, amount: parsed.amount, category: parsed.category, note, spender, user_id: profile.id, type: parsed.type }])
    .select("id");

  if (txError) {
    await respond(lineUserId, "บันทึกรายการไม่สำเร็จ ลองใหม่อีกครั้งนะครับ");
    return;
  }

  const transactionId = txData?.[0]?.id;
  if (transactionId) {
    await supabase
      .from("profiles")
      .update({ line_last_transaction_id: transactionId })
      .eq("id", profile.id);
  }

  const personality = await pickPersonalityResponse(supabase, parsed.category, parsed.type, profile.id, profile.line_last_response ?? null);
  const reply = buildShortcutReply(personality, parsed.amount, parsed.category, recipientName, "", parsed.category === "Other");
  await respond(lineUserId, reply);
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  let bodyJson: unknown;
  try {
    bodyJson = JSON.parse(raw);
  } catch {
    bodyJson = null;
  }

  // iOS Shortcut path: detected by x-shortcut-key header OR { userId, rawText } body shape
  const shortcutKeyHeader = req.headers.get("x-shortcut-key") ?? "";
  const isShortcutByHeader = shortcutKeyHeader !== "";
  const isShortcutByBody =
    bodyJson !== null &&
    typeof bodyJson === "object" &&
    "userId" in (bodyJson as object) &&
    "rawText" in (bodyJson as object) &&
    !("events" in (bodyJson as object));

  if (isShortcutByHeader || isShortcutByBody) {
    if (
      !bodyJson ||
      typeof bodyJson !== "object" ||
      !("userId" in (bodyJson as object)) ||
      !("rawText" in (bodyJson as object))
    ) {
      return NextResponse.json({ error: "Body must include userId and rawText" }, { status: 400 });
    }
    return handleShortcutRequest(req, bodyJson as { userId: string; rawText: string; note?: string });
  }

  // --- Standard LINE webhook path ---
  const signature = req.headers.get("x-line-signature") ?? "";

  if (!verifySignature(raw, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!bodyJson) return NextResponse.json({ ok: true }); // Return 200 so LINE doesn't retry

  const body = bodyJson as { events?: LineEvent[] };

  const events = body.events ?? [];
  if (events.length === 0) return NextResponse.json({ ok: true }); // Verification ping

  const supabase = serviceClient();

  for (const event of events) {
    const lineUserId = event.source?.userId;
    if (!lineUserId) continue;

    const ctx: ReplyContext = { replyToken: event.replyToken ?? "", used: false };
    await replyContextStorage.run(ctx, () => processEvent(supabase, event, lineUserId));
  }

  return NextResponse.json({ ok: true });
}

// One incoming LINE event's worth of command dispatch, run inside
// replyContextStorage.run() (see POST below) so every `respond()` call in
// this function and everything it calls can use the event's replyToken.
async function processEvent(
  supabase: ReturnType<typeof serviceClient>,
  event: LineEvent,
  lineUserId: string
): Promise<void> {
    // --- Rich Menu button taps ---
    if (event.type === "postback") {
      await handlePostback(supabase, lineUserId, event.postback?.data ?? "");
      return;
    }

    // --- Bank-slip photo sent in chat ---
    if (event.type === "message" && event.message?.type === "image" && event.message.id) {
      await handleSlipImage(supabase, lineUserId, event.message.id);
      return;
    }

    if (event.type !== "message" || event.message?.type !== "text") return;
    const text = (event.message.text ?? "").trim();

    if (!text) return;

    // --- Mid-flow answers take priority over every other command ---
    const { data: flowProfile } = await supabase
      .from("profiles")
      .select("id, line_pending_action, line_pending_data")
      .eq("line_user_id", lineUserId)
      .single();

    if (flowProfile?.line_pending_action === "edit_transaction") {
      await continueEditTransactionFlow(supabase, lineUserId, flowProfile.id, text);
      return;
    }

    if (flowProfile?.line_pending_action === "note_step") {
      await continueNoteStep(supabase, lineUserId, flowProfile.id, text);
      return;
    }

    if (flowProfile?.line_pending_action === "summary_menu") {
      await continueSummaryMenuFlow(supabase, lineUserId, flowProfile.id, text);
      return;
    }

    if (flowProfile?.line_pending_action === "category_menu") {
      await continueCategoryMenuFlow(supabase, lineUserId, flowProfile.id, text);
      return;
    }

    if (flowProfile?.line_pending_action?.startsWith("add_category")) {
      await continueAddCategoryFlow(
        supabase,
        lineUserId,
        flowProfile.id,
        flowProfile.line_pending_action,
        flowProfile.line_pending_data as AddCategoryFlowData | null,
        text
      );
      return;
    }

    if (flowProfile?.line_pending_action) {
      await continueAddRuleFlow(
        supabase,
        lineUserId,
        flowProfile.id,
        flowProfile.line_pending_action,
        flowProfile.line_pending_data as AddRuleFlowData | null,
        text
      );
      return;
    }

    // --- Account linking ---
    if (/^link\s+/i.test(text)) {
      const token = text.replace(/^link\s+/i, "").trim();
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, line_link_token_expires_at")
        .eq("line_link_token", token)
        .single();

      if (!profile) {
        await respond(lineUserId, "Invalid link code. Generate a new one in the app → Settings → Connect LINE.");
        return;
      }
      if (new Date(profile.line_link_token_expires_at) < new Date()) {
        await respond(lineUserId, "Link code has expired. Please generate a new one in the app.");
        return;
      }

      await supabase
        .from("profiles")
        .update({ line_user_id: lineUserId, line_link_token: null, line_link_token_expires_at: null })
        .eq("id", profile.id);

      await respond(
        lineUserId,
        "Linked! You can now record transactions by sending:\n500 Food & Dining  (expense)\n350 Transportation  (expense)\n+5000 Salary  (income — use + prefix)\n\nSend \"summary\" or \"สรุป\" anytime to see this month's stats 📊"
      );
      return;
    }

    // --- Help command ---
    if (/^(help|ช่วยด้วย|คู่มือ|วิธีใช้)$/i.test(text)) {
      await respond(lineUserId, await buildHelpMessage(supabase));
      return;
    }

    // --- Delete last transaction (immediate, no confirmation; "undo" restores it) ---
    if (/^(delete|del|ลบ)$/i.test(text)) {
      const { data: delProfile } = await supabase
        .from("profiles")
        .select("id, line_last_transaction_id")
        .eq("line_user_id", lineUserId)
        .single();

      if (!delProfile?.line_last_transaction_id) {
        await respond(lineUserId, "ไม่พบรายการล่าสุดสำหรับแก้ไขหรือลบครับ");
        return;
      }

      const { data: deletedTxn } = await supabase
        .from("transactions")
        .select("date, amount, category, note, spender, user_id, type")
        .eq("id", delProfile.line_last_transaction_id)
        .single();

      const { error: delError } = await supabase
        .from("transactions")
        .delete()
        .eq("id", delProfile.line_last_transaction_id);

      if (delError) {
        await respond(lineUserId, "ลบรายการไม่สำเร็จ ลองใหม่อีกครั้งนะครับ");
      } else {
        const { error: snapshotError } = await supabase
          .from("profiles")
          .update({
            line_last_transaction_id: null,
            line_pending_action: null,
            line_last_deleted: deletedTxn ?? null,
          })
          .eq("id", delProfile.id);

        await respond(
          lineUserId,
          snapshotError ? "ลบรายการล่าสุดแล้วครับ!" : "ลบรายการล่าสุดแล้วครับ! (พิมพ์ undo เพื่อกู้คืน)"
        );
      }
      return;
    }

    // --- Undo the last delete ---
    if (/^(undo|กู้คืน)$/i.test(text)) {
      const { data: undoProfile } = await supabase
        .from("profiles")
        .select("id, line_last_deleted")
        .eq("line_user_id", lineUserId)
        .single();

      const deleted = undoProfile?.line_last_deleted as
        | { date: string; amount: number; category: string; note: string | null; spender: string | null; user_id: string; type: "expense" | "income" }
        | null;

      if (!undoProfile || !deleted) {
        await respond(lineUserId, "ไม่มีรายการที่ลบล่าสุดให้กู้คืนครับ");
        return;
      }

      const { data: restored, error: restoreError } = await supabase
        .from("transactions")
        .insert([deleted])
        .select("id")
        .single();

      if (restoreError || !restored) {
        await respond(lineUserId, "กู้คืนรายการไม่สำเร็จ ลองใหม่อีกครั้งนะครับ");
        return;
      }

      await supabase
        .from("profiles")
        .update({ line_last_transaction_id: restored.id, line_last_deleted: null })
        .eq("id", undoProfile.id);

      const txnLabel = deleted.note ? `฿${deleted.amount.toLocaleString()} - ${deleted.category} (${deleted.note})` : `฿${deleted.amount.toLocaleString()} - ${deleted.category}`;
      await respond(lineUserId, `กู้คืนรายการแล้วครับ: ${txnLabel}`);
      return;
    }

    // --- Edit last transaction: one-shot "edit <amount> <category> [note]" or bare "edit" to start a flow ---
    if (/^edit\b\s*(.*)$/i.test(text)) {
      const editMatch = text.match(/^edit\b\s*(.*)$/i);
      const editArgs = editMatch?.[1]?.trim() ?? "";

      const { data: editProfile } = await supabase
        .from("profiles")
        .select("id, line_last_transaction_id")
        .eq("line_user_id", lineUserId)
        .single();

      if (!editProfile?.line_last_transaction_id) {
        await respond(lineUserId, "ไม่พบรายการล่าสุดสำหรับแก้ไขหรือลบครับ");
        return;
      }

      if (editArgs) {
        await applyEditToLastTransaction(supabase, lineUserId, editProfile.id, editArgs);
        return;
      }

      // Fetch the transaction to show it
      const { data: txn } = await supabase
        .from("transactions")
        .select("amount, category, note")
        .eq("id", editProfile.line_last_transaction_id)
        .single();

      if (!txn) {
        await respond(lineUserId, "ไม่พบรายการล่าสุด ลองใหม่อีกครั้งนะครับ");
        return;
      }

      const txnLabel = txn.note ? `฿${txn.amount.toLocaleString()} - ${txn.category} (${txn.note})` : `฿${txn.amount.toLocaleString()} - ${txn.category}`;
      const { error } = await supabase
        .from("profiles")
        .update({ line_pending_action: "edit_transaction", line_pending_data: null })
        .eq("id", editProfile.id);

      if (error) {
        console.log("[edit-flow] failed to save pending state:", error.message);
        await respond(lineUserId, "เริ่มขั้นตอนไม่สำเร็จ ลองใหม่อีกครั้งนะครับ");
      } else {
        await respond(lineUserId, `รายการล่าสุด: ${txnLabel}\n\nต้องการแก้ไขยอดเงิน หรือ หมวดหมู่ไหมครับ? สลับที่กันได้ (เช่น 150 food restaurant หรือ food 150 restaurant)\n\nพิมพ์ cc เพื่อยกเลิก`);
      }
      return;
    }

    // --- Note on last transaction: one-shot "note <text>" or bare "note" to start a flow ---
    if (/^(?:note|โน้ต)\b\s*:?\s*(.*)$/i.test(text)) {
      const noteMatch = text.match(/^(?:note|โน้ต)\b\s*:?\s*(.*)$/i);
      const noteText = noteMatch?.[1]?.trim() ?? "";

      const { data: noteProfile } = await supabase
        .from("profiles")
        .select("id, line_last_transaction_id")
        .eq("line_user_id", lineUserId)
        .single();

      if (!noteProfile?.line_last_transaction_id) {
        await respond(lineUserId, "ไม่พบรายการล่าสุดสำหรับเพิ่ม Note ครับ");
        return;
      }

      if (noteText) {
        await applyNoteToLastTransaction(supabase, lineUserId, noteProfile.id, noteText);
      } else {
        await supabase
          .from("profiles")
          .update({ line_pending_action: "note_step", line_pending_data: null })
          .eq("id", noteProfile.id);
        await respond(lineUserId, "อยากเพิ่ม Note ว่าอะไรครับ?\n\nพิมพ์ cc เพื่อยกเลิก");
      }
      return;
    }

    // --- Summary commands ---
    if (/^(สรุปรายวัน|รายวัน|daily)$/i.test(text)) {
      await handleSummaryCommand(supabase, lineUserId, "daily");
      return;
    }
    if (/^(สรุปรายเดือน|รายเดือน|monthly)$/i.test(text)) {
      await handleSummaryCommand(supabase, lineUserId, "monthly");
      return;
    }
    if (/^(summary|สรุป)$/i.test(text)) {
      await startSummaryMenuFlow(supabase, lineUserId);
      return;
    }

    // --- Show last 5 transactions (chat and OCR both write to the same
    // transactions table with no source column, so this covers both) ---
    if (/^(show|แสดง|รายการล่าสุด)$/i.test(text)) {
      const { data: showProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("line_user_id", lineUserId)
        .single();

      if (!showProfile) {
        await respond(lineUserId, "ยังไม่ได้เชื่อมต่อบัญชีนะ ไปที่ Settings → Connect LINE ก่อนเลย");
        return;
      }

      const { data: recentTxns } = await supabase
        .from("transactions")
        .select("amount, category, note, type, date")
        .eq("user_id", showProfile.id)
        .order("created_at", { ascending: false })
        .limit(5);

      if (!recentTxns || recentTxns.length === 0) {
        await respond(lineUserId, "ยังไม่มีรายการเลยครับ");
        return;
      }

      await respond(lineUserId, buildRecentTransactionsFlex(recentTxns));
      return;
    }

    // --- View all categories ---
    if (/^(cats|categories)$/i.test(text)) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("line_user_id", lineUserId)
        .single();

      if (!profile) {
        await respond(lineUserId, "ยังไม่ได้เชื่อมต่อบัญชีนะ ไปที่ Settings → Connect LINE ก่อนเลย");
        return;
      }

      await sendCategoryList(supabase, lineUserId, profile.id);
      return;
    }

    // --- Add category guided flow ---
    if (/^cat$/i.test(text)) {
      await startAddCategoryFlow(supabase, lineUserId);
      return;
    }

    // --- Category submenu (Rich Menu "หมวดหมู่" button) ---
    if (/^หมวดหมู่$/i.test(text)) {
      await startCategoryMenuFlow(supabase, lineUserId);
      return;
    }

    // --- Add-rule guided flow (Rich Menu "เพิ่มกฎ" button, or typed directly) ---
    if (/^(เพิ่มกฎ|add rule)$/i.test(text)) {
      await startAddRuleFlow(supabase, lineUserId);
      return;
    }

    // --- Rule creation via chat ---
    // Pattern: "rule chat: keyword = category" or "rule slip: keyword = category"
    const ruleCommandMatch = text.match(/^rule\s+(chat|slip)\s*:\s*(.*)$/i);
    if (ruleCommandMatch) {
      const [, sourceRaw, rest] = ruleCommandMatch;
      const eqIndex = rest.indexOf("=");
      const keyword = eqIndex >= 0 ? rest.slice(0, eqIndex).trim() : "";
      const category = eqIndex >= 0 ? rest.slice(eqIndex + 1).trim() : "";

      if (!keyword || !category) {
        await respond(lineUserId, "รูปแบบไม่ถูกต้องครับ ลองใหม่เป็น: rule chat: ข้าว = food");
        return;
      }

      const source = sourceRaw.toLowerCase() as "chat" | "slip";
      const sourceType = source === "chat" ? "chat" : "ocr";

      const { data: ruleProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("line_user_id", lineUserId)
        .single();

      if (!ruleProfile) {
        await respond(lineUserId, "ยังไม่ได้เชื่อมต่อบัญชีนะ ไปที่ Settings → Connect LINE ก่อนเลย");
        return;
      }

      const { error: ruleError } = await supabase
        .from("category_rules")
        .insert({ user_id: ruleProfile.id, keyword: keyword.toLowerCase(), category, source_type: sourceType });

      if (ruleError) {
        await respond(lineUserId, "บันทึกกฎไม่สำเร็จ ลองใหม่อีกครั้งนะครับ");
      } else {
        await respond(lineUserId, `บันทึกกฎเรียบร้อย! ถ้าเจอ ${keyword} ใน ${source} จะจัดเป็น ${category} ให้ครับ`);
      }
      return;
    }

    // --- Expense recording ---
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name, line_last_response")
      .eq("line_user_id", lineUserId)
      .single();

    if (!profile) {
      await respond(
        lineUserId,
        "Your LINE account is not linked yet. Open the app → Settings → Connect LINE to link it."
      );
      return;
    }

    const { data: cats } = await supabase
      .from("categories")
      .select("name")
      .eq("user_id", profile.id);
    const categoryNames = (cats ?? []).map((c: { name: string }) => c.name);

    const parsed = parseTransaction(text, categoryNames);
    if (!parsed) {
      await respond(lineUserId, randomFormatError());
      return;
    }

    // Smart categorization: scan rawText against the user's chat category_rules
    await applyCategoryRules(supabase, profile.id, text, parsed, "chat");

    const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
    const spender =
      profile.full_name ||
      authUser?.user?.user_metadata?.full_name ||
      authUser?.user?.email?.split("@")[0] ||
      null;

    const date = new Date().toISOString();
    const { data: txData, error: txError } = await supabase
      .from("transactions")
      .insert([{ date, amount: parsed.amount, category: parsed.category, note: parsed.note, spender, user_id: profile.id, type: parsed.type }])
      .select("id");

    if (txError) {
      await respond(lineUserId, "Failed to save. Please try again.");
      return;
    }

    // Save the last transaction ID for edit/delete functionality
    const transactionId = txData?.[0]?.id;
    if (transactionId) {
      await supabase
        .from("profiles")
        .update({ line_last_transaction_id: transactionId })
        .eq("id", profile.id);
    }

    const catLabel = parsed.note ? `${parsed.category} (${parsed.note})` : parsed.category;
    const personality = await pickPersonalityResponse(supabase, parsed.category, parsed.type, profile.id, (profile as Record<string, unknown>).line_last_response as string ?? null);
    await respond(lineUserId, buildSuccessMessage(personality, parsed.amount, catLabel));
}
