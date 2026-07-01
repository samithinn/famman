export const CATEGORY_ICONS: Record<string, { icon: string; bg: string }> = {
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

export function categoryIcon(category: string): string {
  return CATEGORY_ICONS[category]?.icon ?? CATEGORY_ICONS.Other.icon;
}
