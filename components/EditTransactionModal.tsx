"use client";

import { useState, useEffect } from "react";
import { X, Loader2 } from "lucide-react";
import { supabase, Transaction } from "@/lib/supabase";

interface EditTransactionModalProps {
  transaction: Transaction;
  onClose: () => void;
  onSuccess: (updated: Transaction) => void;
}

export default function EditTransactionModal({ transaction, onClose, onSuccess }: EditTransactionModalProps) {
  const [form, setForm] = useState({
    date: transaction.date,
    amount: String(transaction.amount),
    category: transaction.category,
    note: transaction.note ?? "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [catLoading, setCatLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("categories")
      .select("name")
      .order("name")
      .then(({ data }) => {
        const names = (data ?? []).map((c: { name: string }) => c.name);
        // Include the existing category even if it was removed from the list
        if (transaction.category && !names.includes(transaction.category)) {
          names.unshift(transaction.category);
        }
        setCategories(names);
        setCatLoading(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const amount = parseFloat(form.amount);
    if (!form.amount || isNaN(amount) || amount <= 0) {
      setError("Please enter a valid amount.");
      return;
    }
    setLoading(true);
    const res = await fetch(`/api/transactions/${transaction.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: form.date, amount, category: form.category, note: form.note }),
    });
    setLoading(false);
    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? "Failed to update transaction.");
      return;
    }
    const { transaction: updated } = await res.json();
    onSuccess(updated as Transaction);
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
            <h2 className="text-lg font-black" style={{ color: "#1f2937" }}>Edit Expense ✏️</h2>
            <p className="text-xs font-semibold mt-0.5" style={{ color: "#9ca3af" }}>Update transaction details</p>
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
              disabled={catLoading}
            >
              {catLoading
                ? <option>{transaction.category}</option>
                : categories.map((cat) => <option key={cat}>{cat}</option>)
              }
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
            {loading ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : "Save Changes 💾"}
          </button>
        </form>
      </div>
    </div>
  );
}
