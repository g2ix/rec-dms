"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const PROTOCOL_TABS = [
  { href: "", label: "Overview" },
  { href: "/details", label: "Details" },
  { href: "/members", label: "Members" },
  { href: "/forms", label: "Forms" },
  { href: "/uploads", label: "Uploads" },
  { href: "/versions", label: "Versions" },
  { href: "/activity", label: "Activity" },
  { href: "/logbook", label: "Logbook" },
];

export function ProtocolNav({ protocolId }: { protocolId: string }) {
  const pathname = usePathname();
  const base = `/app/protocols/${protocolId}`;
  return (
    <nav className="rec-proto-nav" aria-label="Protocol">
      {PROTOCOL_TABS.map((tab) => {
        const href = `${base}${tab.href}`;
        const current = tab.href === "" ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={tab.href} href={href} aria-current={current ? "page" : undefined}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
