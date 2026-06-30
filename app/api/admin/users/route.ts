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

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const service = serviceClient();
  const { data: { users }, error } = await service.auth.admin.listUsers();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: profiles } = await service
    .from("profiles")
    .select("id, full_name, role");

  const profileMap = Object.fromEntries(
    (profiles ?? []).map((p: { id: string; full_name: string | null; role: string }) => [p.id, p])
  );

  const result = users.map(u => {
    const p = profileMap[u.id] as { full_name?: string | null; role?: string } | undefined;
    return {
      id: u.id,
      email: u.email ?? "",
      full_name:
        p?.full_name ??
        u.user_metadata?.full_name ??
        u.email?.split("@")[0] ??
        "Unknown",
      role: p?.role ?? "user",
      created_at: u.created_at,
    };
  });

  return NextResponse.json({ users: result });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId, role } = await req.json();
  if (!userId || !["admin", "user"].includes(role)) {
    return NextResponse.json({ error: "Invalid userId or role" }, { status: 400 });
  }
  if (userId === admin.id) {
    return NextResponse.json({ error: "Cannot change your own role" }, { status: 400 });
  }

  const service = serviceClient();
  const { error } = await service.from("profiles").upsert({ id: userId, role });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
