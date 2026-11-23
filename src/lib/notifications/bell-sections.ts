import type { RoleView } from "@/lib/role-view";

export type BellItem = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
  view: RoleView | null;
};

export type BellRole = { view: RoleView; label: string; unread: number; tasks: number; current: boolean };

export type BellSection = { key: string; view: RoleView | null; title: string; current: boolean; unread: number; tasks: number; items: BellItem[] };

export const PER_SECTION = 4;

/** Current role first, then account notices, then the other roles in switcher order. */
export function bellSections(roles: BellRole[], items: BellItem[], accountUnread: number): BellSection[] {
  const ordered = [...roles.filter((role) => role.current), ...roles.filter((role) => !role.current)];
  const several = roles.length > 1;
  const sections: BellSection[] = ordered.map((role) => ({
    key: role.view,
    view: role.view,
    title: role.label,
    current: role.current,
    unread: role.unread,
    tasks: role.tasks,
    items: items.filter((item) => item.view === role.view),
  }));
  const account: BellSection = {
    key: "account",
    view: null,
    title: "Your account",
    current: false,
    unread: accountUnread,
    tasks: 0,
    items: items.filter((item) => item.view === null),
  };
  if (!several) {
    // One role: no need to split the list.
    const only = sections[0];
    if (!only) return [account];
    return [{ ...only, unread: only.unread + accountUnread, items: items }];
  }
  sections.splice(1, 0, account);
  return sections.filter((section) => section.current || section.items.length > 0 || section.tasks > 0 || section.unread > 0);
}

export function sectionSummary(section: BellSection): string {
  const parts: string[] = [];
  if (section.unread > 0) parts.push(`${section.unread} unread`);
  if (section.tasks > 0) parts.push(`${section.tasks} ${section.tasks === 1 ? "task" : "tasks"}`);
  return parts.join(" · ");
}
