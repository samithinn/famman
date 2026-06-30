"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Download, RefreshCw, AlertCircle } from "lucide-react";
import { supabase, Transaction } from "@/lib/supabase";
import RecentTransactions from "./RecentTransactions";

function exportCSV(transactions: Transaction[]) {
  const headers = ["id", "date", "amount", "category", "note", "spender", "created_at"];
  const rows = transactions.map((t) =>
    headers.map((h) => {
      const val = (t as Record<string, unknown>)[h];
      return typeof val === "string" && val.includes(",") ? `"${val}"` : val;
    }).join(",")
  );
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `expenses-all.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface TransactionsViewProps {
  newTransaction: Transaction | null;
  onAddTransaction: () => void;
}

export default function TransactionsView({ newTransaction, onAddTransaction }: TransactionsViewProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filterSpender, setFilterSpender] = useState<"All" | "Husband" | "Wife">("All");

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: err } = await supabase
      .from("transactions").select("*").order("date", { ascending: false });
    if (err) setError(err.message);
    else setTransactions((data as Transaction[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);
  useEffect(() => { if (newTransaction) setTransactions((prev) => [newTransaction, ...prev]); }, [newTransaction]);

  const filtered = transactions.filter((t) => {
    const matchSearch = !search ||
      t.note?.toLowerCase().includes(search.toLowerCase()) ||
      t.category.toLowerCase().includes(search.toLowerCase());
    const matchSpender = filterSpender === "All" || t.spender === filterSpender;
    return matchSearch && matchSpender;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="sticky top-0 z-10 bg-white px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        style={{ borderBottom: "1px solid #f3e8ff" }}
      >
        <div>
          <h1 className="text-lg font-black" style={{ color: "#1f2937" }}>Transactions 💳</h1>
          <p className="text-xs font-semibold mt-0.5" style={{ color: "#9ca3af" }}>
            {filtered.length} records
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onAddTransaction}
            className="text-xs font-extrabold px-4 py-2 rounded-xl"
            style={{ border: "2px solid #f9a8d4", color: "#ec4899", background: "#fff" }}
          >
            + Add
          </button>
          <button
            onClick={() => exportCSV(filtered)}
            className="text-xs font-extrabold px-4 py-2 rounded-xl text-white flex items-center gap-1.5"
            style={{ background: "linear-gradient(135deg, #ec4899, #8b5cf6)" }}
          >
            <Download size={13} /> Export CSV
          </button>
          <button onClick={fetchTransactions} disabled={loading} className="p-2 rounded-xl" style={{ color: "#9ca3af" }}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {error && (
          <div className="flex items-center gap-2 text-sm rounded-xl px-4 py-3" style={{ background: "#fef2f2", color: "#ef4444" }}>
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-2xl p-4 flex flex-col sm:flex-row gap-3" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#c4b5fd" }} />
            <input
              type="text"
              placeholder="Search by note or category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl pl-8 pr-3 py-2 text-sm font-semibold outline-none"
              style={{ border: "2px solid #f3e8ff", color: "#374151" }}
            />
          </div>
          <div className="flex gap-2">
            {(["All", "Husband", "Wife"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilterSpender(s)}
                className="flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-extrabold border-2 transition-all"
                style={
                  filterSpender === s
                    ? s === "Wife"
                      ? { background: "#fce7f3", borderColor: "#f9a8d4", color: "#be185d" }
                      : s === "Husband"
                      ? { background: "#dbeafe", borderColor: "#93c5fd", color: "#1e40af" }
                      : { background: "#f3e8ff", borderColor: "#c4b5fd", color: "#7c3aed" }
                    : { background: "#f9fafb", borderColor: "#f3f4f6", color: "#9ca3af" }
                }
              >
                {s === "Wife" ? "👩 " : s === "Husband" ? "👨 " : ""}{s}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          {loading ? (
            <div className="flex items-center justify-center h-24">
              <span className="loading loading-spinner loading-md" style={{ color: "#a78bfa" }} />
            </div>
          ) : (
            <RecentTransactions transactions={filtered} limit={filtered.length} />
          )}
        </div>
      </div>
    </div>
  );
}
