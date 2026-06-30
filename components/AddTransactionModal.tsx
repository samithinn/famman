"use client";

import { useState, useEffect } from "react";
import { X, Loader2 } from "lucide-react";
import { supabase, Transaction } from "@/lib/supabase";

const CATEGORIES = [
  "Food & Dining", "Groceries", "Transportation", "Utilities",
  "Healthcare", "Entertainment", "Shopping", "Education", "Travel", "Other",
];

interface AddTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (transaction: Transaction) => void;
}

export default function AddTransactionModal({ isOpen, onClose, onSuccess }: AddTransactionModalProps) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ date: today, amount: "", category: CATEGORIES[0], note: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "Unknown";
      setUsername(name);
    });
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.amount || isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0) {
      setError("Please enter a valid amount.");
      return;
    }
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("Not authenticated. Please sign in again.");
      setLoading(false);
      return;
    }

    const spender = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "Unknown";
    const payload: Record<string, unknown> = {
      date: form.date,
      amount: parseFloat(form.amount),
      category: form.category,
      note: form.note,
      user_id: user.id,
      spender,
    };

    const { data, error: dbError } = await supabase
      .from("transactions")
      .insert([payload])
      .select()
      .single();

    setLoading(false);
    if (dbError) { setError(dbError.message); return; }
    onSuccess(data as Transaction);
    setForm({ date: today, amount: "", category: CATEGORIES[0], note: "" });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 z-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-black" style={{ color: "#1f2937" }}>Add Expense 💳</h2>
            <p className="text-xs font-semibold mt-0.5" style={{ color: "#9ca3af" }}>
              {username ? `Adding as ${username}` : "Record a new transaction"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: "#f3e8ff" }}
          >
            <X size={15} style={{ color: "#7c3aed" }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Date */}
          <div>
            <label className="block text-xs font-extrabold mb-1" style={{ color: "#9ca3af", letterSpacing: "0.8px" }}>DATE</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold outline-none"
              style={{ border: "2px solid #f3e8ff", color: "#374151" }}
              required
            />
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs font-extrabold mb-1" style={{ color: "#9ca3af", letterSpacing: "0.8px" }}>AMOUNT (฿)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold outline-none"
              style={{ border: "2px solid #f3e8ff", color: "#374151" }}
              required
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-extrabold mb-1" style={{ color: "#9ca3af", letterSpacing: "0.8px" }}>CATEGORY</label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold outline-none cursor-pointer"
              style={{ border: "2px solid #f3e8ff", color: "#374151", fontFamily: "Nunito" }}
            >
              {CATEGORIES.map((cat) => <option key={cat}>{cat}</option>)}
            </select>
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-extrabold mb-1" style={{ color: "#9ca3af", letterSpacing: "0.8px" }}>NOTE</label>
            <input
              type="text"
              placeholder="What was this for?"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold outline-none"
              style={{ border: "2px solid #f3e8ff", color: "#374151" }}
            />
          </div>

          {error && (
            <p className="text-xs font-semibold px-3 py-2 rounded-xl" style={{ background: "#fef2f2", color: "#ef4444" }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl text-sm font-extrabold text-white flex items-center justify-center gap-2"
            style={{
              background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
              boxShadow: "0 4px 14px rgba(236,72,153,0.35)",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : "Save Expense 💾"}
          </button>
        </form>
      </div>
    </div>
  );
}
