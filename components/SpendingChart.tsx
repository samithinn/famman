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

const SPENDER_COLORS = [
  { bar: "#bfdbfe", tip: "#93c5fd" },
  { bar: "#fbcfe8", tip: "#f9a8d4" },
  { bar: "#bbf7d0", tip: "#86efac" },
  { bar: "#fde68a", tip: "#fde047" },
  { bar: "#c4b5fd", tip: "#c4b5fd" },
  { bar: "#fca5a5", tip: "#fca5a5" },
];

interface SpendingChartProps {
  transactions: Transaction[];
  mode?: "category" | "monthly";
}

function getUniqueSpenders(transactions: Transaction[]) {
  const seen = new Set<string>();
  transactions.forEach((t) => { if (t.spender) seen.add(t.spender); });
  return Array.from(seen).sort();
}

function buildCategoryData(transactions: Transaction[], spenders: string[]) {
  const byCategory: Record<string, Record<string, number>> = {};
  transactions.forEach((t) => {
    if (!byCategory[t.category]) byCategory[t.category] = Object.fromEntries(spenders.map((s) => [s, 0]));
    if (t.spender) byCategory[t.category][t.spender] = (byCategory[t.category][t.spender] ?? 0) + t.amount;
  });
  return Object.entries(byCategory)
    .map(([category, v]) => {
      const total = Object.values(v).reduce((s, a) => s + a, 0);
      return {
        label: category,
        ...Object.fromEntries(Object.entries(v).map(([k, val]) => [k, Math.round(val * 100) / 100])),
        _total: total,
      };
    })
    .sort((a, b) => b._total - a._total);
}

function buildMonthlyData(transactions: Transaction[], spenders: string[]) {
  const monthly: Record<string, Record<string, number>> = {};
  transactions.forEach((t) => {
    const m = t.date.slice(0, 7);
    if (!monthly[m]) monthly[m] = Object.fromEntries(spenders.map((s) => [s, 0]));
    if (t.spender) monthly[m][t.spender] = (monthly[m][t.spender] ?? 0) + t.amount;
  });
  return Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, v]) => ({
      label: month,
      ...Object.fromEntries(Object.entries(v).map(([k, val]) => [k, Math.round(val * 100) / 100])),
    }));
}

export default function SpendingChart({ transactions, mode = "category" }: SpendingChartProps) {
  const spenders = getUniqueSpenders(transactions);
  const data = mode === "monthly"
    ? buildMonthlyData(transactions, spenders)
    : buildCategoryData(transactions, spenders);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-44 text-sm font-bold" style={{ color: "#9ca3af" }}>
        No data yet — add some transactions!
      </div>
    );
  }

  const CustomTooltip = ({ active, payload, label }: {
    active?: boolean;
    payload?: Array<{ name: string; value: number }>;
    label?: string;
  }) => {
    if (!active || !payload?.length) return null;
    const total = payload.reduce((s, p) => s + p.value, 0);
    return (
      <div className="rounded-xl px-3 py-2 text-xs shadow-lg" style={{ background: "#1f2937", border: "none" }}>
        <p className="font-extrabold mb-1" style={{ color: "#e4e4e7" }}>{label}</p>
        {payload.map((p) => {
          const idx = spenders.indexOf(p.name);
          const color = SPENDER_COLORS[idx % SPENDER_COLORS.length]?.tip ?? "#e4e4e7";
          return (
            <p key={p.name} style={{ color }}>{p.name}: ฿{p.value.toFixed(2)}</p>
          );
        })}
        <p className="mt-1" style={{ color: "rgba(255,255,255,0.5)" }}>Total: ฿{total.toFixed(2)}</p>
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
        <Legend
          wrapperStyle={{ fontSize: "11px", fontWeight: 700, fontFamily: "Nunito" }}
          formatter={(value) => <span style={{ color: "#6b7280" }}>{value}</span>}
        />
        {spenders.map((s, i) => (
          <Bar
            key={s}
            dataKey={s}
            fill={SPENDER_COLORS[i % SPENDER_COLORS.length].bar}
            radius={[5, 5, 0, 0]}
            maxBarSize={24}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
