"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { LayoutGroup, motion } from "motion/react";
import { Seal } from "@/components/brand/seal";
import { Icon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { activeHref, NAV, ROLE_LABEL, type NavItem, type RoleView } from "@/components/shell/nav";

export function SidebarCollapse({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const label = collapsed ? "Expand menu" : "Collapse menu";
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        className="rec-collapse"
        aria-label={label}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <span className="rec-collapse__face">
          <Icon icon={collapsed ? ChevronRight : ChevronLeft} size={16} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function SidebarPanel({
  pathname,
  collapsed,
  roleView = "proponent",
  roleViews,
  roleSwitcher,
  markerId,
  counts,
}: {
  pathname: string;
  collapsed: boolean;
  roleView?: RoleView;
  roleViews?: RoleView[];
  roleSwitcher?: React.ReactNode;
  markerId: string;
  counts?: Record<string, { value: number; overdue?: boolean; waiting?: boolean }>;
}) {
  const groups = NAV[roleView];
  const items = groups.flatMap((group) => group.items);
  const current = activeHref(pathname, items);

  return (
    <div className="rec-side" data-collapsed={collapsed ? "true" : "false"}>
      <Link href="/app" className="rec-side__brand">
        <Seal size={32} />
        <span className="subheading rec-side__label">REC-DMS</span>
      </Link>
      <div className="rec-side__body">
        {roleSwitcher ?? (
          <RoleSwitch roleView={roleView} roleViews={roleViews ?? [roleView]} />
        )}
        <LayoutGroup id={markerId}>
          {groups.map((group) => (
            <div key={group.label ?? "main"}>
              {group.label ? <p className="rec-side__group">{group.label}</p> : null}
              <div className="rec-nav">
                {group.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    active={item.href === current}
                    collapsed={collapsed}
                    markerId={markerId}
                    count={counts?.[item.href]}
                  />
                ))}
              </div>
            </div>
          ))}
        </LayoutGroup>
      </div>
    </div>
  );
}

function RoleSwitch({ roleView, roleViews }: { roleView: RoleView; roleViews: RoleView[] }) {
  const router = useRouter();
  if (roleViews.length < 2) {
    return (
      <div className="rec-role">
        <Icon icon={ChevronsUpDown} size={16} />
        <span className="rec-side__label">{ROLE_LABEL[roleView]}</span>
      </div>
    );
  }

  function select(view: RoleView) {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `activeView=${view}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rec-role" aria-label="Switch role">
        <Icon icon={ChevronsUpDown} size={16} />
        <span className="rec-side__label">{ROLE_LABEL[roleView]}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {roleViews.map((view) => (
          <DropdownMenuItem
            key={view}
            aria-current={view === roleView ? "true" : undefined}
            onClick={() => {
              if (view !== roleView) select(view);
            }}
          >
            {ROLE_LABEL[view]}
            {view === roleView ? <Icon icon={Check} size={16} className="rec-menu__check" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavLink({
  item,
  active,
  collapsed,
  markerId,
  count,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  markerId: string;
  count?: { value: number; overdue?: boolean; waiting?: boolean };
}) {
  const link = (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={count?.waiting ? `${item.label}, ${count.value} waiting` : undefined}
    >
      {active ? (
        <motion.span
          layoutId={markerId}
          className="rec-nav__marker"
          transition={{ duration: 0.24, ease: [0.34, 1.56, 0.64, 1] }}
        />
      ) : null}
      <Icon icon={item.icon} />
      <span className="rec-side__label">{item.label}</span>
      {count ? (
        <span
          className={
            count.waiting
              ? "rec-nav__count rec-nav__count--waiting"
              : count.overdue
                ? "rec-nav__count rec-nav__count--overdue rec-side__label"
                : "rec-nav__count rec-side__label"
          }
        >
          {count.value}
        </span>
      ) : null}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent>{count?.waiting ? `${item.label}, ${count.value} waiting` : item.label}</TooltipContent>
    </Tooltip>
  );
}
