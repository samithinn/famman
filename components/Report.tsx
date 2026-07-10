"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from "recharts";
import { RefreshCw, AlertCircle } from "lucide-react";
import { supabase, Transaction } from "@/lib/supabase";
import SpendingChart from "./SpendingChart";
import RecentTransactions from "./RecentTransactions";
import PullToRefresh from "./PullToRefresh";
import CategoryDropdown, { ALL_CATEGORIES } from "./CategoryDropdown";
import PaymentMethodDropdown, { ALL_PAYMENT_METHODS } from "./PaymentMethodDropdown";
import { useTheme } from "@/lib/ThemeContext";

const PIE_COLORS = [
  "#a78bfa", "#f9a8d4", "#6ee7b7", "#fcd34d", "#93c5fd",
  "#fca5a5", "#c4b5fd", "#86efac", "#fdba74", "#67e8f9",
];

function buildPieData(transactions: Transaction[]) {
  const totals = new Map<string, { name: string; value: number }>();
  transactions.forEach((t) => {
    const key = t.category.toLowerCase();
    const entry = totals.get(key) ?? { name: t.category, value: 0 };
    entry.value += t.amount;
    totals.set(key, entry);
  });
  return Array.from(totals.values())
    .map((entry) => ({ name: entry.name, value: Math.round(entry.value * 100) / 100 }))
    .sort((a, b) => b.value - a.value);
}

function toLocalDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Custom pie label: percent only (breakdown with values lives in the side
// legend) and skipped for tiny slices — showing "name + percent" at a fixed
// font size was overflowing/overlapping on narrow mobile widths.
// `color` is passed in by the caller since it depends on the active theme —
// this text is an SVG `fill` attribute, not a `style` string, so it falls
// outside the [style*="..."] dark-mode overrides in globals.css.
function renderPieLabel(
  props: { cx: number; cy: number; midAngle: number; outerRadius: number; percent: number },
  color: string
) {
  const { cx, cy, midAngle, outerRadius, percent } = props;
  if (percent < 0.04) return null;
  const RADIAN = Math.PI / 180;
  const radius = outerRadius + 14;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill={color} textAnchor={x > cx ? "start" : "end"} dominantBaseline="central" fontSize={10} fontWeight={700}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

// Always-dark tooltip card (mirrors SpendingChart's CustomTooltip) so it stays
// legible regardless of page theme, instead of the default Recharts tooltip
// which renders near-invisible light-on-light/white-on-white text.
function CategoryTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name?: string; value?: number }> }) {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  return (
    <div className="rounded-xl px-3 py-2 text-xs shadow-lg" style={{ background: "#1f2937" }}>
      <p className="font-extrabold capitalize mb-0.5" style={{ color: "#e4e4e7" }}>{name}</p>
      <p style={{ color: "#c4b5fd" }}>-฿{(value ?? 0).toFixed(2)}</p>
    </div>
  );
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

interface ReportProps {
  newTransaction: Transaction | null;
}

export default function Report({ newTransaction }: ReportProps) {
  const { resolved } = useTheme();
  const isDark = resolved === "dark";
  const pieLabelColor = isDark ? "#e5e7eb" : "#374151";
  const pieSliceStroke = isDark ? "#2d2d42" : "#ffffff";

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), i, 1);
    return { value: `${now.getFullYear()}-${String(i + 1).padStart(2, "0")}`, label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
  });
  const [selectedMonth, setSelectedMonth] = useState(months[now.getMonth()].value);
  const [reportMode, setReportMode] = useState<"monthly" | "daily">("monthly");
  const [selectedDate, setSelectedDate] = useState(() => toLocalDateStr(new Date()));
  const [currentUser, setCurrentUser] = useState<string>("");
  const [selectedSpender, setSelectedSpender] = useState("current");
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORIES);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(ALL_PAYMENT_METHODS);

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
  const categoryFiltered =
    selectedCategory === ALL_CATEGORIES ? spenderFiltered :
    spenderFiltered.filter((t) => t.category.toLowerCase() === selectedCategory.toLowerCase());
  const paymentMethodFiltered =
    selectedPaymentMethod === ALL_PAYMENT_METHODS ? categoryFiltered :
    categoryFiltered.filter((t) => t.payment_method === selectedPaymentMethod);
  const localDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const monthlyTx = paymentMethodFiltered.filter((t) => localDate(t.date).startsWith(selectedMonth));

  const monthlyExpenses = monthlyTx.filter((t) => (t.type ?? "expense") === "expense");
  const monthlyIncome = monthlyTx.filter((t) => t.type === "income");
  const totalExpenses = monthlyExpenses.reduce((s, t) => s + t.amount, 0);
  const totalIncome = monthlyIncome.reduce((s, t) => s + t.amount, 0);

  const pieData = buildPieData(monthlyExpenses);
  const monthLabel = months.find((m) => m.value === selectedMonth)?.label ?? selectedMonth;

  const dailyTx = paymentMethodFiltered.filter((t) => localDate(t.date) === selectedDate);
  const dailyExpenses = dailyTx.filter((t) => (t.type ?? "expense") === "expense");
  const dailyIncome = dailyTx.filter((t) => t.type === "income");
  const totalExpensesDaily = dailyExpenses.reduce((s, t) => s + t.amount, 0);
  const totalIncomeDaily = dailyIncome.reduce((s, t) => s + t.amount, 0);
  const pieDataDaily = buildPieData(dailyExpenses);
  const dailyLabel = new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const isDaily = reportMode === "daily";
  const activeTx = isDaily ? dailyTx : monthlyTx;
  const activeExpenses = isDaily ? dailyExpenses : monthlyExpenses;
  const activeIncome = isDaily ? dailyIncome : monthlyIncome;
  const activeTotalExpenses = isDaily ? totalExpensesDaily : totalExpenses;
  const activeTotalIncome = isDaily ? totalIncomeDaily : totalIncome;
  const activePieData = isDaily ? pieDataDaily : pieData;
  const periodLabel = isDaily ? dailyLabel : monthLabel;

  return (
    <div className="flex flex-col h-full">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-10 bg-white px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        style={{ borderBottom: "1px solid #f3e8ff" }}
      >
        <div>
          <h1 className="text-lg font-black" style={{ color: "#1f2937", letterSpacing: "-0.5px" }}>
            Report 📈
          </h1>
          <p className="text-xs font-semibold mt-0.5" style={{ color: "#9ca3af" }}>
            {periodLabel} · {activeTx.length} transactions ({activeExpenses.length} expenses, {activeIncome.length} income)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Monthly / Daily toggle */}
          <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: "#fafafa", border: "2px solid #f3e8ff" }}>
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
          {/* Month or Date selector */}
          {reportMode === "monthly" ? (
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
          ) : (
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-xs font-bold rounded-xl px-3 py-2 cursor-pointer outline-none"
              style={{ border: "2px solid #f3e8ff", color: "#374151", fontFamily: "Nunito" }}
            />
          )}
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
          {/* Category filter */}
          <CategoryDropdown value={selectedCategory} onChange={setSelectedCategory} />
          {/* Payment method filter */}
          <PaymentMethodDropdown value={selectedPaymentMethod} onChange={setSelectedPaymentMethod} />
          {/* Export CSV */}
          <button
            onClick={() => exportCSV(activeTx, isDaily ? selectedDate : selectedMonth)}
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
                  ฿{activeTotalIncome.toFixed(2)}
                </td>
              </tr>
              <tr style={{ borderTop: "1px solid #fdf2f8" }}>
                <td className="py-3 px-5 text-xs font-extrabold" style={{ color: "#9ca3af" }}>Expenses</td>
                <td className="py-3 px-5 text-sm font-black text-right" style={{ color: "#1f2937" }}>
                  ฿{activeTotalExpenses.toFixed(2)}
                </td>
              </tr>
              <tr style={{ borderTop: "2px solid #f3e8ff" }}>
                <td className="py-3 px-5 text-xs font-extrabold" style={{ color: "#7c3aed" }}>Net</td>
                <td
                  className="py-3 px-5 text-sm font-black text-right"
                  style={{ color: activeTotalIncome - activeTotalExpenses >= 0 ? "#10b981" : "#ef4444" }}
                >
                  ฿{(activeTotalIncome - activeTotalExpenses).toFixed(2)}
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
          ) : activePieData.length === 0 ? (
            <p className="text-center py-10 text-sm font-bold" style={{ color: "#9ca3af" }}>No expenses for this period.</p>
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-2">
              <div className="w-full sm:w-1/2 sm:flex-shrink-0">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={activePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                      label={(props: { cx: number; cy: number; midAngle: number; outerRadius: number; percent: number }) => renderPieLabel(props, pieLabelColor)}
                      labelLine={false}
                    >
                      {activePieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke={pieSliceStroke} strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip content={<CategoryTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {/* Side legend: color swatch + category + amount breakdown */}
              <div className="w-full sm:w-1/2 sm:pl-2 space-y-1.5" style={{ maxHeight: 220, overflowY: "auto" }}>
                {activePieData.map((entry, i) => (
                  <div key={entry.name} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="rounded-full flex-shrink-0"
                        style={{ width: 9, height: 9, background: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                      <span className="text-xs font-extrabold truncate capitalize" style={{ color: "#374151" }}>
                        {entry.name}
                      </span>
                    </div>
                    <span className="text-xs font-black flex-shrink-0" style={{ color: "#1f2937" }}>
                      -฿{entry.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Monthly Spending Trend */}
        <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div className="mb-4">
            <h2 className="text-sm font-black" style={{ color: "#1f2937" }}>{isDaily ? "Daily" : "Monthly"} Spending Trend</h2>
            <p className="text-xs font-semibold mt-0.5" style={{ color: "#9ca3af" }}>{isDaily ? "Last 14 days" : "Last 6 months"}</p>
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-44">
              <span className="loading loading-spinner loading-md" style={{ color: "#a78bfa" }} />
            </div>
          ) : (
            <SpendingChart transactions={categoryFiltered} mode={isDaily ? "daily" : "monthly"} />
          )}
        </div>

        {/* Full transaction list */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="text-sm font-black" style={{ color: "#1f2937" }}>Transactions — {periodLabel}</h2>
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-24 pb-4">
              <span className="loading loading-spinner loading-md" style={{ color: "#a78bfa" }} />
            </div>
          ) : (
            <RecentTransactions transactions={activeTx} limit={activeTx.length} />
          )}
        </div>
      </PullToRefresh>
    </div>
  );
}
