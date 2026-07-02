"use client";

import { Pencil, Trash2 } from "lucide-react";
import { Transaction } from "@/lib/supabase";
import { CATEGORY_ICONS } from "@/lib/category-icons";

interface RecentTransactionsProps {
  transactions: Transaction[];
  limit?: number;
  onEdit?: (tx: Transaction) => void;
  onDelete?: (tx: Transaction) => void;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00");
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatTime(dateStr: string): string | null {
  if (!dateStr.includes("T")) return null;
  return new Date(dateStr).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
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

  const baseHeaders = ["CATEGORY", "AMOUNT", "SPENDER", "DATE", "NOTE"];
  const headers = hasActions ? [...baseHeaders, "ACTIONS"] : baseHeaders;

  return (
    <>
      {/* Desktop / wide view: table */}
      <div className="hidden sm:block overflow-x-auto -mx-1">
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
                    textAlign: h === "AMOUNT" ? "right" : h === "ACTIONS" ? "center" : "left",
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
                  {/* Amount */}
                  <td
                    className="py-3 text-sm font-black"
                    style={{
                      color: t.type === "income" ? "#10b981" : "#1f2937",
                      textAlign: "right",
                      paddingLeft: 10,
                      paddingRight: 10,
                    }}
                  >
                    {t.type === "income" ? "+" : ""}฿{t.amount.toFixed(2)}
                  </td>
                  {/* Spender */}
                  <td
                    className="py-3 text-xs font-bold"
                    style={{ color: "#7c3aed", paddingLeft: 10, paddingRight: 10 }}
                  >
                    {t.spender || "—"}
                  </td>
                  {/* Date */}
                  <td
                    className="py-3 text-xs font-bold"
                    style={{ color: "#9ca3af", paddingLeft: 10, paddingRight: 10 }}
                  >
                    <div>{formatDate(t.date)}</div>
                    {formatTime(t.date) && (
                      <div className="text-[10px] font-semibold mt-0.5" style={{ color: "#c4b5fd" }}>
                        {formatTime(t.date)}
                      </div>
                    )}
                  </td>
                  {/* Note */}
                  <td
                    className="py-3 text-xs font-semibold truncate max-w-[150px]"
                    style={{ color: "#6b7280", paddingLeft: 10, paddingRight: 10 }}
                  >
                    {t.note || "—"}
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

      {/* Mobile view: stacked cards so nothing gets clipped */}
      <div className="sm:hidden">
        {shown.map((t, i) => {
          const { icon, bg } = CATEGORY_ICONS[t.category] ?? { icon: "📦", bg: "#f9fafb" };
          return (
            <div
              key={t.id}
              className="px-4 py-3"
              style={{ borderBottom: i === shown.length - 1 ? "none" : "1px solid #fdf2f8" }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-7 h-7 rounded-xl flex items-center justify-center text-sm flex-shrink-0"
                    style={{ background: bg }}
                  >
                    {icon}
                  </div>
                  <span className="text-xs font-extrabold truncate" style={{ color: "#374151" }}>
                    {t.category}
                  </span>
                </div>
                <span
                  className="text-sm font-black flex-shrink-0"
                  style={{ color: t.type === "income" ? "#10b981" : "#1f2937" }}
                >
                  {t.type === "income" ? "+" : ""}฿{t.amount.toFixed(2)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 mt-1.5 pl-9">
                <div className="text-xs font-bold truncate" style={{ color: "#7c3aed" }}>
                  {t.spender || "—"}
                </div>
                <div className="text-xs font-bold text-right flex-shrink-0" style={{ color: "#9ca3af" }}>
                  {formatDate(t.date)}
                  {formatTime(t.date) && (
                    <span className="ml-1 font-semibold" style={{ color: "#c4b5fd" }}>
                      {formatTime(t.date)}
                    </span>
                  )}
                </div>
              </div>

              {t.note && (
                <div className="text-xs font-semibold mt-1 pl-9" style={{ color: "#6b7280" }}>
                  {t.note}
                </div>
              )}

              {hasActions && (
                <div className="flex items-center justify-end gap-1.5 mt-2">
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
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
