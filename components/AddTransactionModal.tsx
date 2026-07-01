"use client";

import { useState, useEffect, useRef } from "react";
import { X, Loader2, Upload } from "lucide-react";
import { supabase, Transaction } from "@/lib/supabase";

const DEFAULT_CATEGORIES = [
  "Food & Dining", "Groceries", "Transportation", "Utilities",
  "Healthcare", "Entertainment", "Shopping", "Education", "Travel", "Other",
];

interface AddTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (transaction: Transaction) => void;
}

type Mode = "manual" | "csv";
type TxType = "expense" | "income";
type CSVRow = { date: string; amount: string; category: string; note: string };

function parseCSV(text: string, allowedCategories: string[]): { rows: CSVRow[]; errors: string[] } {
  const lines = text.trim().split("\n").filter(l => l.trim());
  if (!lines.length) return { rows: [], errors: ["File is empty."] };

  const firstLower = lines[0].toLowerCase();
  const hasHeader = firstLower.includes("date") && firstLower.includes("amount");
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const rows: CSVRow[] = [];
  const errors: string[] = [];
  const categoryByLower = new Map(allowedCategories.map(c => [c.toLowerCase(), c]));

  dataLines.forEach((line, i) => {
    const rowNum = i + (hasHeader ? 2 : 1);
    const parts = line.split(",").map(s => s.trim().replace(/^"|"$/g, ""));
    const [rawDate = "", rawAmount = "", rawCategory = "", rawNote = ""] = parts;
    const matchedCategory = categoryByLower.get(rawCategory.toLowerCase());

    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      errors.push(`Row ${rowNum}: Invalid date "${rawDate}" — use YYYY-MM-DD`);
    }
    const amt = parseFloat(rawAmount);
    if (!rawAmount || isNaN(amt) || amt <= 0) {
      errors.push(`Row ${rowNum}: Invalid amount "${rawAmount}" — must be a positive number`);
    }
    if (!rawCategory || (allowedCategories.length > 0 && !matchedCategory)) {
      errors.push(`Row ${rowNum}: Unknown category "${rawCategory}"`);
    }

    rows.push({ date: rawDate, amount: rawAmount, category: matchedCategory ?? rawCategory, note: rawNote });
  });

  return { rows, errors };
}

async function resolveSpender() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  const spender =
    profile?.full_name ||
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split("@")[0] ||
    null;
  return { user, spender };
}

