"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, AlertCircle } from "lucide-react";
import { supabase, Transaction } from "@/lib/supabase";
import SpendingChart from "./SpendingChart";
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
  a.download = `expenses-${new Date().toISOString().slice(0, 7)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function getCurrentMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
  return { start, end };
}

interface DashboardProps {
  newTransaction: Transaction | null;
  onAddTransaction: () => void;
}

export default function Dashboard({ newTransaction, onAddTransaction }: DashboardProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [monthlyBudget, setMonthlyBudget] = useState(0);

  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), i, 1);
    return { value: `${now.getFullYear()}-${String(i + 1).padStart(2, "0")}`, label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
  });
  const [selectedMonth, setSelectedMonth] = useState(months[now.getMonth()].value);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError("");
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

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("profiles")
        .select("monthly_budget")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          if (data?.monthly_budget) setMonthlyBudget(Number(data.monthly_budget));
        });
    });
  }, []);

  const { start, end } = getCurrentMonthRange();
  const monthlyTx = transactions.filter((t) =>
    t.date >= `${selectedMonth}-01` && t.date <= `${selectedMonth}-31`
  );
  const currentMonthTx = transactions.filter((t) => t.date >= start && t.date <= end);

  const totalThisMonth = monthlyTx.reduce((s, t) => s + t.amount, 0);
  const budgetLeft = monthlyBudget - currentMonthTx.reduce((s, t) => s + t.amount, 0);
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const avgPerDay = totalThisMonth / days;

  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevStart = prevMonth.toISOString().split("T")[0];
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split("T")[0];
  const prevTotal = transactions
    .filter((t) => t.date >= prevStart && t.date <= prevEnd)
    .reduce((s, t) => s + t.amount, 0);
  const changePct = prevTotal > 0 ? ((totalThisMonth - prevTotal) / prevTotal) * 100 : 0;

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
            {months.find((m) => m.value === selectedMonth)?.label} · {monthlyTx.length} transactions recorded
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
          {/* Add button */}
          <button
            onClick={onAddTransaction}
            className="text-xs font-extrabold px-4 py-2 rounded-xl"
            style={{ border: "2px solid #f9a8d4", color: "#ec4899", background: "#fff" }}
          >
            + Add
          </button>
          {/* Export CSV */}
          <button
            onClick={() => exportCSV(monthlyTx)}
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
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {error && (
          <div
            className="flex items-center gap-2 text-sm rounded-xl px-4 py-3"
            style={{ background: "#fef2f2", color: "#ef4444" }}
          >
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {/* 4 stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Total */}
          <div className="stat-card">
            <p className="text-xs font-extrabold mb-2" style={{ color: "#9ca3af", letterSpacing: "0.8px" }}>TOTAL THIS MONTH</p>
            <p className="text-2xl font-black" style={{ color: "#1f2937", letterSpacing: "-1px" }}>฿{totalThisMonth.toFixed(2)}</p>
            <p className="text-xs font-extrabold mt-1" style={{ color: changePct <= 0 ? "#10b981" : "#ef4444" }}>
              {changePct <= 0 ? "↓" : "↑"} {Math.abs(changePct).toFixed(1)}% vs last month
            </p>
          </div>
          {/* Transactions */}
          <div className="stat-card">
            <p className="text-xs font-extrabold mb-2" style={{ color: "#9ca3af", letterSpacing: "0.8px" }}>TRANSACTIONS</p>
            <p className="text-2xl font-black" style={{ color: "#1f2937" }}>{monthlyTx.length}</p>
            <p className="text-xs font-semibold mt-1" style={{ color: "#9ca3af" }}>this month total</p>
          </div>
          {/* Avg per day */}
          <div className="stat-card">
            <p className="text-xs font-extrabold mb-2" style={{ color: "#9ca3af", letterSpacing: "0.8px" }}>AVG PER DAY</p>
            <p className="text-2xl font-black" style={{ color: "#1f2937" }}>฿{avgPerDay.toFixed(0)}</p>
            <p className="text-xs font-semibold mt-1" style={{ color: "#9ca3af" }}>daily average</p>
          </div>
          {/* Budget Left — gradient */}
          <div
            className="rounded-2xl p-5"
            style={{ background: "linear-gradient(135deg, #ec4899, #8b5cf6)" }}
          >
            <p className="text-xs font-extrabold mb-2" style={{ color: "rgba(255,255,255,0.65)", letterSpacing: "0.8px" }}>BUDGET LEFT</p>
            <p className="text-2xl font-black text-white" style={{ letterSpacing: "-1px" }}>
              {monthlyBudget > 0 ? `฿${budgetLeft.toFixed(2)}` : "—"}
            </p>
            <p className="text-xs font-semibold mt-1" style={{ color: "rgba(255,255,255,0.7)" }}>
              {monthlyBudget > 0 ? `of ฿${monthlyBudget.toLocaleString()} budget` : "Set budget in Settings"}
            </p>
          </div>
        </div>

        {/* Bar Chart */}
        <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-sm font-black" style={{ color: "#1f2937" }}>Monthly Spending Trend</h2>
              <p className="text-xs font-semibold mt-0.5" style={{ color: "#9ca3af" }}>
                Last 6 months — hover a bar for details
              </p>
            </div>
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-44">
              <span className="loading loading-spinner loading-md" style={{ color: "#a78bfa" }} />
            </div>
          ) : (
            <SpendingChart transactions={transactions} mode="monthly" />
          )}
        </div>

        {/* Transaction table */}
        <div
          className="bg-white rounded-2xl overflow-hidden"
          style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}
        >
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="text-sm font-black" style={{ color: "#1f2937" }}>All Transactions</h2>
            <button className="text-xs font-extrabold" style={{ color: "#ec4899" }}>Sort ↕</button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-24 pb-4">
              <span className="loading loading-spinner loading-md" style={{ color: "#a78bfa" }} />
            </div>
          ) : (
            <RecentTransactions transactions={monthlyTx} limit={monthlyTx.length} />
          )}
        </div>
      </div>
    </div>
  );
}
