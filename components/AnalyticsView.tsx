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

function buildPieData(transactions: Transaction[]) {
  const totals: Record<string, number> = {};
  transactions.forEach((t) => { totals[t.category] = (totals[t.category] ?? 0) + t.amount; });
  return Object.entries(totals)
    .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value);
}

function buildMonthlyData(transactions: Transaction[]) {
  const monthly: Record<string, number> = {};
  transactions.forEach((t) => {
    const month = t.date.slice(0, 7);
    monthly[month] = (monthly[month] ?? 0) + t.amount;
  });
  return Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, total]) => ({ month, total: Math.round(total * 100) / 100 }));
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

  const pieData = buildPieData(transactions);
  const monthlyData = buildMonthlyData(transactions);

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
                    <Bar dataKey="total" fill="#c4b5fd" radius={[5, 5, 0, 0]} maxBarSize={28} />
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
