"use client";

import { useState, useEffect } from "react";
import { X, Loader2, BookmarkPlus } from "lucide-react";
import { supabase, Transaction } from "@/lib/supabase";

interface EditTransactionModalProps {
  transaction: Transaction;
  onClose: () => void;
  onSuccess: (updated: Transaction) => void;
}

function toDatetimeLocal(isoStr: string): string {
  const d = new Date(isoStr.includes("T") ? isoStr : isoStr + "T00:00:00");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EditTransactionModal({ transaction, onClose, onSuccess }: EditTransactionModalProps) {
  const [txType, setTxType] = useState<"expense" | "income">(transaction.type ?? "expense");
  const [form, setForm] = useState({
    date: toDatetimeLocal(transaction.date),
    amount: String(transaction.amount),
    category: transaction.category,
    note: transaction.note ?? "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [categories, setCategories] = useState<string[]>([]);

  const [showSaveRule, setShowSaveRule] = useState(false);
  const [ruleKeyword, setRuleKeyword] = useState("");
  const [ruleLoading, setRuleLoading] = useState(false);
  const [ruleError, setRuleError] = useState("");
  const [ruleSaved, setRuleSaved] = useState(false);
  const [catLoading, setCatLoading] = useState(true);

  useEffect(() => {
    setCatLoading(true);
    supabase
      .from("categories")
      .select("name")
      .eq("type", txType)
      .order("name")
      .then(({ data }) => {
        const names = (data ?? []).map((c: { name: string }) => c.name);
        // Include the existing category even if it was removed from the list
        const hasExisting = names.some(n => n.toLowerCase() === transaction.category?.toLowerCase());
        if (txType === (transaction.type ?? "expense") && transaction.category && !hasExisting) {
          names.unshift(transaction.category);
        }
        setCategories(names);
        setForm(f => {
          const match = names.find(n => n.toLowerCase() === f.category.toLowerCase());
          return match ? { ...f, category: match } : { ...f, category: names[0] ?? "" };
        });
        setCatLoading(false);
      });
  }, [txType]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveRule = async () => {
    if (!ruleKeyword.trim()) return;
    setRuleLoading(true);
    setRuleError("");
    const res = await fetch("/api/category-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: ruleKeyword.trim(), category: form.category, source_type: "ocr" }),
    });
    setRuleLoading(false);
    if (!res.ok) {
      const body = await res.json();
      setRuleError(body.error ?? "Failed to save rule.");
    } else {
      setRuleSaved(true);
      setTimeout(() => { setShowSaveRule(false); setRuleSaved(false); }, 1500);
    }
  };

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
      body: JSON.stringify({ date: new Date(form.date).toISOString(), amount, category: form.category, note: form.note, type: txType }),
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

        {/* Expense / Income toggle */}
        <div className="flex rounded-xl overflow-hidden mb-5" style={{ border: "2px solid #f3e8ff" }}>
          {(["expense", "income"] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTxType(t)}
              className="flex-1 py-2 text-xs font-extrabold transition-all"
              style={
                txType === t
                  ? {
                      background: t === "income"
                        ? "linear-gradient(135deg, #10b981, #059669)"
                        : "linear-gradient(135deg, #ec4899, #8b5cf6)",
                      color: "#fff",
                    }
                  : { color: "#7c3aed", background: "transparent" }
              }
            >
              {t === "income" ? "💰 Income" : "💳 Expense"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Date */}
          <div>
            <label className="block text-xs font-extrabold mb-1" style={{ color: "#9ca3af", letterSpacing: "0.8px" }}>DATE & TIME</label>
            <input
              type="datetime-local"
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

          {/* Save as Rule */}
          <div>
            {!showSaveRule ? (
              <button
                type="button"
                onClick={() => { setShowSaveRule(true); setRuleKeyword(form.note.trim()); setRuleError(""); }}
                className="text-xs font-semibold flex items-center gap-1.5 px-1"
                style={{ color: "#8b5cf6" }}
              >
                <BookmarkPlus size={13} />
                Save as auto-categorization rule
              </button>
            ) : (
              <div className="rounded-xl p-3 space-y-2.5" style={{ background: "#f3e8ff", border: "1px solid #ddd6fe" }}>
                <p className="text-xs font-extrabold" style={{ color: "#7c3aed" }}>💡 SAVE AS RULE</p>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: "#7c3aed" }}>Keyword to match in receipt text</label>
                  <input
                    type="text"
                    value={ruleKeyword}
                    onChange={e => setRuleKeyword(e.target.value)}
                    placeholder="e.g. ข้าว, coffee, grab"
                    className="w-full rounded-lg px-3 py-2 text-xs font-semibold outline-none"
                    style={{ border: "1.5px solid #ddd6fe", color: "#374151", background: "#fff" }}
                  />
                </div>
                <p className="text-xs font-semibold" style={{ color: "#6d28d9" }}>
                  → will auto-assign to <strong>{form.category}</strong>
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSaveRule}
                    disabled={ruleLoading || !ruleKeyword.trim()}
                    className="flex-1 py-2 rounded-lg text-xs font-extrabold text-white"
                    style={{ background: "linear-gradient(135deg, #8b5cf6, #7c3aed)", opacity: ruleLoading || !ruleKeyword.trim() ? 0.6 : 1 }}
                  >
                    {ruleLoading ? "Saving…" : "Save Rule"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowSaveRule(false); setRuleError(""); setRuleSaved(false); }}
                    className="px-4 py-2 rounded-lg text-xs font-extrabold"
                    style={{ background: "#ede9fe", color: "#7c3aed" }}
                  >
                    Cancel
                  </button>
                </div>
                {ruleError && <p className="text-xs font-semibold" style={{ color: "#ef4444" }}>{ruleError}</p>}
                {ruleSaved && <p className="text-xs font-bold" style={{ color: "#10b981" }}>✓ Rule saved!</p>}
              </div>
            )}
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
