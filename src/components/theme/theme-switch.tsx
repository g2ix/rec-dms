"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { Icon } from "@/components/icons";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useTheme, type ThemeChoice } from "@/components/theme/theme-provider";

const options: { value: ThemeChoice; label: string; aria: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", aria: "Light theme", icon: Sun },
  { value: "dark", label: "Dark", aria: "Dark theme", icon: Moon },
  { value: "system", label: "System", aria: "Match system theme", icon: Monitor },
];

export function ThemeSwitch() {
  const { choice, setChoice } = useTheme();
  return (
    <SegmentedControl
      label="Theme"
      value={choice}
      onChange={setChoice}
      options={options.map((option) => ({
        value: option.value,
        label: option.label,
        icon: <Icon icon={option.icon} size={16} />,
      }))}
    />
  );
}

export function ThemeIconSwitch() {
  const { choice, setChoice } = useTheme();
  return (
    <div className="rec-theme-icons" role="group" aria-label="Theme">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="rec-theme-btn"
          aria-label={option.aria}
          aria-pressed={choice === option.value}
          onClick={() => setChoice(option.value)}
        >
          <Icon icon={option.icon} size={16} />
        </button>
      ))}
    </div>
  );
}
