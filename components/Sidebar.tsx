"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

export type View = "dashboard" | "transactions" | "report" | "settings";

interface SidebarProps {
  activeView: View;
  onViewChange: (view: View) => void;
  onAddTransaction: () => void;
}

const navItems: { label: string; view: View; icon: string }[] = [
  { label: "Dashboard",       view: "dashboard",    icon: "📊" },
  { label: "Transactions",    view: "transactions", icon: "💳" },
  { label: "Monthly Report",  view: "report",       icon: "📅" },
  { label: "Settings",        view: "settings",     icon: "⚙️" },
];

export default function Sidebar({ activeView, onViewChange, onAddTransaction }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();

  const SidebarContent = () => (
    <div className="flex flex-col h-full" style={{ background: "#f0ebff" }}>
      {/* Logo */}
      <div className="px-5 py-5 border-b flex items-center gap-2.5" style={{ borderColor: "#e9d5ff" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="FamMan" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
        <div>
          <div className="text-lg font-black leading-tight" style={{ color: "#5b21b6" }}>FamMan</div>
          <div className="text-xs font-extrabold mt-0.5" style={{ color: "#a78bfa", letterSpacing: "0.3px" }}>
            Expenses and Incomes Tracker
          </div>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {navItems.map(({ label, view, icon }) => {
          const isActive = activeView === view;
          return (
            <button
              key={view}
              onClick={() => { onViewChange(view); setMobileOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-bold transition-all duration-150"
              style={
                isActive
                  ? {
                      background: "#fce7f3",
                      borderLeft: "3px solid #ec4899",
                      color: "#be185d",
                      paddingLeft: "10px",
                    }
                  : { color: "#7c3aed" }
              }
            >
              <span className="text-base">{icon}</span>
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Profile link */}
        <button
          onClick={() => { router.push("/profile"); setMobileOpen(false); }}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-bold transition-all duration-150"
          style={{ color: "#7c3aed" }}
        >
          <span className="text-base">👤</span>
          <span>Profile</span>
        </button>

      {/* Auto-sync panel */}
      <div className="p-3">
        <div
          className="rounded-xl p-3"
          style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}
        >
          <div
            className="text-xs font-extrabold mb-2"
            style={{ color: "#6b7280", letterSpacing: "1px" }}
          >
            AUTO-SYNC
          </div>
          <div className="flex items-center gap-1.5 mb-1">
            <div
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: "#10b981", boxShadow: "0 0 6px #10b981" }}
            />
            <span className="text-xs font-extrabold" style={{ color: "#15803d" }}>
              LINE Bot Active
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: "#10b981", boxShadow: "0 0 6px #10b981" }}
            />
            <span className="text-xs font-extrabold" style={{ color: "#15803d" }}>
              iOS Shortcuts Active
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex flex-col w-56 min-h-screen shrink-0 border-r"
        style={{ background: "#f0ebff", borderColor: "#e9d5ff" }}
      >
        <SidebarContent />
      </aside>

      {/* Mobile top bar */}
      <div
        className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4"
        style={{
          height: 52,
          background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
        }}
      >
        <button
          onClick={() => setMobileOpen(true)}
          className="w-9 h-9 rounded-xl flex flex-col items-center justify-center gap-1"
          style={{ background: "rgba(255,255,255,0.18)" }}
        >
          <div className="w-4 h-0.5 rounded-full bg-white" />
          <div className="w-3 h-0.5 rounded-full self-start ml-3" style={{ background: "rgba(255,255,255,0.7)" }} />
          <div className="w-4 h-0.5 rounded-full bg-white" />
        </button>
        <span className="flex items-center gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="FamMan" className="w-6 h-6 rounded-md object-cover" />
          <span className="text-sm font-black text-white">FamMan</span>
        </span>
        <button
          onClick={onAddTransaction}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-base"
          style={{ background: "rgba(255,255,255,0.18)" }}
        >
          ➕
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)" }}
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative w-64 flex flex-col shadow-xl" style={{ background: "#f0ebff" }}>
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: "#e9d5ff" }}
            >
              <X size={16} style={{ color: "#7c3aed" }} />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}
    </>
  );
}
