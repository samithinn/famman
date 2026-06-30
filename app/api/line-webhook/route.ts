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
    // Fall back to the largest number in the text
    const candidates = [...cleaned.matchAll(/([\d,]+(?:\.\d{1,2})?)/g)]
      .map(m => ({ val: parseFloat(m[0].replace(/,/g, "")), token: m[0] }))
      .filter(c => isFinite(c.val) && c.val > 0);
    if (candidates.length === 0) return null;
    const best = candidates.reduce((a, b) => (b.val > a.val ? b : a));
    amount = best.val;
    rawAmountToken = best.token;
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

async function pickPersonalityResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: ReturnType<typeof serviceClient>,
  category: string
): Promise<string> {
  const FALLBACK = ["บันทึกให้ละจ้า ไม่ต้องบ่นเรื่องเงินเลยนะ!", "จัดไป! บันทึกยอดให้แล้วครับเจ้านาย", "เรียบร้อย! หวังว่าวันนี้จะเหลือเงินกินข้าวนะ"];
  try {
    const { data } = await supabase
      .from("line_responses")
      .select("category, response_text");

    const responses = (data ?? []) as { category: string; response_text: string }[];
    if (responses.length === 0) return FALLBACK[Math.floor(Math.random() * FALLBACK.length)];

    const catLower = category.toLowerCase();
    const matched = responses.filter(
      r => r.category !== "general" && catLower.includes(r.category.toLowerCase())
    );
    const pool = matched.length > 0
      ? matched
      : responses.filter(r => r.category === "general");

    if (pool.length === 0) return FALLBACK[Math.floor(Math.random() * FALLBACK.length)];
    return pool[Math.floor(Math.random() * pool.length)].response_text;
  } catch {
    return FALLBACK[Math.floor(Math.random() * FALLBACK.length)];
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
    .select("id, full_name")
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
    await pushToLine(lineUserId, randomFormatError());
    return NextResponse.json({ error: "Unrecognized format" }, { status: 400 });
  }

  // Smart categorization: scan rawText against the user's category_rules
  if (parsed.category === "Other") {
    const { data: rules } = await supabase
      .from("category_rules")
      .select("keyword, category")
      .eq("user_id", profile.id);
    const lowerText = text.toLowerCase();
    const hit = (rules ?? []).find(
      (r: { keyword: string; category: string }) => lowerText.includes(r.keyword)
    );
    if (hit) parsed.category = hit.category;
  }

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

  const catLabel = parsed.note ? `${parsed.category} (${parsed.note})` : parsed.category;
  const personality = await pickPersonalityResponse(supabase, parsed.category);
  let reply = buildSuccessMessage(personality, parsed.amount, catLabel);
  if (parsed.category === "Other") {
    reply += "\n💡 ยังจัดหมวดไม่ได้ แก้ที่เว็บได้เลยนะ!";
  }
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
    const replyToken = event.replyToken;
    const text = (event.message.text ?? "").trim();

    if (!lineUserId || !replyToken || !text) continue;

    // --- Account linking ---
    if (/^link\s+/i.test(text)) {
      const token = text.replace(/^link\s+/i, "").trim();
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, line_link_token_expires_at")
        .eq("line_link_token", token)
        .single();

      if (!profile) {
        await replyToLine(replyToken, "Invalid link code. Generate a new one in the app → Settings → Connect LINE.");
        continue;
      }
      if (new Date(profile.line_link_token_expires_at) < new Date()) {
        await replyToLine(replyToken, "Link code has expired. Please generate a new one in the app.");
        continue;
      }

      await supabase
        .from("profiles")
        .update({ line_user_id: lineUserId, line_link_token: null, line_link_token_expires_at: null })
        .eq("id", profile.id);

      await replyToLine(
        replyToken,
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
        await replyToLine(replyToken, "ยังไม่ได้เชื่อมต่อบัญชีนะ ไปที่ Settings → Connect LINE ก่อนเลย");
      } else {
        const summary = await buildMonthlySummary(supabase, summaryProfile.id);
        await replyToLine(replyToken, summary);
      }
      continue;
    }

    // --- Expense recording ---
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("line_user_id", lineUserId)
      .single();

    if (!profile) {
      await replyToLine(
        replyToken,
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
      await replyToLine(replyToken, randomFormatError());
      continue;
    }

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
      await replyToLine(replyToken, "Failed to save. Please try again.");
      continue;
    }

    const catLabel = parsed.note ? `${parsed.category} (${parsed.note})` : parsed.category;
    const personality = await pickPersonalityResponse(supabase, parsed.category);
    await replyToLine(replyToken, buildSuccessMessage(personality, parsed.amount, catLabel));
  }

  return NextResponse.json({ ok: true });
}
