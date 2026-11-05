"use client";

import { useEffect, useState } from "react";
import { Toaster as Sonner, toast, type ToasterProps } from "sonner";
import { CircleCheck, Info, OctagonX, TriangleAlert } from "lucide-react";
import { Icon } from "@/components/icons";

function useResolvedTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.getAttribute("data-theme") === "dark" ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export function Toaster({ ...props }: ToasterProps) {
  const theme = useResolvedTheme();
  return (
    <Sonner
      theme={theme}
      icons={{
        success: <Icon icon={CircleCheck} size={16} />,
        info: <Icon icon={Info} size={16} />,
        warning: <Icon icon={TriangleAlert} size={16} />,
        error: <Icon icon={OctagonX} size={16} />,
        loading: <span className="rec-bar" style={{ width: 16 }} />,
      }}
      toastOptions={{
        className: "rec-toast",
      }}
      style={
        {
          "--normal-bg": "var(--surface-raised)",
          "--normal-text": "var(--ink)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-md)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { toast };
