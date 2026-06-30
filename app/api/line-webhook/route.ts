import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

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

function parseExpense(
  text: string,
  categories: string[]
): { amount: number; category: string; note: string } | null {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const amount = Number(parts[0]);
  if (!isFinite(amount) || amount <= 0) return null;
  const catText = parts.slice(1).join(" ");
  const matched = categories.find(c => c.toLowerCase() === catText.toLowerCase());
  // If text matches a category exactly → clean entry; otherwise file under Other with text as note
  return matched
    ? { amount, category: matched, note: "" }
    : { amount, category: "Other", note: catText };
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";

  if (!verifySignature(raw, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: { events?: LineEvent[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true }); // Return 200 so LINE doesn't retry
  }

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
        "Linked! You can now record expenses by sending:\n500 Food & Dining\n350 Transportation\n1200 Shopping"
      );
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

    const parsed = parseExpense(text, categoryNames);
    if (!parsed) {
      await replyToLine(
        replyToken,
        "Format not recognized. Try:\n500 Food & Dining\n350 Transportation\n(amount followed by category)"
      );
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
      .insert([{ date, amount: parsed.amount, category: parsed.category, note: parsed.note, spender, user_id: profile.id }]);

    if (txError) {
      await replyToLine(replyToken, "Failed to save. Please try again.");
      continue;
    }

    const catLabel = parsed.note ? `${parsed.category} (${parsed.note})` : parsed.category;
    await replyToLine(
      replyToken,
      `Saved ✓\n฿${parsed.amount.toLocaleString()} · ${catLabel}\n${date}`
    );
  }

  return NextResponse.json({ ok: true });
}
