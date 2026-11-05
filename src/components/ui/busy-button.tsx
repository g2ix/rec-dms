"use client";

import { Button } from "@/components/ui/button";

type BusyButtonProps = React.ComponentProps<typeof Button> & {
  busy?: boolean;
  busyLabel?: React.ReactNode;
};

export function BusyButton({ busy = false, busyLabel, children, disabled, ...props }: BusyButtonProps) {
  return (
    <Button aria-busy={busy || undefined} disabled={disabled || busy} {...props}>
      {busy && busyLabel ? busyLabel : children}
    </Button>
  );
}
