"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, ListTodo } from "lucide-react";
import { Icon } from "@/components/icons";
import { setActiveView } from "@/lib/active-view-cookie";
import { bellSections, PER_SECTION, sectionSummary, type BellItem as Item, type BellRole as RoleCount } from "@/lib/notifications/bell-sections";
import type { RoleView } from "@/lib/role-view";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The bell counts every unread notice, whatever role it is for, and groups them by role.
 * Opening a notice or task from another role switches to that role first.
 */
export function NotificationBell({ roleView }: { roleView?: RoleView }) {
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [roles, setRoles] = useState<RoleCount[]>([]);
  const [accountUnread, setAccountUnread] = useState(0);

  const load = useCallback(async () => {
    const response = await fetch("/api/notifications");
    if (!response.ok) return;
    const data = (await response.json()) as { unread: number; items: Item[]; roles?: RoleCount[]; accountUnread?: number };
    setUnread(data.unread);
    setItems(data.items);
    setRoles(data.roles ?? []);
    setAccountUnread(data.accountUnread ?? 0);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    const interval = window.setInterval(() => {
      void load();
    }, 30_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
    // A role switch reloads, so "current" follows the new role.
  }, [load, roleView]);

  function go(view: RoleView | null, href: string) {
    if (view && view !== roleView) {
      setActiveView(view);
      router.push(href);
      router.refresh();
      return;
    }
    router.push(href);
  }

  async function open(item: Item) {
    if (!item.read) {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      setItems((current) => current.map((row) => (row.id === item.id ? { ...row, read: true } : row)));
      setUnread((count) => Math.max(0, count - 1));
    }
    go(item.view, item.link || "/app/notifications");
  }

  const sections = bellSections(roles, items, accountUnread);
  const tasksWaiting = roles.reduce((sum, role) => sum + role.tasks, 0);
  const label = [
    "Notifications",
    unread > 0 ? `${unread} unread` : null,
    tasksWaiting > 0 ? `${tasksWaiting} ${tasksWaiting === 1 ? "task" : "tasks"} waiting` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="rec-bell">
      <DropdownMenu>
        <DropdownMenuTrigger className="rec-btn rec-btn--ghost rec-btn--icon" aria-label={label}>
          <span>
            <Icon icon={Bell} />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="rec-bell__menu">
          <DropdownMenuLabel>
            {unread > 0 ? `${unread} unread` : "Notifications"}
            {roles.length > 1 ? <span className="rec-muted"> across your roles</span> : null}
          </DropdownMenuLabel>
          {sections.map((section) => (
            <DropdownMenuGroup key={section.key} className="rec-bell__section">
              <DropdownMenuSeparator />
              {roles.length > 1 ? (
                <DropdownMenuLabel className="rec-bell__head">
                  <span className="rec-bell__role">
                    {section.title}
                    {section.current ? <span className="rec-bell__now">Current</span> : null}
                  </span>
                  <span className="rec-bell__sum">{sectionSummary(section)}</span>
                </DropdownMenuLabel>
              ) : null}
              {section.tasks > 0 ? (
                <DropdownMenuItem className="rec-bell__task" onClick={() => go(section.view, "/app/tasks")}>
                  <Icon icon={ListTodo} size={16} />
                  <span>
                    {section.tasks} {section.tasks === 1 ? "task is" : "tasks are"} waiting
                    {section.current || !section.view ? null : <span className="rec-muted"> · switches to {section.title}</span>}
                  </span>
                </DropdownMenuItem>
              ) : null}
              {section.items.slice(0, PER_SECTION).map((item) => (
                <DropdownMenuItem key={item.id} className="rec-bell__item" data-unread={item.read ? undefined : "true"} onClick={() => void open(item)}>
                  <span className="rec-bell__title">{item.title}</span>
                </DropdownMenuItem>
              ))}
              {section.items.length === 0 && section.tasks === 0 ? (
                <DropdownMenuItem disabled>Nothing new</DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<Link href="/app/notifications" />}>All notifications</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {unread > 0 ? (
        <span className="rec-bell__count" aria-hidden="true">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : tasksWaiting > 0 ? (
        <span className="rec-bell__dot" aria-hidden="true" />
      ) : null}
    </div>
  );
}
