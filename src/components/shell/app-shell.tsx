"use client";

import { usePathname } from "next/navigation";
import { Bell, Menu } from "lucide-react";
import { motion } from "motion/react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { SidebarPanel } from "@/components/shell/sidebar";
import { pageForPath, type RoleView } from "@/components/shell/nav";
import { ThemeSwitch } from "@/components/theme/theme-switch";
import Link from "next/link";

export function AppShell({
  collapsed: collapsedInitial,
  children,
  pageTitle,
  roleView = "proponent",
  roleViews,
  account,
}: {
  collapsed: boolean;
  children: React.ReactNode;
  pageTitle?: string;
  roleView?: RoleView;
  roleViews?: RoleView[];
  account?: { name: string; email: string };
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(collapsedInitial);
  const [open, setOpen] = useState(false);
  const page = pageForPath(pathname);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `sidebar=${next ? "rail" : "expanded"}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  return (
    <div className="rec-shell">
      <a className="skip" href="#content">
        Skip to content
      </a>
      <div className="rec-side--desktop">
        <SidebarPanel
          pathname={pathname}
          collapsed={collapsed}
          onToggle={toggleCollapsed}
          roleView={roleView}
          roleViews={roleViews}
          markerId="nav-marker-desktop"
          account={account}
        />
      </div>
      <div className="rec-main">
        <header className="rec-top">
          <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
            <DialogPrimitive.Trigger className="rec-btn rec-btn--ghost rec-btn--icon rec-top__menu" aria-label="Open menu">
              <span>
                <Icon icon={Menu} />
              </span>
            </DialogPrimitive.Trigger>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Backdrop className="rec-scrim" />
              <DialogPrimitive.Popup className="rec-drawer">
                <DialogPrimitive.Title className="rec-sr">Navigation</DialogPrimitive.Title>
                <motion.div
                  style={{ height: "100%" }}
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={{ left: 0.45, right: 0 }}
                  onDragEnd={(_, info) => {
                    if (info.offset.x < -80) setOpen(false);
                  }}
                >
                  <SidebarPanel
                    pathname={pathname}
                    collapsed={false}
                    roleView={roleView}
                    roleViews={roleViews}
                    markerId="nav-marker-drawer"
                    showCollapse={false}
                    account={account}
                  />
                </motion.div>
              </DialogPrimitive.Popup>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
          <nav aria-label="Breadcrumb">
            <ol className="rec-crumbs">
              <li>
                <Link href="/app">REC-DMS</Link>
              </li>
              <li aria-current="page">{pageTitle ?? page?.title ?? "Page"}</li>
            </ol>
          </nav>
          <div className="rec-top__end">
            <button type="button" className="rec-btn rec-btn--ghost rec-btn--icon" aria-label="Notifications">
              <span>
                <Icon icon={Bell} />
              </span>
            </button>
            <div className="rec-top__theme">
              <ThemeSwitch />
            </div>
          </div>
        </header>
        <main key={`${pathname}:${roleView}`} id="content" className="rec-page rec-content">
          {children}
        </main>
      </div>
    </div>
  );
}
