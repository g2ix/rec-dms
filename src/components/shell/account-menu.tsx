"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { signOutAction } from "@/server/auth/actions";
import { Icon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : first.slice(1);
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

export function AccountMenu({ name }: { name: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rec-account" aria-label={name}>
        <span className="rec-account__avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <span className="rec-account__name">{name}</span>
        <Icon icon={ChevronDown} size={16} className="rec-account__chev" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem render={<Link href="/app/account/profile" />}>Your details</DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/app/account/signature" />}>Signature</DropdownMenuItem>
        <form action={signOutAction}>
          <DropdownMenuItem nativeButton render={<button type="submit" />}>
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