function localNow() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AddTransactionModal({ isOpen, onClose, onSuccess }: AddTransactionModalProps) {
  const [mode, setMode] = useState<Mode>("manual");
  const [txType, setTxType] = useState<TxType>("expense");
  const [form, setForm] = useState({ date: localNow(), amount: "", category: "", note: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [catLoading, setCatLoading] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const [csvRows, setCsvRows] = useState<CSVRow[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [csvFileName, setCsvFileName] = useState("");
  const [csvLoading, setCsvLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMode("manual");
    setTxType("expense");
    setError("");
    setCsvRows([]);
    setCsvErrors([]);
    setCsvFileName("");
    setForm({ date: localNow(), amount: "", category: "", note: "" });
    resolveSpender().then(result => {
      if (result) setUsername(result.spender);
    });
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isOpen) return;
    loadCategories(txType);
  }, [isOpen, txType]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadCategories(type: TxType) {
    setCatLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setCatLoading(false); return; }
    let { data } = await supabase.from("categories").select("name").eq("type", type).order("name");
    if ((!data || data.length === 0) && type === "expense") {
      await supabase
        .from("categories")
        .insert(DEFAULT_CATEGORIES.map(name => ({ name, user_id: user.id, type: "expense" })));
      const res = await supabase.from("categories").select("name").eq("type", "expense").order("name");
      data = res.data;
    }
    const names = (data ?? []).map((c: { name: string }) => c.name);
    setCategories(names);
    setForm(f => ({ ...f, category: names[0] ?? "" }));
    setCatLoading(false);
  }

  if (!isOpen) return null;

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.amount || isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0) {
      setError("Please enter a valid amount.");
      return;
    }
    setLoading(true);
    const result = await resolveSpender();
    if (!result) { setError("Not authenticated. Please sign in again."); setLoading(false); return; }
    const { user, spender } = result;

    const { data, error: dbError } = await supabase
      .from("transactions")
      .insert([{ date: new Date(form.date).toISOString(), amount: parseFloat(form.amount), category: form.category, note: form.note, user_id: user.id, spender, type: txType }])
      .select()
      .single();

    setLoading(false);
    if (dbError) { setError(dbError.message); return; }
    onSuccess(data as Transaction);
    setForm({ date: localNow(), amount: "", category: categories[0] ?? "", note: "" });
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    setCsvRows([]);
    setCsvErrors([]);
    setError("");
    const reader = new FileReader();
    reader.onload = ev => {
      const { rows, errors } = parseCSV(ev.target?.result as string, categories);
      setCsvRows(rows);
      setCsvErrors(errors);
    };
    reader.readAsText(file);
  };

  const handleCSVImport = async () => {
    if (csvErrors.length > 0 || csvRows.length === 0) return;
    setCsvLoading(true);
    setError("");
    const result = await resolveSpender();
    if (!result) { setError("Not authenticated."); setCsvLoading(false); return; }
    const { user, spender } = result;

    const payload = csvRows.map(row => ({
      date: new Date(`${row.date}T00:00:00`).toISOString(),
      amount: parseFloat(row.amount),
      category: row.category,
      note: row.note,
      user_id: user.id,
      spender,
    }));

    const { data, error: dbError } = await supabase.from("transactions").insert(payload).select();
    setCsvLoading(false);
    if (dbError) { setError(dbError.message); return; }
    if (data && data.length > 0) onSuccess(data[0] as Transaction);
    setCsvRows([]);
    setCsvErrors([]);
    setCsvFileName("");
    if (fileRef.current) fileRef.current.value = "";
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
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-black" style={{ color: "#1f2937" }}>
              {txType === "income" ? "Add Income 💰" : "Add Expense 💳"}
            </h2>
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

        {/* Expense / Income toggle */}
        <div className="flex rounded-xl overflow-hidden mb-3" style={{ border: "2px solid #f3e8ff" }}>
          {(["expense", "income"] as TxType[]).map(t => (
            <button
              key={t}
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

        {/* Mode tabs */}
        <div className="flex rounded-xl overflow-hidden mb-5" style={{ border: "2px solid #f3e8ff" }}>
          {(["manual", "csv"] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(""); }}
              className="flex-1 py-2 text-xs font-extrabold transition-all"
              style={
                mode === m
                  ? { background: "linear-gradient(135deg, #ec4899, #8b5cf6)", color: "#fff" }
                  : { color: "#7c3aed", background: "transparent" }
              }
            >
              {m === "manual" ? "✏️ Manual Entry" : "📁 CSV Import"}
            </button>
          ))}
        </div>

        {mode === "manual" ? (
          <form onSubmit={handleManualSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-extrabold mb-1" style={{ color: "#9ca3af", letterSpacing: "0.8px" }}>DATE & TIME</label>
              <input
                type="datetime-local"
                value={form.date}
                onChange={e => setForm({ ...form, date: e.target.value })}
                className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold outline-none"
                style={{ border: "2px solid #f3e8ff", color: "#374151" }}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-extrabold mb-1" style={{ color: "#9ca3af", letterSpacing: "0.8px" }}>AMOUNT (฿)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={e => setForm({ ...form, amount: e.target.value })}
                className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold outline-none"
                style={{ border: "2px solid #f3e8ff", color: "#374151" }}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-extrabold mb-1" style={{ color: "#9ca3af", letterSpacing: "0.8px" }}>CATEGORY</label>
              <select
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold outline-none cursor-pointer"
                style={{ border: "2px solid #f3e8ff", color: "#374151", fontFamily: "Nunito" }}
                disabled={catLoading}
              >
                {catLoading
                  ? <option>Loading…</option>
                  : categories.map(cat => <option key={cat}>{cat}</option>)
                }
              </select>
            </div>

            <div>
              <label className="block text-xs font-extrabold mb-1" style={{ color: "#9ca3af", letterSpacing: "0.8px" }}>NOTE</label>
              <input
                type="text"
                placeholder="What was this for?"
                value={form.note}
                onChange={e => setForm({ ...form, note: e.target.value })}
                className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold outline-none"
                style={{ border: "2px solid #f3e8ff", color: "#374151" }}
              />
            </div>

            {error && (
              <p className="text-xs font-semibold px-3 py-2 rounded-xl" style={{ background: "#fef2f2", color: "#ef4444" }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || catLoading}
              className="w-full py-3 rounded-xl text-sm font-extrabold text-white flex items-center justify-center gap-2"
              style={{
                background: txType === "income"
                  ? "linear-gradient(135deg, #10b981, #059669)"
                  : "linear-gradient(135deg, #ec4899, #8b5cf6)",
                boxShadow: txType === "income"
                  ? "0 4px 14px rgba(16,185,129,0.35)"
                  : "0 4px 14px rgba(236,72,153,0.35)",
                opacity: loading || catLoading ? 0.7 : 1,
              }}
            >
              {loading ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : txType === "income" ? "Save Income 💾" : "Save Expense 💾"}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            {/* Format hint */}
            <div className="rounded-xl p-3 text-xs" style={{ background: "#f8f4ff", border: "1px solid #e9d5ff", color: "#7c3aed" }}>
              <div className="font-extrabold mb-1">Expected CSV format (columns):</div>
              <code className="font-bold">date, amount, category, note</code>
              <div className="mt-1 opacity-60">e.g. 2026-06-15,350,Food &amp; Dining,Lunch at café</div>
              <div className="mt-1 opacity-60">Header row optional. Note column is optional.</div>
            </div>

            {/* File picker */}
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full py-2.5 rounded-xl text-sm font-extrabold flex items-center justify-center gap-2 transition-all"
              style={{ border: "2px dashed #e9d5ff", color: "#7c3aed", background: "#faf7ff" }}
            >
              <Upload size={16} />
              {csvFileName || "Choose CSV file"}
            </button>

            {/* Validation errors */}
            {csvErrors.length > 0 && (
              <div
                className="rounded-xl p-3 space-y-1 max-h-40 overflow-y-auto"
                style={{ background: "#fef2f2", border: "1px solid #fecaca" }}
              >
                <div className="text-xs font-extrabold mb-1" style={{ color: "#ef4444" }}>
                  {csvErrors.length} validation error{csvErrors.length !== 1 ? "s" : ""} — fix and re-upload
                </div>
                {csvErrors.map((err, i) => (
                  <p key={i} className="text-xs font-semibold" style={{ color: "#ef4444" }}>{err}</p>
                ))}
              </div>
            )}

            {/* Valid rows ready */}
            {csvRows.length > 0 && csvErrors.length === 0 && (
              <div className="rounded-xl px-3 py-2.5" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                <p className="text-xs font-extrabold" style={{ color: "#15803d" }}>
                  ✓ {csvRows.length} row{csvRows.length !== 1 ? "s" : ""} validated — ready to import
                </p>
              </div>
            )}

            {error && (
              <p className="text-xs font-semibold px-3 py-2 rounded-xl" style={{ background: "#fef2f2", color: "#ef4444" }}>{error}</p>
            )}

            <button
              onClick={handleCSVImport}
              disabled={csvRows.length === 0 || csvErrors.length > 0 || csvLoading}
              className="w-full py-3 rounded-xl text-sm font-extrabold text-white flex items-center justify-center gap-2"
              style={{
                background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
                boxShadow: "0 4px 14px rgba(236,72,153,0.35)",
                opacity: csvRows.length === 0 || csvErrors.length > 0 || csvLoading ? 0.4 : 1,
              }}
            >
              {csvLoading
                ? <><Loader2 size={16} className="animate-spin" /> Importing…</>
                : `Import ${csvRows.length || 0} Row${csvRows.length !== 1 ? "s" : ""} 📥`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
