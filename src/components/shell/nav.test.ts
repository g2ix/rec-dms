import { describe, expect, it } from "vitest";
import { navGroups, type RoleView } from "@/components/shell/nav";

const hrefs = (view: RoleView, canManageUsers: boolean) =>
  navGroups(view, canManageUsers).flatMap((group) => group.items.map((item) => item.href));

describe("navGroups", () => {
  it.each<RoleView>(["staff", "chair"])("sends a user manager in the %s view to the management screens", (view) => {
    const items = hrefs(view, true);
    expect(items).toContain("/admin/users");
    expect(items).toContain("/admin/panels");
    expect(items).not.toContain("/app/users");
  });

  it.each<RoleView>(["staff", "chair"])("keeps the management screens from others in the %s view", (view) => {
    const items = hrefs(view, false);
    expect(items).toContain("/app/users");
    expect(items).not.toContain("/admin/users");
    expect(items).not.toContain("/admin/panels");
  });

  it.each<RoleView>(["proponent", "adviser", "reviewer", "panel-chair"])("leaves the %s view unchanged", (view) => {
    expect(hrefs(view, true)).toEqual(hrefs(view, false));
    expect(hrefs(view, true)).not.toContain("/admin/panels");
  });
});
