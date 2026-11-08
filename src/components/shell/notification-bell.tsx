"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Icon } from "@/components/icons";
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

export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Item[]>([]);

  const load = useCallback(async () => {
    const response = await fetch("/api/notifications");
    if (!response.ok) return;
    const data = (await response.json()) as { unread: number; items: Item[] };
    setUnread(data.unread);
    setItems(data.items);
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
  }, [load]);

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
          <DropdownMenuItem render={<Link href="/app/notifications" />}>All notifications</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {unread > 0 ? <span className="rec-bell__dot" aria-hidden="true" /> : null}
    </div>
  );
}
