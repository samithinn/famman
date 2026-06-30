"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Transaction } from "@/lib/supabase";

interface SpendingChartProps {
  transactions: Transaction[];
  mode?: "category" | "monthly";
}

function buildCategoryData(transactions: Transaction[]) {
  const totals: Record<string, number> = {};
  transactions.forEach((t) => { totals[t.category] = (totals[t.category] ?? 0) + t.amount; });
  return Object.entries(totals)
    .map(([label, total]) => ({ label, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);
}

function buildMonthlyData(transactions: Transaction[]) {
  const monthly: Record<string, number> = {};
  transactions.forEach((t) => {
    const m = t.date.slice(0, 7);
    monthly[m] = (monthly[m] ?? 0) + t.amount;
  });
  return Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([label, total]) => ({ label, total: Math.round(total * 100) / 100 }));
}

export default function SpendingChart({ transactions, mode = "category" }: SpendingChartProps) {
  const data = mode === "monthly" ? buildMonthlyData(transactions) : buildCategoryData(transactions);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-44 text-sm font-bold" style={{ color: "#9ca3af" }}>
        No data yet — add some transactions!
      </div>
    );
  }

  const CustomTooltip = ({ active, payload, label }: {
    active?: boolean;
    payload?: Array<{ value: number }>;
    label?: string;
  }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-xl px-3 py-2 text-xs shadow-lg" style={{ background: "#1f2937" }}>
        <p className="font-extrabold mb-1" style={{ color: "#e4e4e7" }}>{label}</p>
        <p style={{ color: "#c4b5fd" }}>฿{payload[0].value.toFixed(2)}</p>
      </div>
    );
  };

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
        <Bar dataKey="total" fill="#c4b5fd" radius={[5, 5, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
}
