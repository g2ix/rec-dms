import {
  ChartColumn,
  ClipboardCheck,
  FilePlus,
  FileText,
  FolderOpen,
  Gavel,
  Inbox,
  LayoutDashboard,
  Library,
  ListChecks,
  Receipt,
  ScrollText,
  Send,
  Settings,
  UserRound,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { RoleView } from "@/lib/role-view";

export type { RoleView } from "@/lib/role-view";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export type NavGroup = {
  label?: string;
  items: NavItem[];
};

export const ROLE_LABEL: Record<RoleView, string> = {
  proponent: "Proponent",
  adviser: "Adviser",
  reviewer: "Reviewer",
  "panel-chair": "Panel Chair",
  staff: "REC Staff",
  chair: "REC Chair",
};

const staffItems: NavItem[] = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/screening", label: "Screening queue", icon: Inbox },
  { href: "/app/receipts", label: "Fee receipts", icon: Receipt },
  { href: "/app/releases", label: "Releases", icon: Send },
  { href: "/app/protocols", label: "All protocols", icon: Library },
  { href: "/app/users", label: "Users", icon: Users },
  { href: "/app/reports", label: "Reports", icon: ChartColumn },
];

const chairItems: NavItem[] = [
  ...staffItems,
  { href: "/app/workflows", label: "Workflows", icon: Workflow },
  { href: "/admin/forms", label: "Forms", icon: FileText },
  { href: "/app/settings", label: "Settings", icon: Settings },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
];

export const NAV: Record<RoleView, NavGroup[]> = {
  proponent: [
    {
      items: [
        { href: "/app", label: "Dashboard", icon: LayoutDashboard },
        { href: "/app/tasks", label: "My tasks", icon: ListChecks },
        { href: "/app/protocols", label: "My protocols", icon: FolderOpen },
        { href: "/app/protocols/new", label: "New protocol", icon: FilePlus },
      ],
    },
  ],
  adviser: [
    {
      items: [
        { href: "/app", label: "Dashboard", icon: LayoutDashboard },
        { href: "/app/tasks", label: "My tasks", icon: ListChecks },
        { href: "/app/advised", label: "Advised protocols", icon: Users },
      ],
    },
  ],
  reviewer: [
    {
      items: [
        { href: "/app", label: "Dashboard", icon: LayoutDashboard },
        { href: "/app/reviews", label: "My reviews", icon: ClipboardCheck },
      ],
    },
  ],
  "panel-chair": [
    {
      items: [
        { href: "/app", label: "Dashboard", icon: LayoutDashboard },
        { href: "/app/decisions", label: "Decisions", icon: Gavel },
        { href: "/app/panel", label: "Panel protocols", icon: FolderOpen },
        { href: "/app/reviewers", label: "Reviewers", icon: UserRound },
      ],
    },
  ],
  staff: [{ items: staffItems }],
  chair: [{ items: chairItems }],
};

const LEDES: Record<string, string> = {
  "/app": "Work waiting for you in this role will be listed here.",
  "/app/tasks": "Tasks assigned to you will be listed here.",
  "/app/protocols": "Protocols you can open will be listed here.",
  "/app/protocols/new": "The new protocol wizard will start here.",
  "/app/advised": "Protocols you advise will be listed here.",
  "/app/reviews": "Reviews assigned to you will be listed here.",
  "/app/decisions": "Decisions waiting for the panel will be listed here.",
  "/app/panel": "Protocols in this panel will be listed here.",
  "/app/reviewers": "Reviewers in this panel will be listed here.",
  "/app/screening": "Submissions waiting for screening will be listed here.",
  "/app/receipts": "Fee receipts will be listed here.",
  "/app/releases": "Decisions ready to release will be listed here.",
  "/app/users": "Accounts and memberships will be listed here.",
  "/app/reports": "Committee reports will be listed here.",
  "/app/workflows": "Workflow versions will be listed here.",
  "/admin/forms": "Form definitions, versions, and the sandbox.",
  "/app/settings": "Committee settings will be edited here.",
  "/admin/audit": "Recorded actions and the hash chain.",
};

const EXTRA_PAGES: { href: string; title: string; lede: string }[] = [
  {
    href: "/app/account/sign-in-methods",
    title: "Sign-in methods",
    lede: "Google accounts, emails, and your password.",
  },
  {
    href: "/app/account/merge",
    title: "Merge accounts",
    lede: "Confirm both accounts before they become one.",
  },
];

export function pageForPath(pathname: string): { href: string; title: string; lede: string } | null {
  if (pathname.startsWith("/app/account/merge/")) {
    return EXTRA_PAGES[1] ?? null;
  }
  const extra = EXTRA_PAGES.find((page) => page.href === pathname);
  if (extra) return extra;
  const items = Object.values(NAV).flatMap((groups) => groups.flatMap((group) => group.items));
  const match = items
    .filter((item) => item.href === pathname)
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (!match || !LEDES[match.href]) return null;
  return { href: match.href, title: match.label, lede: LEDES[match.href] };
}

export function activeHref(pathname: string, items: NavItem[]): string | undefined {
  return items
    .filter((item) => (item.href === "/app" ? pathname === "/app" : pathname === item.href || pathname.startsWith(`${item.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}
