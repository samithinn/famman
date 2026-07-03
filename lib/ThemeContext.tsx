import React, { createContext, useContext, useEffect, useState } from "react";

type ThemePreference = "system" | "dark" | "light";
type ResolvedTheme = "dark" | "light";

interface ThemeContextType {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [resolved, setResolved] = useState<ResolvedTheme>("light");
  const [mounted, setMounted] = useState(false);

  // Detect system preference
  const getSystemTheme = (): ResolvedTheme => {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };

  // Resolve theme based on preference
  const resolveTheme = (pref: ThemePreference): ResolvedTheme => {
    return pref === "system" ? getSystemTheme() : pref;
  };

  // Update preference and persist to DB
  const handleSetPreference = async (pref: ThemePreference) => {
    setPreference(pref);
    setResolved(resolveTheme(pref));
    applyTheme(resolveTheme(pref));

    // Persist to database
    const { data: { user } } = await (await import("@/lib/supabase")).supabase.auth.getUser();
    if (user) {
      await (await import("@/lib/supabase")).supabase
        .from("profiles")
        .update({ theme_preference: pref })
        .eq("id", user.id);
    }
  };

  // Apply theme to DOM
  const applyTheme = (theme: ResolvedTheme) => {
    const html = document.documentElement;
    if (theme === "dark") {
      html.classList.add("dark-mode");
      html.style.colorScheme = "dark";
    } else {
      html.classList.remove("dark-mode");
      html.style.colorScheme = "light";
    }
  };

  // On mount, load preference from DB and apply
  useEffect(() => {
    const loadTheme = async () => {
      const { data: { user } } = await (await import("@/lib/supabase")).supabase.auth.getUser();
      if (user) {
        const { data: profile } = await (await import("@/lib/supabase")).supabase
          .from("profiles")
          .select("theme_preference")
          .eq("id", user.id)
          .single();
        const pref: ThemePreference = (profile?.theme_preference as ThemePreference) || "system";
        setPreference(pref);
        setResolved(resolveTheme(pref));
        applyTheme(resolveTheme(pref));
      }
      setMounted(true);
    };
    loadTheme();

    // Listen for system theme changes
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      setPreference((prev) => {
        if (prev === "system") {
          const newTheme = getSystemTheme();
          setResolved(newTheme);
          applyTheme(newTheme);
        }
        return prev;
      });
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference: handleSetPreference }}>
      {mounted && children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
