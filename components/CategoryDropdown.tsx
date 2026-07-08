"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface CategoryDropdownProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export const ALL_CATEGORIES = "__all__";

export default function CategoryDropdown({ value, onChange, className }: CategoryDropdownProps) {
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    supabase.from("categories").select("name").order("name").then(({ data }) => {
      const names = (data ?? []).map((c) => c.name as string);
      const seen = new Set<string>();
      const unique = names.filter((name) => {
        const key = name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setCategories(unique);
    });
  }, []);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? "text-xs font-bold rounded-xl px-3 py-2 cursor-pointer outline-none"}
      style={{ border: "2px solid #f3e8ff", color: "#374151", fontFamily: "Nunito" }}
    >
      <option value={ALL_CATEGORIES}>All Categories</option>
      {categories.map((name) => (
        <option key={name} value={name}>{name}</option>
      ))}
    </select>
  );
}
