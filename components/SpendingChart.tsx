"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Transaction } from "@/lib/supabase";

interface SpendingChartProps {
  transactions: Transaction[];
  mode?: "category" | "monthly";
}

function buildCategoryData(transactions: Transaction[]) {
  const byCategory: Record<string, { Husband: number; Wife: number }> = {};
  transactions.forEach((t) => {
    if (!byCategory[t.category]) byCategory[t.category] = { Husband: 0, Wife: 0 };
    byCategory[t.category][t.spender] += t.amount;
  });
  return Object.entries(byCategory)
    .map(([category, v]) => ({
      label: category,
      Husband: Math.round(v.Husband * 100) / 100,
      Wife: Math.round(v.Wife * 100) / 100,
    }))
    .sort((a, b) => b.Husband + b.Wife - (a.Husband + a.Wife));
}

function buildMonthlyData(transactions: Transaction[]) {
  const monthly: Record<string, { Husband: number; Wife: number }> = {};
  transactions.forEach((t) => {
    const m = t.date.slice(0, 7);
    if (!monthly[m]) monthly[m] = { Husband: 0, Wife: 0 };
    monthly[m][t.spender] += t.amount;
  });
  return Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, v]) => ({
      label: month,
      Husband: Math.round(v.Husband * 100) / 100,
      Wife: Math.round(v.Wife * 100) / 100,
    }));
}

const CustomTooltip = ({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + p.value, 0);
  return (
    <div
      className="rounded-xl px-3 py-2 text-xs shadow-lg"
      style={{ background: "#1f2937", border: "none" }}
    >
      <p className="font-extrabold mb-1" style={{ color: "#e4e4e7" }}>{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.name === "Husband" ? "#93c5fd" : "#f9a8d4" }}>
          {p.name === "Husband" ? "👨" : "👩"} {p.name}: ฿{p.value.toFixed(2)}
        </p>
      ))}
      <p className="mt-1" style={{ color: "rgba(255,255,255,0.5)" }}>Total: ฿{total.toFixed(2)}</p>
    </div>
  );
};

export default function SpendingChart({ transactions, mode = "category" }: SpendingChartProps) {
  const data = mode === "monthly"
    ? buildMonthlyData(transactions)
    : buildCategoryData(transactions);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-44 text-sm font-bold" style={{ color: "#9ca3af" }}>
        No data yet — add some transactions!
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3e8ff" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "#9ca3af", fontWeight: 700, fontFamily: "Nunito" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "#c4b5fd", fontWeight: 700, fontFamily: "Nunito" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `฿${v}`}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(243,232,255,0.3)" }} />
        <Legend
          wrapperStyle={{ fontSize: "11px", fontWeight: 700, fontFamily: "Nunito" }}
          formatter={(value) => (
            <span style={{ color: "#6b7280" }}>
              {value === "Husband" ? "👨 Husband" : "👩 Wife"}
            </span>
          )}
        />
        <Bar dataKey="Husband" fill="#bfdbfe" radius={[5, 5, 0, 0]} maxBarSize={24} />
        <Bar dataKey="Wife"    fill="#fbcfe8" radius={[5, 5, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
}
