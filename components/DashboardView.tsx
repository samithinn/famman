"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, AlertCircle } from "lucide-react";
import { supabase, Transaction } from "@/lib/supabase";
import RecentTransactions from "./RecentTransactions";

interface DashboardViewProps {
  newTransaction: Transaction | null;
  onAddTransaction: () => void;
}

export default function DashboardView({ newTransaction, onAddTransaction }: DashboardViewProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [monthlyBudget, setMonthlyBudget] = useState(0);

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

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
  const currentMonthTx = transactions.filter((t) => t.date >= start && t.date <= end);
  const currentMonthSpent = currentMonthTx
    .filter((t) => (t.type ?? "expense") === "expense")
    .reduce((s, t) => s + t.amount, 0);

  const currentMonthIncome = currentMonthTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const currentBalance = currentMonthIncome - currentMonthSpent;

  const budgetPct = monthlyBudget > 0 ? Math.min((currentMonthSpent / monthlyBudget) * 100, 100) : 0;
  const overBudget = monthlyBudget > 0 && currentMonthSpent > monthlyBudget;

  return (
    <div className="flex flex-col h-full">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-10 bg-white px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        style={{ borderBottom: "1px solid #f3e8ff" }}
      >
        <div>
          <h1 className="text-lg font-black" style={{ color: "#1f2937", letterSpacing: "-0.5px" }}>
            Dashboard 🏠
          </h1>
          <p className="text-xs font-semibold mt-0.5" style={{ color: "#9ca3af" }}>
            Your current financial snapshot
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Add button */}
          <button
            onClick={onAddTransaction}
            className="text-xs font-extrabold px-4 py-2 rounded-xl"
            style={{ border: "2px solid #f9a8d4", color: "#ec4899", background: "#fff" }}
          >
            + Add
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

        {/* Current Balance */}
        <div
          className="rounded-2xl p-6"
          style={{ background: "linear-gradient(135deg, #ec4899, #8b5cf6)", boxShadow: "0 4px 16px rgba(236,72,153,0.3)" }}
        >
          <p className="text-xs font-extrabold mb-2" style={{ color: "rgba(255,255,255,0.7)", letterSpacing: "0.8px" }}>
            THIS MONTH&apos;S BALANCE
          </p>
          <p className="text-3xl font-black text-white" style={{ letterSpacing: "-1px" }}>
            ฿{currentBalance.toFixed(2)}
          </p>
          <p className="text-xs font-semibold mt-1" style={{ color: "rgba(255,255,255,0.75)" }}>
            ฿{currentMonthIncome.toFixed(2)} income − ฿{currentMonthSpent.toFixed(2)} expenses (this month)
          </p>
        </div>

        {/* Budget Progress */}
        <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-black" style={{ color: "#1f2937" }}>Budget Progress</h2>
            <span className="text-xs font-extrabold" style={{ color: overBudget ? "#ef4444" : "#9ca3af" }}>
              {monthlyBudget > 0 ? `฿${currentMonthSpent.toFixed(2)} / ฿${monthlyBudget.toLocaleString()}` : "No budget set"}
            </span>
          </div>
          {monthlyBudget > 0 ? (
            <>
              <div className="w-full rounded-full overflow-hidden" style={{ background: "#f3e8ff", height: 10 }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${budgetPct}%`,
                    background: overBudget ? "#ef4444" : "linear-gradient(135deg, #ec4899, #8b5cf6)",
                  }}
                />
              </div>
              <p className="text-xs font-semibold mt-2" style={{ color: overBudget ? "#ef4444" : "#9ca3af" }}>
                {overBudget
                  ? `฿${(currentMonthSpent - monthlyBudget).toFixed(2)} over budget`
                  : `฿${(monthlyBudget - currentMonthSpent).toFixed(2)} left this month`}
              </p>
            </>
          ) : (
            <p className="text-xs font-semibold" style={{ color: "#9ca3af" }}>
              Set a monthly budget in Settings to track progress.
            </p>
          )}
        </div>

        {/* Recent Transactions */}
        <div
          className="bg-white rounded-2xl overflow-hidden"
          style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}
        >
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="text-sm font-black" style={{ color: "#1f2937" }}>Recent Transactions</h2>
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-24 pb-4">
              <span className="loading loading-spinner loading-md" style={{ color: "#a78bfa" }} />
            </div>
          ) : (
            <RecentTransactions transactions={transactions} limit={10} />
          )}
        </div>
      </div>
    </div>
  );
}
