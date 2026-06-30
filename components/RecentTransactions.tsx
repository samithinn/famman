"use client";

import { Pencil, Trash2 } from "lucide-react";
import { Transaction } from "@/lib/supabase";

const CATEGORY_ICONS: Record<string, { icon: string; bg: string }> = {
  "Food & Dining":  { icon: "🍜", bg: "#fff0f7" },
  Groceries:        { icon: "🛒", bg: "#f5f3ff" },
  Transportation:   { icon: "⛽", bg: "#f0fdf4" },
  Utilities:        { icon: "💡", bg: "#fffbeb" },
  Healthcare:       { icon: "💊", bg: "#eff6ff" },
  Entertainment:    { icon: "🎬", bg: "#fff7ed" },
  Shopping:         { icon: "🛍️", bg: "#f5f3ff" },
  Education:        { icon: "📚", bg: "#f0fdf4" },
  Travel:           { icon: "✈️", bg: "#eff6ff" },
  Other:            { icon: "📦", bg: "#f9fafb" },
};

interface RecentTransactionsProps {
  transactions: Transaction[];
  limit?: number;
  onEdit?: (tx: Transaction) => void;
  onDelete?: (tx: Transaction) => void;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" });
}

export default function RecentTransactions({ transactions, limit = 10, onEdit, onDelete }: RecentTransactionsProps) {
  const shown = transactions.slice(0, limit);
  const hasActions = !!(onEdit || onDelete);

  if (shown.length === 0) {
    return (
      <div className="text-center py-10 text-sm font-bold" style={{ color: "#9ca3af" }}>
        No transactions yet. Add your first expense!
      </div>
    );
  }

  const baseHeaders = ["CATEGORY", "NOTE", "DATE", "AMOUNT", "WHO"];
  const headers = hasActions ? [...baseHeaders, "ACTIONS"] : baseHeaders;

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full border-collapse min-w-[520px]">
        <thead>
          <tr style={{ background: "#fafafa", borderBottom: "2px solid #fdf2f8" }}>
            {headers.map((h, i) => (
              <th
                key={h}
                className="py-2.5 text-left font-extrabold"
                style={{
                  fontSize: 9,
                  color: "#9ca3af",
                  letterSpacing: "0.8px",
                  paddingLeft: i === 0 ? 16 : 10,
                  paddingRight: i === headers.length - 1 ? 16 : 10,
                  textAlign: h === "AMOUNT" ? "right" : h === "WHO" || h === "ACTIONS" ? "center" : "left",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((t) => {
            const { icon, bg } = CATEGORY_ICONS[t.category] ?? { icon: "📦", bg: "#f9fafb" };
            const isWife = t.spender === "Wife";
            return (
              <tr
                key={t.id}
                className="txn-row transition-colors"
                style={{ borderBottom: "1px solid #fdf2f8" }}
              >
                {/* Category */}
                <td className="py-3" style={{ paddingLeft: 16, paddingRight: 10 }}>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-7 h-7 rounded-xl flex items-center justify-center text-sm flex-shrink-0"
                      style={{ background: bg }}
                    >
                      {icon}
                    </div>
                    <span className="text-xs font-extrabold" style={{ color: "#374151" }}>
                      {t.category}
                    </span>
                  </div>
                </td>
                {/* Note */}
                <td
                  className="py-3 text-xs font-semibold truncate max-w-[150px]"
                  style={{ color: "#6b7280", paddingLeft: 10, paddingRight: 10 }}
                >
                  {t.note || "—"}
                </td>
                {/* Date */}
                <td
                  className="py-3 text-xs font-bold"
                  style={{ color: "#9ca3af", paddingLeft: 10, paddingRight: 10 }}
                >
                  {formatDate(t.date)}
                </td>
                {/* Amount */}
                <td
                  className="py-3 text-sm font-black"
                  style={{ color: "#1f2937", textAlign: "right", paddingLeft: 10, paddingRight: 10 }}
                >
                  ฿{t.amount.toFixed(2)}
                </td>
                {/* Who */}
                <td className="py-3" style={{ textAlign: "center", paddingLeft: 10, paddingRight: hasActions ? 10 : 16 }}>
                  <span
                    className="text-xs font-extrabold px-2 py-0.5 rounded-full"
                    style={{
                      background: isWife ? "#fce7f3" : "#dbeafe",
                      color: isWife ? "#be185d" : "#1e40af",
                    }}
                  >
                    {isWife ? "👩 Wife" : "👨 Hub"}
                  </span>
                </td>
                {/* Actions */}
                {hasActions && (
                  <td className="py-3" style={{ textAlign: "center", paddingLeft: 10, paddingRight: 16 }}>
                    <div className="flex items-center justify-center gap-1.5">
                      {onEdit && (
                        <button
                          onClick={() => onEdit(t)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                          style={{ background: "#f3e8ff", color: "#7c3aed" }}
                          title="Edit"
                        >
                          <Pencil size={12} />
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => onDelete(t)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                          style={{ background: "#fef2f2", color: "#ef4444" }}
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
