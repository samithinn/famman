import { createSupabaseServer } from "@/lib/supabase-server";
import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("profiles")
    .select("line_user_id, line_link_token, line_link_token_expires_at")
    .eq("id", user.id)
    .single();

  return NextResponse.json({
    linked: !!data?.line_user_id,
    token: data?.line_link_token ?? null,
    expires: data?.line_link_token_expires_at ?? null,
  });
}

async function getBotBasicId(): Promise<string | null> {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) return null;
  try {
    const res = await fetch("https://api.line.me/v2/bot/info", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.basicId as string | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function POST() {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = randomBytes(4).toString("hex").toUpperCase();
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, line_link_token: token, line_link_token_expires_at: expires });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const botBasicId = await getBotBasicId();
  return NextResponse.json({ token, expires, botBasicId });
}

export async function DELETE() {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("profiles")
    .update({ line_user_id: null, line_link_token: null, line_link_token_expires_at: null })
    .eq("id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
