"use client";

import { useTheme } from "@/lib/ThemeContext";
import { Monitor, Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
  const { preference, setPreference } = useTheme();

  const options: { value: "system" | "dark" | "light"; label: string; icon: React.ReactNode }[] = [
    { value: "system", label: "System", icon: <Monitor size={14} /> },
    { value: "dark", label: "Dark", icon: <Moon size={14} /> },
    { value: "light", label: "Light", icon: <Sun size={14} /> },
  ];

  return (
    <div className="space-y-3">
      <label className="block text-xs font-extrabold" style={{ color: "#9ca3af", letterSpacing: "0.8px" }}>
        APPEARANCE
      </label>
      <div className="flex gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setPreference(opt.value)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-extrabold transition-all"
            style={{
              background: preference === opt.value ? "linear-gradient(135deg, #ec4899, #8b5cf6)" : "#fafafa",
              color: preference === opt.value ? "#fff" : "#7c3aed",
              border: preference === opt.value ? "none" : "2px solid #f3e8ff",
            }}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </button>
        ))}
      </div>
      <p className="text-xs font-semibold" style={{ color: "#c4b5fd" }}>
        {preference === "system" && "Following your device settings"}
        {preference === "dark" && "Dark mode enabled"}
        {preference === "light" && "Light mode enabled"}
      </p>
    </div>
  );
}
