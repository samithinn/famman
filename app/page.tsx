"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import Sidebar, { View } from "@/components/Sidebar";
import Dashboard from "@/components/Dashboard";
import TransactionsView from "@/components/TransactionsView";
import AddTransactionModal from "@/components/AddTransactionModal";
import { Transaction } from "@/lib/supabase";
import SettingsView from "@/components/SettingsView";

const BOTTOM_NAV: { label: string; view: View; icon: string }[] = [
  { label: "Home",    view: "dashboard",    icon: "🏠" },
  { label: "Report",  view: "report",       icon: "📅" },
  { label: "Txns",    view: "transactions", icon: "💳" },
  { label: "Settings",view: "settings",     icon: "⚙️" },
];

export default function Home() {
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [showModal, setShowModal] = useState(false);
  const [lastAdded, setLastAdded] = useState<Transaction | null>(null);

  const handleSuccess = (tx: Transaction) => setLastAdded(tx);

  const renderView = () => {
    switch (activeView) {
      case "dashboard":
      case "report":
        return <Dashboard newTransaction={lastAdded} onAddTransaction={() => setShowModal(true)} />;
      case "transactions":
        return <TransactionsView newTransaction={lastAdded} onAddTransaction={() => setShowModal(true)} />;
      case "settings":
        return <SettingsView />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#fafafa" }}>
      {/* Desktop sidebar */}
      <Sidebar
        activeView={activeView}
        onViewChange={setActiveView}
        onAddTransaction={() => setShowModal(true)}
      />

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top padding for gradient bar */}
        <div className="md:hidden flex-shrink-0" style={{ height: 52 }} />

        {/* View content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {renderView()}
        </div>

        {/* Mobile bottom nav */}
        <nav
          className="md:hidden flex-shrink-0 flex items-center border-t"
          style={{ background: "#fff", borderColor: "#f3e8ff", paddingBottom: 4, paddingTop: 4 }}
        >
          {BOTTOM_NAV.map(({ label, view, icon }) => {
            const isActive = activeView === view || (view === "report" && activeView === "dashboard");
            return (
              <button
                key={view}
                onClick={() => setActiveView(view)}
                className="flex-1 flex flex-col items-center gap-0.5 py-1"
              >
                <span className="text-lg">{icon}</span>
                <span
                  className="text-xs font-extrabold"
                  style={{ color: isActive ? "#ec4899" : "#9ca3af" }}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </nav>
      </main>

      <AddTransactionModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
