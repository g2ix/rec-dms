"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { Icon } from "@/components/icons";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useTheme, type ThemeChoice } from "@/components/theme/theme-provider";

const options: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
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
