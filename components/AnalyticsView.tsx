"use client";

import { useState, useEffect, useCallback } from "react";
import {
  PieChart, Pie, Cell, Tooltip, Legend,
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { supabase, Transaction } from "@/lib/supabase";
import { AlertCircle } from "lucide-react";

const PIE_COLORS = [
  "#a78bfa", "#f9a8d4", "#6ee7b7", "#fcd34d", "#93c5fd",
  "#fca5a5", "#c4b5fd", "#86efac", "#fdba74", "#67e8f9",
];

const SPENDER_COLORS = [
  { bar: "#bfdbfe", badge_bg: "#dbeafe", badge_text: "#1e40af" },
  { bar: "#fbcfe8", badge_bg: "#fce7f3", badge_text: "#be185d" },
  { bar: "#bbf7d0", badge_bg: "#dcfce7", badge_text: "#15803d" },
  { bar: "#fde68a", badge_bg: "#fef3c7", badge_text: "#92400e" },
  { bar: "#c4b5fd", badge_bg: "#f5f3ff", badge_text: "#6d28d9" },
  { bar: "#fca5a5", badge_bg: "#fef2f2", badge_text: "#b91c1c" },
];

function buildPieData(transactions: Transaction[]) {
  const totals: Record<string, number> = {};
  transactions.forEach((t) => { totals[t.category] = (totals[t.category] ?? 0) + t.amount; });
  return Object.entries(totals)
    .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value);
}

function buildMonthlyData(transactions: Transaction[], spenders: string[]) {
  const monthly: Record<string, Record<string, number>> = {};
  transactions.forEach((t) => {
    const month = t.date.slice(0, 7);
    if (!monthly[month]) monthly[month] = Object.fromEntries(spenders.map((s) => [s, 0]));
    if (t.spender) monthly[month][t.spender] = (monthly[month][t.spender] ?? 0) + t.amount;
  });
  return Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, v]) => ({
      month,
      ...Object.fromEntries(Object.entries(v).map(([k, val]) => [k, Math.round(val * 100) / 100])),
    }));
}

export default function AnalyticsView() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase.from("transactions").select("*").order("date", { ascending: false });
    if (err) setError(err.message);
    else setTransactions((data as Transaction[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  const spenders = Array.from(new Set(transactions.map((t) => t.spender).filter(Boolean))).sort();
  const spenderTotals = spenders.map((s) => ({
    name: s,
    total: transactions.filter((t) => t.spender === s).reduce((sum, t) => sum + t.amount, 0),
  }));

  const pieData = buildPieData(transactions);
  const monthlyData = buildMonthlyData(transactions, spenders);

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-white px-5 py-4" style={{ borderBottom: "1px solid #f3e8ff" }}>
        <h1 className="text-lg font-black" style={{ color: "#1f2937" }}>Analytics 📊</h1>
        <p className="text-xs font-semibold mt-0.5" style={{ color: "#9ca3af" }}>All-time spending breakdown</p>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {error && (
          <div className="flex items-center gap-2 text-sm rounded-xl px-4 py-3" style={{ background: "#fef2f2", color: "#ef4444" }}>
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <span className="loading loading-spinner loading-lg" style={{ color: "#a78bfa" }} />
          </div>
        ) : (
          <>
            {/* Per-spender totals */}
            {spenderTotals.length > 0 && (
              <div className={`grid gap-3 ${spenderTotals.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                {spenderTotals.map(({ name, total }, i) => {
                  const { badge_bg, badge_text } = SPENDER_COLORS[i % SPENDER_COLORS.length];
                  return (
                    <div
                      key={name}
                      className="rounded-2xl p-5 text-center"
                      style={{ background: badge_bg, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}
                    >
                      <p className="text-xs font-extrabold mb-1 uppercase" style={{ color: "#6b7280", letterSpacing: "0.8px" }}>
                        {name}
                      </p>
                      <p className="text-2xl font-black" style={{ color: badge_text }}>฿{total.toFixed(2)}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pie chart */}
            <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
              <h2 className="text-sm font-black mb-4" style={{ color: "#1f2937" }}>Spending by Category</h2>
              {pieData.length === 0 ? (
                <p className="text-center py-10 text-sm font-bold" style={{ color: "#9ca3af" }}>No data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
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

            {/* Monthly trend */}
            <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
              <h2 className="text-sm font-black mb-4" style={{ color: "#1f2937" }}>Monthly Trend (last 6 months)</h2>
              {monthlyData.length === 0 ? (
                <p className="text-center py-10 text-sm font-bold" style={{ color: "#9ca3af" }}>No data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3e8ff" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fontFamily: "Nunito", fontWeight: 700 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fontFamily: "Nunito", fontWeight: 700, fill: "#c4b5fd" }} tickLine={false} axisLine={false} tickFormatter={(v) => `฿${v}`} />
                    <Tooltip formatter={(v: number) => `฿${v.toFixed(2)}`} />
                    <Legend
                      wrapperStyle={{ fontSize: "12px", fontWeight: 700 }}
                      formatter={(value) => <span style={{ color: "#6b7280" }}>{value}</span>}
                    />
                    {spenders.map((s, i) => (
                      <Bar key={s} dataKey={s} fill={SPENDER_COLORS[i % SPENDER_COLORS.length].bar} radius={[5, 5, 0, 0]} maxBarSize={28} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
