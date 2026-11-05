"use client";

import { MotionConfig } from "motion/react";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ThemeChoice } from "@/lib/theme";

export function Providers({
  initialChoice,
  children,
}: {
  initialChoice: ThemeChoice;
  children: React.ReactNode;
}) {
  return (
    <ThemeProvider initialChoice={initialChoice}>
      <TooltipProvider>
        <MotionConfig reducedMotion="user">
          {children}
          <Toaster />
        </MotionConfig>
      </TooltipProvider>
    </ThemeProvider>
  );
}
