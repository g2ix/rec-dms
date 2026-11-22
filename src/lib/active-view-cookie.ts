import type { RoleView } from "@/lib/role-view";

/** Switches the role the app is viewed as (the activeView cookie). Browser only. */
export function setActiveView(view: RoleView): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `activeView=${view}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}
