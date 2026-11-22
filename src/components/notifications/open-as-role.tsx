"use client";

import { useRouter } from "next/navigation";
import { setActiveView } from "@/lib/active-view-cookie";
import type { RoleView } from "@/lib/role-view";

/** Opens a notice that belongs to another of the person's roles: switches to that role first. */
export function OpenAsRole({ view, label, href }: { view: RoleView; label: string; href: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="rec-btn rec-btn--secondary"
      onClick={() => {
        setActiveView(view);
        router.push(href);
        router.refresh();
      }}
    >
      <span>Open as {label}</span>
    </button>
  );
}
