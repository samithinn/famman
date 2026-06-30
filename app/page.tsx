"use client";

import { useState } from "react";
import Sidebar, { View } from "@/components/Sidebar";
import Dashboard from "@/components/Dashboard";
import TransactionsView from "@/components/TransactionsView";
import AddTransactionModal from "@/components/AddTransactionModal";
import { Transaction } from "@/lib/supabase";

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
        return (
          <div className="flex flex-col h-full">
            <div className="sticky top-0 z-10 bg-white px-5 py-4" style={{ borderBottom: "1px solid #f3e8ff" }}>
              <h1 className="text-lg font-black" style={{ color: "#1f2937" }}>Settings ⚙️</h1>
            </div>
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center">
                <div className="text-5xl mb-3">⚙️</div>
                <p className="text-sm font-bold" style={{ color: "#9ca3af" }}>Settings coming soon</p>
              </div>
            </div>
          </div>
        );
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
