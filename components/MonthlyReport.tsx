"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { RefreshCw, AlertCircle } from "lucide-react";
import { supabase, Transaction } from "@/lib/supabase";
import SpendingChart from "./SpendingChart";
import RecentTransactions from "./RecentTransactions";
import PullToRefresh from "./PullToRefresh";

const PIE_COLORS = [
  "#a78bfa", "#f9a8d4", "#6ee7b7", "#fcd34d", "#93c5fd",
  "#fca5a5", "#c4b5fd", "#86efac", "#fdba74", "#67e8f9",
];

function buildPieData(transactions: Transaction[]) {
  const totals: Record<string, number> = {};
  transactions.forEach((t) => { totals[t.category] = (totals[t.category] ?? 0) + t.amount; });
  return Object.entries(totals)
    .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value);
}

function exportCSV(transactions: Transaction[], monthValue: string) {
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
  a.download = `expenses-${monthValue}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface MonthlyReportProps {
  newTransaction: Transaction | null;
}

export default function MonthlyReport({ newTransaction }: MonthlyReportProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), i, 1);
    return { value: `${now.getFullYear()}-${String(i + 1).padStart(2, "0")}`, label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
  });
  const [selectedMonth, setSelectedMonth] = useState(months[now.getMonth()].value);
  const [currentUser, setCurrentUser] = useState<string>("");
  const [selectedSpender, setSelectedSpender] = useState("current");

  // Only default the filter to "current" on the very first load — later
  // refreshes (e.g. pull-to-refresh) should preserve whatever the user picked.
  const isFirstLoad = useRef(true);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError("");

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
      .order("date", { ascending: false })
      .order("created_at", { ascending: false });
    if (err) setError(err.message);
    else setTransactions((data as Transaction[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);
  useEffect(() => { if (newTransaction) setTransactions((prev) => [newTransaction, ...prev]); }, [newTransaction]);

  const spenders = Array.from(new Set(transactions.map((t) => t.spender).filter(Boolean)));
  const spenderFiltered =
    selectedSpender === "all" ? transactions :
    selectedSpender === "current" ? transactions.filter((t) => t.spender === currentUser) :
    transactions.filter((t) => t.spender === selectedSpender);
  const monthlyTx = spenderFiltered.filter((t) =>
    t.date >= `${selectedMonth}-01` && t.date <= `${selectedMonth}-31`
  );

  const monthlyExpenses = monthlyTx.filter((t) => (t.type ?? "expense") === "expense");
  const monthlyIncome = monthlyTx.filter((t) => t.type === "income");
  const totalExpenses = monthlyExpenses.reduce((s, t) => s + t.amount, 0);
  const totalIncome = monthlyIncome.reduce((s, t) => s + t.amount, 0);

  const pieData = buildPieData(monthlyExpenses);
  const monthLabel = months.find((m) => m.value === selectedMonth)?.label ?? selectedMonth;

  return (
    <div className="flex flex-col h-full">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-10 bg-white px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        style={{ borderBottom: "1px solid #f3e8ff" }}
      >
        <div>
          <h1 className="text-lg font-black" style={{ color: "#1f2937", letterSpacing: "-0.5px" }}>
            Monthly Report 📈
          </h1>
          <p className="text-xs font-semibold mt-0.5" style={{ color: "#9ca3af" }}>
            {monthLabel} · {monthlyTx.length} transactions ({monthlyExpenses.length} expenses, {monthlyIncome.length} income)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Month selector */}
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
          {/* Spender filter */}
          <select
            value={selectedSpender}
            onChange={(e) => setSelectedSpender(e.target.value)}
            className="text-xs font-bold rounded-xl px-3 py-2 cursor-pointer outline-none"
            style={{ border: "2px solid #f3e8ff", color: "#374151", fontFamily: "Nunito" }}
          >
            <option value="current">{currentUser || "Current User"}</option>
            {spenders.filter((s) => s !== currentUser).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
            <option value="all">All spenders</option>
          </select>
          {/* Export CSV */}
          <button
            onClick={() => exportCSV(monthlyTx, selectedMonth)}
            className="text-xs font-extrabold px-4 py-2 rounded-xl text-white flex items-center gap-1.5"
            style={{
              background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
              boxShadow: "0 3px 12px rgba(236,72,153,0.35)",
            }}
          >
            📥 Export CSV
          </button>
          {/* Refresh */}
          <button
            onClick={fetchTransactions}
            disabled={loading}
            className="p-2 rounded-xl"
            style={{ color: "#9ca3af" }}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <PullToRefresh onRefresh={fetchTransactions} className="flex-1 overflow-y-auto p-5 space-y-4">
        {error && (
          <div
            className="flex items-center gap-2 text-sm rounded-xl px-4 py-3"
            style={{ background: "#fef2f2", color: "#ef4444" }}
          >
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {/* Income vs Expenses summary table */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div className="px-5 py-4">
            <h2 className="text-sm font-black" style={{ color: "#1f2937" }}>Income vs Expenses</h2>
          </div>
          <table className="w-full border-collapse">
            <tbody>
              <tr style={{ borderTop: "1px solid #fdf2f8" }}>
                <td className="py-3 px-5 text-xs font-extrabold" style={{ color: "#9ca3af" }}>Income</td>
                <td className="py-3 px-5 text-sm font-black text-right" style={{ color: "#10b981" }}>
                  ฿{totalIncome.toFixed(2)}
                </td>
              </tr>
              <tr style={{ borderTop: "1px solid #fdf2f8" }}>
                <td className="py-3 px-5 text-xs font-extrabold" style={{ color: "#9ca3af" }}>Expenses</td>
                <td className="py-3 px-5 text-sm font-black text-right" style={{ color: "#1f2937" }}>
                  ฿{totalExpenses.toFixed(2)}
                </td>
              </tr>
              <tr style={{ borderTop: "2px solid #f3e8ff" }}>
                <td className="py-3 px-5 text-xs font-extrabold" style={{ color: "#7c3aed" }}>Net</td>
                <td
                  className="py-3 px-5 text-sm font-black text-right"
                  style={{ color: totalIncome - totalExpenses >= 0 ? "#10b981" : "#ef4444" }}
                >
                  ฿{(totalIncome - totalExpenses).toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Category Breakdown pie chart */}
        <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <h2 className="text-sm font-black mb-4" style={{ color: "#1f2937" }}>Category Breakdown</h2>
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <span className="loading loading-spinner loading-md" style={{ color: "#a78bfa" }} />
            </div>
          ) : pieData.length === 0 ? (
            <p className="text-center py-10 text-sm font-bold" style={{ color: "#9ca3af" }}>No expenses this month.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => `฿${v.toFixed(2)}`} />
                <Legend wrapperStyle={{ fontSize: "11px", fontWeight: 700 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Monthly Spending Trend */}
        <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div className="mb-4">
            <h2 className="text-sm font-black" style={{ color: "#1f2937" }}>Monthly Spending Trend</h2>
            <p className="text-xs font-semibold mt-0.5" style={{ color: "#9ca3af" }}>Last 6 months</p>
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-44">
              <span className="loading loading-spinner loading-md" style={{ color: "#a78bfa" }} />
            </div>
          ) : (
            <SpendingChart transactions={spenderFiltered} mode="monthly" />
          )}
        </div>

        {/* Full transaction list */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="text-sm font-black" style={{ color: "#1f2937" }}>Transactions — {monthLabel}</h2>
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-24 pb-4">
              <span className="loading loading-spinner loading-md" style={{ color: "#a78bfa" }} />
            </div>
          ) : (
            <RecentTransactions transactions={monthlyTx} limit={monthlyTx.length} />
          )}
        </div>
      </PullToRefresh>
    </div>
  );
}
