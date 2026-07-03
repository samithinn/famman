"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, AlertCircle } from "lucide-react";
import { supabase, Transaction } from "@/lib/supabase";
import RecentTransactions from "./RecentTransactions";
import PullToRefresh from "./PullToRefresh";

interface DashboardViewProps {
  newTransaction: Transaction | null;
  onAddTransaction: () => void;
}

export default function DashboardView({ newTransaction, onAddTransaction }: DashboardViewProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [monthlyBudget, setMonthlyBudget] = useState(0);
  const [currentUser, setCurrentUser] = useState<string>("");
  const [selectedSpender, setSelectedSpender] = useState<string>("current");
  const [currentDateTime, setCurrentDateTime] = useState("");

  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      const dayNames = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];
      const monthNames = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
      const day = dayNames[now.getDay()];
      const date = now.getDate();
      const month = monthNames[now.getMonth()];
      const year = now.getFullYear() + 543;
      const hours = String(now.getHours()).padStart(2, "0");
      const mins = String(now.getMinutes()).padStart(2, "0");
      const secs = String(now.getSeconds()).padStart(2, "0");
      const fullDateTime = `วัน${day}ที่ ${date} ${month} ${year} | ${hours}:${mins}:${secs} น.`;
      setCurrentDateTime(fullDateTime);
    };
    updateDateTime();
    const interval = setInterval(updateDateTime, 1000);
    return () => clearInterval(interval);
  }, []);

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
        .select("monthly_budget, full_name")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          if (data?.monthly_budget) setMonthlyBudget(Number(data.monthly_budget));
          const name = data?.full_name || user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0];
          if (name) setCurrentUser(name);
        });
    });
  }, []);

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const end = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(lastDay)}`;
  const localDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const matchesSpender = useCallback(
    (t: Transaction) =>
      selectedSpender === "all" ? true : selectedSpender === "current" ? t.spender === currentUser : t.spender === selectedSpender,
    [selectedSpender, currentUser]
  );

  // Budget progress always tracks the logged-in user's own monthly budget, regardless of the spender filter.
  const ownMonthTx = transactions.filter((t) => {
    const td = localDate(t.date);
    return td >= start && td <= end && t.spender === currentUser;
  });
  const ownMonthSpent = ownMonthTx
    .filter((t) => (t.type ?? "expense") === "expense")
    .reduce((s, t) => s + t.amount, 0);

  const budgetPct = monthlyBudget > 0 ? Math.min((ownMonthSpent / monthlyBudget) * 100, 100) : 0;
  const overBudget = monthlyBudget > 0 && ownMonthSpent > monthlyBudget;

  // Balance boxes track whichever spender is selected in the filter.
  const filteredMonthTx = transactions.filter((t) => {
    const td = localDate(t.date);
    return td >= start && td <= end && matchesSpender(t);
  });
  const monthSpent = filteredMonthTx.filter((t) => (t.type ?? "expense") === "expense").reduce((s, t) => s + t.amount, 0);
  const monthIncome = filteredMonthTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const monthBalance = monthIncome - monthSpent;

  const filteredTodayTx = transactions.filter((t) => localDate(t.date) === todayStr && matchesSpender(t));
  const todaySpent = filteredTodayTx.filter((t) => (t.type ?? "expense") === "expense").reduce((s, t) => s + t.amount, 0);
  const todayIncome = filteredTodayTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const todayBalance = todayIncome - todaySpent;

  const uniqueSpenders = Array.from(new Set(transactions.map((t) => t.spender)))
    .filter((spender) => spender !== currentUser)
    .sort();
  const recentTransactions = transactions.filter(matchesSpender);

  return (
    <div className="flex flex-col h-full">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-10 bg-white px-5 py-4"
        style={{ borderBottom: "1px solid #f3e8ff" }}
      >
        {/* Mobile layout */}
        <div className="sm:hidden space-y-1.5">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-black" style={{ color: "#1f2937", letterSpacing: "-0.5px" }}>
              Dashboard 🏠
            </h1>
            <div className="flex items-center gap-1">
              <button
                onClick={onAddTransaction}
                className="text-xs font-extrabold px-3 py-1.5 rounded-lg"
                style={{ border: "2px solid #f9a8d4", color: "#ec4899", background: "#fff" }}
              >
                + Add
              </button>
              <button
                onClick={fetchTransactions}
                disabled={loading}
                className="p-1.5 rounded-lg"
                style={{ color: "#9ca3af" }}
              >
                <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              </button>
            </div>
          </div>
          <p className="text-xs font-extrabold" style={{ color: "#7c3aed", letterSpacing: "0.3px" }}>
            {currentDateTime[0]}
          </p>
        </div>

        {/* Desktop layout */}
        <div className="hidden sm:flex items-center justify-between gap-4">
          <h1 className="text-lg font-black" style={{ color: "#1f2937", letterSpacing: "-0.5px" }}>
            Dashboard 🏠
          </h1>
          <p className="text-sm font-extrabold flex-1 text-center whitespace-nowrap" style={{ color: "#7c3aed", letterSpacing: "0.5px" }}>
            {currentDateTime[0]}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onAddTransaction}
              className="text-xs font-extrabold px-4 py-2 rounded-xl"
              style={{ border: "2px solid #f9a8d4", color: "#ec4899", background: "#fff" }}
            >
              + Add
            </button>
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

        {/* Today's Balance */}
        <div
          className="rounded-2xl p-6"
          style={{ background: "linear-gradient(135deg, #8b5cf6, #6366f1)", boxShadow: "0 4px 16px rgba(139,92,246,0.3)" }}
        >
          <p className="text-xs font-extrabold mb-2" style={{ color: "rgba(255,255,255,0.7)", letterSpacing: "0.8px" }}>
            TODAY&apos;S BALANCE
          </p>
          <p className="text-3xl font-black text-white" style={{ letterSpacing: "-1px" }}>
            ฿{todayBalance.toFixed(2)}
          </p>
          <p className="text-xs font-semibold mt-1" style={{ color: "rgba(255,255,255,0.75)" }}>
            ฿{todayIncome.toFixed(2)} income − ฿{todaySpent.toFixed(2)} expenses (today)
          </p>
        </div>

        {/* This Month's Balance */}
        <div
          className="rounded-2xl p-6"
          style={{ background: "linear-gradient(135deg, #ec4899, #8b5cf6)", boxShadow: "0 4px 16px rgba(236,72,153,0.3)" }}
        >
          <p className="text-xs font-extrabold mb-2" style={{ color: "rgba(255,255,255,0.7)", letterSpacing: "0.8px" }}>
            THIS MONTH&apos;S BALANCE
          </p>
          <p className="text-3xl font-black text-white" style={{ letterSpacing: "-1px" }}>
            ฿{monthBalance.toFixed(2)}
          </p>
          <p className="text-xs font-semibold mt-1" style={{ color: "rgba(255,255,255,0.75)" }}>
            ฿{monthIncome.toFixed(2)} income − ฿{monthSpent.toFixed(2)} expenses (this month)
          </p>
        </div>

        {/* Budget Progress */}
        <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-black" style={{ color: "#1f2937" }}>Budget Progress</h2>
            <span className="text-xs font-extrabold" style={{ color: overBudget ? "#ef4444" : "#9ca3af" }}>
              {monthlyBudget > 0 ? `฿${ownMonthSpent.toFixed(2)} / ฿${monthlyBudget.toLocaleString()}` : "No budget set"}
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
                  ? `฿${(ownMonthSpent - monthlyBudget).toFixed(2)} over budget`
                  : `฿${(monthlyBudget - ownMonthSpent).toFixed(2)} left this month`}
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
          <div className="flex items-center justify-between px-5 py-4 gap-3">
            <h2 className="text-sm font-black flex-shrink-0" style={{ color: "#1f2937" }}>Recent Transactions</h2>
            <select
              value={selectedSpender}
              onChange={(e) => setSelectedSpender(e.target.value)}
              className="rounded-xl px-3 py-1.5 text-xs font-semibold outline-none"
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
          {loading ? (
            <div className="flex items-center justify-center h-24 pb-4">
              <span className="loading loading-spinner loading-md" style={{ color: "#a78bfa" }} />
            </div>
          ) : (
            <RecentTransactions transactions={recentTransactions} limit={10} />
          )}
        </div>
      </PullToRefresh>
    </div>
  );
}
