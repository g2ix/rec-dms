"use client";

import { createContext, useContext, useState } from "react";
import type { ThemeChoice } from "@/lib/theme";

export type { ThemeChoice };

type ThemeContextValue = {
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolve(choice: ThemeChoice): "light" | "dark" {
  if (choice === "light" || choice === "dark") return choice;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({
  initialChoice,
  children,
}: {
  initialChoice: ThemeChoice;
  children: React.ReactNode;
}) {
  const [choice, setChoiceState] = useState<ThemeChoice>(initialChoice);

  function setChoice(next: ThemeChoice) {
    const root = document.documentElement;
    root.classList.add("theme-fade");
    root.setAttribute("data-theme-pref", next);
    root.setAttribute("data-theme", resolve(next));
    document.cookie = `theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setChoiceState(next);
  }

  return <ThemeContext.Provider value={{ choice, setChoice }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
