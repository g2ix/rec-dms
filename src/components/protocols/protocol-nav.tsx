"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check } from "lucide-react";
import { Icon } from "@/components/icons";
import type { ChecklistTab } from "@/lib/protocols/checklist";

export const PROTOCOL_TABS: { href: string; label: string; checklist?: ChecklistTab }[] = [
  { href: "", label: "Overview" },
  { href: "/details", label: "Details", checklist: "details" },
  { href: "/members", label: "Members", checklist: "members" },
  { href: "/forms", label: "Forms", checklist: "forms" },
  { href: "/uploads", label: "Uploads", checklist: "uploads" },
  { href: "/versions", label: "Versions" },
  { href: "/activity", label: "Activity" },
  { href: "/logbook", label: "Logbook" },
];

/** `counts` holds the missing required items per tab, from getSubmissionChecklist. Tabs it leaves out show no mark. */
export function ProtocolNav({ protocolId, counts = {} }: { protocolId: string; counts?: Partial<Record<ChecklistTab, number>> }) {
  const pathname = usePathname();
  const base = `/app/protocols/${protocolId}`;
  return (
    <nav className="rec-proto-nav" aria-label="Protocol">
      {PROTOCOL_TABS.map((tab) => {
        const href = `${base}${tab.href}`;
        const current = tab.href === "" ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
        const left = tab.checklist ? counts[tab.checklist] : undefined;
        return (
          <Link key={tab.href} href={href} aria-current={current ? "page" : undefined}>
            {tab.label}
            {left === undefined ? null : left > 0 ? (
              <span className="rec-proto-nav__count" aria-label={`${left} required left`}>
                {left}
              </span>
            ) : (
              <span className="rec-proto-nav__done" role="img" aria-label="complete">
                <Icon icon={Check} size={14} />
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
