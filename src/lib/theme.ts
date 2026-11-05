export type ThemeChoice = "light" | "dark" | "system";

export function parseThemeChoice(value: string | undefined): ThemeChoice {
  if (value === "light" || value === "dark" || value === "system") return value;
  return "system";
}
