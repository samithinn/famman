import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { buildMonthlySummary, pushToLine } from "@/lib/line-utils";

type LineSource = { userId?: string; type: string };
type LineMessage = { type: string; text?: string };
type LineEvent = {
  type: string;
  replyToken?: string;
  source?: LineSource;
  message?: LineMessage;
};

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
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

async function replyToLine(replyToken: string, text: string): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return;
  try {
    await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
    });
  } catch {
    // Reply failure is non-fatal — transaction already saved
  }
}

function parseTransaction(
  text: string,
  categories: string[]
): { amount: number; category: string; note: string; type: "expense" | "income" } | null {
  const trimmed = text.trim();
  const isIncome = trimmed.startsWith("+");
  const raw = isIncome ? trimmed.slice(1).trim() : trimmed;
  const type: "expense" | "income" = isIncome ? "income" : "expense";

  // Fast path: original format "<number> [category] [note]"
  const parts = raw.split(/\s+/);
  const firstNum = Number(parts[0]);
  if (isFinite(firstNum) && firstNum > 0) {
    if (parts.length === 1) return { amount: firstNum, category: "Other", note: "", type };
    const maybeCategory = parts[1];
    const matched = categories.find(c => c.toLowerCase() === maybeCategory.toLowerCase());
    return matched
      ? { amount: firstNum, category: matched, note: parts.slice(2).join(" "), type }
      : { amount: firstNum, category: "Other", note: parts.slice(1).join(" "), type };
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

  if (bahtMatch) {
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
async function applyCategoryRules(
  supabase: ReturnType<typeof serviceClient>,
  profileId: string,
  rawText: string,
  parsed: { amount: number; category: string; note: string; type: "expense" | "income" }
): Promise<void> {
  if (parsed.category !== "Other") {
    console.log(`[category-rules] category already resolved to "${parsed.category}" — skipping rule check`);
    return;
  }

  const { data: rules, error } = await supabase
    .from("category_rules")
    .select("keyword, category")
    .eq("user_id", profileId);

  if (error) {
    console.log("[category-rules] failed to load category_rules:", error.message);
    return;
  }

  const lowerText = rawText.toLowerCase();
  const hit = (rules ?? []).find(
    (r: { keyword: string; category: string }) => lowerText.includes(r.keyword.toLowerCase())
  );

  if (hit) {
    console.log(
      `[category-rules] matched keyword "${hit.keyword}" in "${rawText}" -> category "${hit.category}" (was "Other")`
    );
    parsed.category = hit.category;
  } else {
    console.log(`[category-rules] no keyword match in "${rawText}" among ${(rules ?? []).length} rule(s) — keeping "Other"`);
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
  "พิมพ์อะไรมาเนี่ยยย อ่านไม่ออกโว้ย! 😅 พิมพ์ยอดเงินขึ้นมาก่อนสิเจ้านาย เช่น '500 food' เอาใหม่ๆ!",
  "โอ๊ยยย บอทสับสน! 😵‍💫 จะให้บันทึกกี่บาทก็พิมพ์ตัวเลขมานำหน้าก่อนเลยครับพี่! ลองพิมพ์ใหม่นะ เช่น '50 กาแฟ'",
  "เห้ยๆ พิมพ์ผิดป่าว! บอทรับได้แค่ [ตัวเลข] ตามด้วย [หมวดหมู่/โน้ต] นะจ๊ะ 😤 เช่น '120 food' เข้าใจมะ? ลองใหม่!",
  "อ่านไม่ออกจ้าาา ภาษามนุษย์ต่างดาวปะเนี่ย? 👽 พิมพ์ยอดเงินเป็นตัวเลขมาก่อนเลย! เช่น '300 fuel'",
  "ใจเย็นๆ ลูกพี่! ค่อยๆ พิมพ์นะ... เอา 'ตัวเลข' ขึ้นก่อน แล้วเว้นวรรคตามด้วย 'คำอธิบาย' นะครับ เช่น '200 ช้อปปิ้ง' ลองใหม่นะจ๊ะ!",
];

function randomFormatError(): string {
  return FORMAT_ERROR_MESSAGES[Math.floor(Math.random() * FORMAT_ERROR_MESSAGES.length)];
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

function extractRecipientName(rawText: string, senderName: string | null): string | null {
  const lines = rawText.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);

  // Priority 1: explicit "ผู้รับโอน" label — inline or next line
  for (let i = 0; i < lines.length; i++) {
    const inlineMatch = lines[i].match(/ผู้รับโอน[:\s]+(.+)/);
    if (inlineMatch) return inlineMatch[1].trim();
    if (lines[i] === "ผู้รับโอน" && lines[i + 1]) return lines[i + 1].trim();
  }

  // Priority 2: line after "ไปยัง" that has a Thai honorific
  for (let i = 0; i < lines.length; i++) {
    if (/^ไปยัง/.test(lines[i]) && lines[i + 1]) {
      const next = lines[i + 1].trim();
      if (/^(นาย|นาง(?:สาว)?)/.test(next)) return next;
    }
  }

  const isSender = (line: string) =>
    senderName ? line === senderName || line.includes(senderName) : false;

  // Priority 3: Thai honorifics, excluding the sender
  for (const line of lines) {
    if (/^(นาย|นาง(?:สาว)?)\s*[฀-๿a-zA-Z]/.test(line) && !isSender(line)) return line;
  }

  // Priority 4: company / partnership
  for (const line of lines) {
    if (/^(บริษัท|ห้างหุ้นส่วน)/.test(line)) return line;
  }

  // Priority 5: ALL-CAPS English merchant name
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
  isOther: boolean
): string {
  const recipient = recipientName ?? "ร้านค้า/ผู้รับ";
  let msg = `${personality}\nยอด: ฿${amount.toLocaleString()}\nโอนให้: ${recipient}\nหมวด: ${category}`;
  if (isOther) msg += `\n💡 ยังจัดหมวดไม่ได้ แก้ที่เว็บได้เลยนะ!`;
  return msg;
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
  body: { userId: string; rawText: string }
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

  const parsed = parseTransaction(text, categoryNames);
  if (!parsed) {
    console.log("[shortcut] parseTransaction failed. rawText:", JSON.stringify(text));
    await pushToLine(lineUserId, randomFormatError());
    return NextResponse.json({ error: "Unrecognized format", receivedText: text }, { status: 400 });
  }

  // Smart categorization: scan rawText against the user's category_rules
  await applyCategoryRules(supabase, profile.id, text, parsed);

  const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
  const spender =
    profile.full_name ||
    authUser?.user?.user_metadata?.full_name ||
    authUser?.user?.email?.split("@")[0] ||
    null;

  const date = new Date().toISOString();
  const { error: txError } = await supabase
    .from("transactions")
    .insert([{ date, amount: parsed.amount, category: parsed.category, note: parsed.note, spender, user_id: profile.id, type: parsed.type }]);

  if (txError) {
    return NextResponse.json({ error: txError.message }, { status: 500 });
  }

  const personality = await pickPersonalityResponse(supabase, parsed.category, parsed.type, profile.id, profile.line_last_response ?? null);
  const recipientName = extractRecipientName(text, spender);
  const reply = buildShortcutReply(personality, parsed.amount, parsed.category, recipientName, parsed.category === "Other");
  await pushToLine(lineUserId, reply);

  return NextResponse.json({ ok: true });
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
    return handleShortcutRequest(req, bodyJson as { userId: string; rawText: string });
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
    if (event.type !== "message" || event.message?.type !== "text") continue;
    const lineUserId = event.source?.userId;
    const text = (event.message.text ?? "").trim();

    if (!lineUserId || !text) continue;

    // --- Account linking ---
    if (/^link\s+/i.test(text)) {
      const token = text.replace(/^link\s+/i, "").trim();
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, line_link_token_expires_at")
        .eq("line_link_token", token)
        .single();

      if (!profile) {
        await pushToLine(lineUserId, "Invalid link code. Generate a new one in the app → Settings → Connect LINE.");
        continue;
      }
      if (new Date(profile.line_link_token_expires_at) < new Date()) {
        await pushToLine(lineUserId, "Link code has expired. Please generate a new one in the app.");
        continue;
      }

      await supabase
        .from("profiles")
        .update({ line_user_id: lineUserId, line_link_token: null, line_link_token_expires_at: null })
        .eq("id", profile.id);

      await pushToLine(
        lineUserId,
        "Linked! You can now record transactions by sending:\n500 Food & Dining  (expense)\n350 Transportation  (expense)\n+5000 Salary  (income — use + prefix)\n\nSend \"summary\" or \"สรุป\" anytime to see this month's stats 📊"
      );
      continue;
    }

    // --- Summary command ---
    if (/^(summary|สรุป)$/i.test(text)) {
      const { data: summaryProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("line_user_id", lineUserId)
        .single();
      if (!summaryProfile) {
        await pushToLine(lineUserId, "ยังไม่ได้เชื่อมต่อบัญชีนะ ไปที่ Settings → Connect LINE ก่อนเลย");
      } else {
        const summary = await buildMonthlySummary(supabase, summaryProfile.id);
        await pushToLine(lineUserId, summary);
      }
      continue;
    }

    // --- Expense recording ---
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name, line_last_response")
      .eq("line_user_id", lineUserId)
      .single();

    if (!profile) {
      await pushToLine(
        lineUserId,
        "Your LINE account is not linked yet. Open the app → Settings → Connect LINE to link it."
      );
      continue;
    }

    const { data: cats } = await supabase
      .from("categories")
      .select("name")
      .eq("user_id", profile.id);
    const categoryNames = (cats ?? []).map((c: { name: string }) => c.name);

    const parsed = parseTransaction(text, categoryNames);
    if (!parsed) {
      await pushToLine(lineUserId, randomFormatError());
      continue;
    }

    // Smart categorization: scan rawText against the user's category_rules
    await applyCategoryRules(supabase, profile.id, text, parsed);

    const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
    const spender =
      profile.full_name ||
      authUser?.user?.user_metadata?.full_name ||
      authUser?.user?.email?.split("@")[0] ||
      null;

    const date = new Date().toISOString().split("T")[0];
    const { error: txError } = await supabase
      .from("transactions")
      .insert([{ date, amount: parsed.amount, category: parsed.category, note: parsed.note, spender, user_id: profile.id, type: parsed.type }]);

    if (txError) {
      await pushToLine(lineUserId, "Failed to save. Please try again.");
      continue;
    }

    const catLabel = parsed.note ? `${parsed.category} (${parsed.note})` : parsed.category;
    const personality = await pickPersonalityResponse(supabase, parsed.category, parsed.type, profile.id, (profile as Record<string, unknown>).line_last_response as string ?? null);
    await pushToLine(lineUserId, buildSuccessMessage(personality, parsed.amount, catLabel));
  }

  return NextResponse.json({ ok: true });
}
