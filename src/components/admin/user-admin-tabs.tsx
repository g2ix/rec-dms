"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/users", label: "People" },
  { href: "/admin/users/pending", label: "Pending approval" },
  { href: "/admin/users/panels", label: "Panels" },
  { href: "/admin/users/merge", label: "Merge accounts" },
] as const;

function currentTab(pathname: string): string {
  const named = TABS.find((tab) => tab.href !== "/admin/users" && (pathname === tab.href || pathname.startsWith(`${tab.href}/`)));
  return named?.href ?? "/admin/users";
}

/** One place for everything about accounts. A person's page sits under People. */
export function UserAdminTabs({ pendingCount }: { pendingCount: number }) {
  const current = currentTab(usePathname());
  return (
    <nav className="rec-proto-nav rec-admin-tabs" aria-label="User management">
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} aria-current={tab.href === current ? "page" : undefined}>
          {tab.label}
          {tab.href === "/admin/users/pending" && pendingCount > 0 ? (
            <span className="rec-proto-nav__count" aria-label={`${pendingCount} waiting`}>
              {pendingCount}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
