"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { Icon } from "@/components/icons";
import { setActiveView } from "@/lib/active-view-cookie";
import type { RoleView } from "@/lib/role-view";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Item = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
};

type Elsewhere = { view: RoleView; label: string; count: number };

/**
 * The bell shows the notices for the role the app is viewed as, plus those not tied to a role.
 * Unread notices under the person's other roles are listed below, each switching to that role.
 */
export function NotificationBell({ roleView }: { roleView?: RoleView }) {
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [elsewhere, setElsewhere] = useState<Elsewhere[]>([]);

  const load = useCallback(async () => {
    const response = await fetch("/api/notifications");
    if (!response.ok) return;
    const data = (await response.json()) as { unread: number; items: Item[]; elsewhere?: Elsewhere[] };
    setUnread(data.unread);
    setItems(data.items);
    setElsewhere(data.elsewhere ?? []);
  }, []);

  function openAs(view: RoleView) {
    setActiveView(view);
    router.push("/app/notifications");
    router.refresh();
  }

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
    // A role switch reloads the list for the new role.
  }, [load, roleView]);

  async function mark(id: string) {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setItems((current) => current.map((item) => (item.id === id ? { ...item, read: true } : item)));
    setUnread((count) => Math.max(0, count - 1));
  }

  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";

  return (
    <div className="rec-bell">
      <DropdownMenu>
        <DropdownMenuTrigger className="rec-btn rec-btn--ghost rec-btn--icon" aria-label={label}>
          <span>
            <Icon icon={Bell} />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{unread > 0 ? `${unread} unread` : "Notifications"}</DropdownMenuLabel>
          {items.length === 0 ? (
            <DropdownMenuItem disabled>No notifications yet</DropdownMenuItem>
          ) : (
            items.map((item) => (
              <DropdownMenuItem
                key={item.id}
                render={<Link href={item.link || "/app/notifications"} onClick={() => void mark(item.id)} />}
              >
                <span>
                  <span className="label">{item.title}</span>
                  {item.read ? null : <span className="caption rec-muted"> Unread</span>}
                </span>
              </DropdownMenuItem>
            ))
          )}
          {elsewhere.map((item) => (
            <DropdownMenuItem key={item.view} onClick={() => openAs(item.view)}>
              <span className="caption">
                {item.count} unread as {item.label}. Switch to {item.label}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem render={<Link href="/app/notifications" />}>All notifications</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {unread > 0 || elsewhere.length > 0 ? <span className="rec-bell__dot" aria-hidden="true" /> : null}
    </div>
  );
}
