"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Download, RefreshCw, AlertCircle, Loader2 } from "lucide-react";
import { supabase, Transaction } from "@/lib/supabase";
import RecentTransactions from "./RecentTransactions";
import EditTransactionModal from "./EditTransactionModal";
import PullToRefresh from "./PullToRefresh";
import CategoryDropdown, { ALL_CATEGORIES } from "./CategoryDropdown";

function toLocalDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localDate(iso: string) {
  const d = new Date(iso);
  return toLocalDateStr(d);
}

function exportCSV(transactions: Transaction[], spender?: string) {
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
  const filename = spender ? `expenses-${spender.replace(/\s+/g, "-")}.csv` : "expenses-all.csv";
  a.download = filename;
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
  const [currentUser, setCurrentUser] = useState<string>("");
  const [selectedSpender, setSelectedSpender] = useState<string>("current");
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORIES);

  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), i, 1);
    return { value: `${now.getFullYear()}-${String(i + 1).padStart(2, "0")}`, label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
  });
  const [reportMode, setReportMode] = useState<"all" | "monthly" | "daily">("all");
  const [selectedMonth, setSelectedMonth] = useState(months[now.getMonth()].value);
  const [selectedDate, setSelectedDate] = useState(() => toLocalDateStr(new Date()));

  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Only default the filter to "current" on the very first load — later
  // refreshes (e.g. pull-to-refresh) should preserve whatever the user picked.
  const isFirstLoad = useRef(true);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError("");

    // Get current user's name (profiles.full_name is the source of truth;
    // user_metadata is only a fallback since it's rarely populated)
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
      const name = profile?.full_name || user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0];
      if (name) {
        setCurrentUser(name);
        if (isFirstLoad.current) setSelectedSpender("current");
      }
    }
    isFirstLoad.current = false;

    const { data, error: err } = await supabase
      .from("transactions")
      .select("*")
      .order("date", { ascending: false });
    if (err) setError(err.message);
    else setTransactions((data as Transaction[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);
  useEffect(() => { if (newTransaction) setTransactions((prev) => [newTransaction, ...prev]); }, [newTransaction]);

  const handleEditSuccess = (updated: Transaction) => {
    setTransactions((prev) => prev.map((t) => t.id === updated.id ? updated : t));
  };

  const handleDeleteConfirm = async () => {
    if (!deletingTx) return;
    setDeleteLoading(true);
    setDeleteError("");
    const res = await fetch(`/api/transactions/${deletingTx.id}`, { method: "DELETE" });
    setDeleteLoading(false);
    if (!res.ok) {
      const body = await res.json();
      setDeleteError(body.error ?? "Failed to delete transaction.");
      return;
    }
    setTransactions((prev) => prev.filter((t) => t.id !== deletingTx.id));
    setDeletingTx(null);
  };

  // Get unique spenders from all transactions, excluding the current user (already shown as "current")
  const uniqueSpenders = Array.from(new Set(transactions.map((t) => t.spender)))
    .filter((spender) => spender !== currentUser)
    .sort();

  // Apply spender, category, and search filters
  const filtered = transactions.filter((t) => {
    const spenderMatch =
      selectedSpender === "all" ||
      (selectedSpender === "current" && t.spender === currentUser) ||
      (selectedSpender !== "current" && selectedSpender !== "all" && t.spender === selectedSpender);

    const categoryMatch =
      selectedCategory === ALL_CATEGORIES || t.category.toLowerCase() === selectedCategory.toLowerCase();

    const searchMatch =
      !search ||
      t.note?.toLowerCase().includes(search.toLowerCase()) ||
      t.category.toLowerCase().includes(search.toLowerCase());

    return spenderMatch && categoryMatch && searchMatch;
  });

  // Narrow further only when an explicit Month or Day period is picked; "All" leaves it unfiltered
  const isDaily = reportMode === "daily";
  const isMonthly = reportMode === "monthly";
  const periodTx = filtered.filter((t) => {
    if (isDaily) return localDate(t.date) === selectedDate;
    if (isMonthly) return localDate(t.date).startsWith(selectedMonth);
    return true;
  });
  const periodExpenses = periodTx.filter((t) => (t.type ?? "expense") === "expense");
  const periodIncome = periodTx.filter((t) => t.type === "income");
  const periodTotalExpenses = periodExpenses.reduce((s, t) => s + t.amount, 0);
  const periodTotalIncome = periodIncome.reduce((s, t) => s + t.amount, 0);
  const monthLabel = months.find((m) => m.value === selectedMonth)?.label ?? selectedMonth;
  const dailyLabel = new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const periodLabel = isDaily ? dailyLabel : isMonthly ? monthLabel : "All Time";
  const summaryTitle = isDaily ? "Daily Total" : isMonthly ? "Monthly Total" : "All-Time Total";

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
            {periodLabel} · {periodTx.length} records
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* All / Monthly / Daily toggle */}
          <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: "#fafafa", border: "2px solid #f3e8ff" }}>
            <button
              onClick={() => setReportMode("all")}
              className="text-xs font-extrabold px-3 py-1.5 rounded-lg transition-colors"
              style={{
                background: reportMode === "all" ? "linear-gradient(135deg, #ec4899, #8b5cf6)" : "transparent",
                color: reportMode === "all" ? "#fff" : "#9ca3af",
              }}
            >
              All
            </button>
            <button
              onClick={() => setReportMode("monthly")}
              className="text-xs font-extrabold px-3 py-1.5 rounded-lg transition-colors"
              style={{
                background: reportMode === "monthly" ? "linear-gradient(135deg, #ec4899, #8b5cf6)" : "transparent",
                color: reportMode === "monthly" ? "#fff" : "#9ca3af",
              }}
            >
              Monthly
            </button>
            <button
              onClick={() => setReportMode("daily")}
              className="text-xs font-extrabold px-3 py-1.5 rounded-lg transition-colors"
              style={{
                background: reportMode === "daily" ? "linear-gradient(135deg, #ec4899, #8b5cf6)" : "transparent",
                color: reportMode === "daily" ? "#fff" : "#9ca3af",
              }}
            >
              Daily
            </button>
          </div>
          {/* Month or Date selector — only shown once a specific period is picked */}
          {isMonthly && (
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="text-xs font-bold rounded-xl px-3 py-2 cursor-pointer outline-none"
              style={{ border: "2px solid #f3e8ff", color: "#374151", fontFamily: "Nunito" }}
            >
              {months.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          )}
          {isDaily && (
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-xs font-bold rounded-xl px-3 py-2 cursor-pointer outline-none"
              style={{ border: "2px solid #f3e8ff", color: "#374151", fontFamily: "Nunito" }}
            />
          )}
          {/* Category filter */}
          <CategoryDropdown value={selectedCategory} onChange={setSelectedCategory} />
          <button
            onClick={onAddTransaction}
            className="text-xs font-extrabold px-4 py-2 rounded-xl"
            style={{ border: "2px solid #f9a8d4", color: "#ec4899", background: "#fff" }}
          >
            + Add
          </button>
          <button
            onClick={() => {
              const spenderLabel =
                selectedSpender === "all" ? "all" :
                selectedSpender === "current" ? currentUser :
                selectedSpender;
              exportCSV(periodTx, spenderLabel);
            }}
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

      <PullToRefresh onRefresh={fetchTransactions} className="flex-1 overflow-y-auto p-5 space-y-4">
        {error && (
          <div className="flex items-center gap-2 text-sm rounded-xl px-4 py-3" style={{ background: "#fef2f2", color: "#ef4444" }}>
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* Search and Filter */}
        <div className="space-y-3">
          {/* Search */}
          <div className="bg-white rounded-2xl p-4" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
            <div className="relative">
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
          </div>

          {/* Spender Filter */}
          {uniqueSpenders.length > 0 && (
            <div className="bg-white rounded-2xl p-4" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
              <label className="text-xs font-semibold mb-2 block" style={{ color: "#6b7280" }}>View by Spender:</label>
              <select
                value={selectedSpender}
                onChange={(e) => setSelectedSpender(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm font-semibold outline-none"
                style={{ border: "2px solid #f3e8ff", color: "#374151" }}
              >
                <option value="current">{currentUser || "Current User"}</option>
                {uniqueSpenders.map((spender) => (
                  <option key={spender} value={spender}>
                    {spender}
                  </option>
                ))}
                <option value="all">All Users</option>
              </select>
            </div>
          )}
        </div>

        {/* Summary: totals for the currently filtered/period view */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div className="px-5 py-4">
            <h2 className="text-sm font-black" style={{ color: "#1f2937" }}>
              {summaryTitle} — {periodLabel}
            </h2>
          </div>
          <table className="w-full border-collapse">
            <tbody>
              <tr style={{ borderTop: "1px solid #fdf2f8" }}>
                <td className="py-3 px-5 text-xs font-extrabold" style={{ color: "#9ca3af" }}>Income</td>
                <td className="py-3 px-5 text-sm font-black text-right" style={{ color: "#10b981" }}>
                  ฿{periodTotalIncome.toFixed(2)}
                </td>
              </tr>
              <tr style={{ borderTop: "1px solid #fdf2f8" }}>
                <td className="py-3 px-5 text-xs font-extrabold" style={{ color: "#9ca3af" }}>Expenses</td>
                <td className="py-3 px-5 text-sm font-black text-right" style={{ color: "#1f2937" }}>
                  ฿{periodTotalExpenses.toFixed(2)}
                </td>
              </tr>
              <tr style={{ borderTop: "2px solid #f3e8ff" }}>
                <td className="py-3 px-5 text-xs font-extrabold" style={{ color: "#7c3aed" }}>Net</td>
                <td
                  className="py-3 px-5 text-sm font-black text-right"
                  style={{ color: periodTotalIncome - periodTotalExpenses >= 0 ? "#10b981" : "#ef4444" }}
                >
                  ฿{(periodTotalIncome - periodTotalExpenses).toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          {loading ? (
            <div className="flex items-center justify-center h-24">
              <span className="loading loading-spinner loading-md" style={{ color: "#a78bfa" }} />
            </div>
          ) : (
            <RecentTransactions
              transactions={periodTx}
              limit={periodTx.length}
              onEdit={setEditingTx}
              onDelete={setDeletingTx}
            />
          )}
        </div>
      </PullToRefresh>

      {/* Edit modal */}
      {editingTx && (
        <EditTransactionModal
          transaction={editingTx}
          onClose={() => setEditingTx(null)}
          onSuccess={handleEditSuccess}
        />
      )}

      {/* Delete confirmation dialog */}
      {deletingTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)" }}
            onClick={() => { setDeletingTx(null); setDeleteError(""); }}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 z-10">
            <div className="text-center mb-5">
              <div className="text-4xl mb-3">🗑️</div>
              <h2 className="text-base font-black" style={{ color: "#1f2937" }}>Delete Transaction?</h2>
              <p className="text-xs font-semibold mt-2" style={{ color: "#6b7280" }}>
                <span className="font-extrabold" style={{ color: "#374151" }}>{deletingTx.category}</span>
                {" · "}฿{deletingTx.amount.toFixed(2)}
                {deletingTx.note ? ` · "${deletingTx.note}"` : ""}
              </p>
              <p className="text-xs font-semibold mt-1" style={{ color: "#9ca3af" }}>This cannot be undone.</p>
            </div>

            {deleteError && (
              <p className="text-xs font-semibold px-3 py-2 rounded-xl mb-4" style={{ background: "#fef2f2", color: "#ef4444" }}>
                {deleteError}
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setDeletingTx(null); setDeleteError(""); }}
                disabled={deleteLoading}
                className="flex-1 py-2.5 rounded-xl text-sm font-extrabold border-2 transition-all"
                style={{ borderColor: "#f3e8ff", color: "#7c3aed", background: "#fff" }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleteLoading}
                className="flex-1 py-2.5 rounded-xl text-sm font-extrabold text-white flex items-center justify-center gap-2"
                style={{
                  background: "#ef4444",
                  boxShadow: "0 4px 12px rgba(239,68,68,0.3)",
                  opacity: deleteLoading ? 0.7 : 1,
                }}
              >
                {deleteLoading ? <><Loader2 size={14} className="animate-spin" /> Deleting…</> : "Yes, Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
