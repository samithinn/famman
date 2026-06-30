"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ArrowLeft, CheckCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function ProfilePage() {
  const router = useRouter();
  const [form, setForm] = useState({ full_name: "", dob: "", photo_url: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUserEmail(user.email || "");
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (profile) {
        setForm({
          full_name: profile.full_name || "",
          dob: profile.dob || "",
          photo_url: profile.photo_url || "",
        });
      }
      setLoading(false);
    };
    load();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not authenticated."); setSaving(false); return; }
    const { error: dbError } = await supabase.from("profiles").upsert({
      id: user.id,
      full_name: form.full_name || null,
      dob: form.dob || null,
      photo_url: form.photo_url || null,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (dbError) { setError(dbError.message); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#fafafa" }}>
        <Loader2 size={32} className="animate-spin" style={{ color: "#8b5cf6" }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 flex flex-col items-center" style={{ background: "linear-gradient(135deg, #fdf4ff 0%, #fce7f3 100%)" }}>
      <div className="w-full max-w-md mt-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => router.push("/")}
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: "#f3e8ff" }}
          >
            <ArrowLeft size={18} style={{ color: "#7c3aed" }} />
          </button>
          <div>
            <h1 className="text-xl font-black" style={{ color: "#1f2937" }}>My Profile 👤</h1>
            <p className="text-xs font-semibold" style={{ color: "#9ca3af" }}>{userEmail}</p>
          </div>
        </div>

        {/* Avatar preview */}
        {form.photo_url && (
          <div className="flex justify-center mb-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={form.photo_url}
              alt="Profile"
              className="w-20 h-20 rounded-full object-cover"
              style={{ border: "3px solid #e9d5ff", boxShadow: "0 4px 12px rgba(139,92,246,0.2)" }}
            />
          </div>
        )}

        {/* Form card */}
        <div className="bg-white rounded-2xl shadow-xl p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-extrabold mb-1" style={{ color: "#9ca3af", letterSpacing: "0.8px" }}>
                FULL NAME
              </label>
              <input
                type="text"
                placeholder="Your display name"
                value={form.full_name}
                onChange={e => setForm({ ...form, full_name: e.target.value })}
                className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold outline-none"
                style={{ border: "2px solid #f3e8ff", color: "#374151" }}
              />
              <p className="text-xs mt-1" style={{ color: "#c4b5fd" }}>
                This name appears on all your transactions.
              </p>
            </div>

            <div>
              <label className="block text-xs font-extrabold mb-1" style={{ color: "#9ca3af", letterSpacing: "0.8px" }}>
                DATE OF BIRTH
              </label>
              <input
                type="date"
                value={form.dob}
                onChange={e => setForm({ ...form, dob: e.target.value })}
                className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold outline-none"
                style={{ border: "2px solid #f3e8ff", color: "#374151" }}
              />
            </div>

            <div>
              <label className="block text-xs font-extrabold mb-1" style={{ color: "#9ca3af", letterSpacing: "0.8px" }}>
                PHOTO URL
              </label>
              <input
                type="url"
                placeholder="https://example.com/photo.jpg"
                value={form.photo_url}
                onChange={e => setForm({ ...form, photo_url: e.target.value })}
                className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold outline-none"
                style={{ border: "2px solid #f3e8ff", color: "#374151" }}
              />
            </div>

            {error && (
              <p className="text-xs font-semibold px-3 py-2 rounded-xl" style={{ background: "#fef2f2", color: "#ef4444" }}>
                {error}
              </p>
            )}

            {saved && (
              <div className="flex items-center gap-2 text-xs font-extrabold px-3 py-2 rounded-xl" style={{ background: "#f0fdf4", color: "#15803d" }}>
                <CheckCircle size={14} /> Profile saved successfully!
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full py-3 rounded-xl text-sm font-extrabold text-white flex items-center justify-center gap-2"
              style={{
                background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
                boxShadow: "0 4px 14px rgba(236,72,153,0.35)",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : "Save Profile 💾"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
