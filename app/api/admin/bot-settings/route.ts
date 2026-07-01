import { createSupabaseServer } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function requireAdmin() {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return null;
  return user;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const key = new URL(req.url).searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });

  const service = serviceClient();
  const { data, error } = await service
    .from("bot_settings")
    .select("key, value, updated_at")
    .eq("key", key)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ setting: data });
}

export async function PUT(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { key, value } = await req.json();
  if (!key?.trim() || !value?.trim()) {
    return NextResponse.json({ error: "key and value are required" }, { status: 400 });
  }

  const service = serviceClient();
  const { data, error } = await service
    .from("bot_settings")
    .upsert({ key: key.trim(), value: value.trim(), updated_at: new Date().toISOString() })
    .select("key, value, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ setting: data });
}
