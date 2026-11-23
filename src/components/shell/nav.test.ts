import { describe, expect, it } from "vitest";
import { EMPTY_NAV_CAPABILITIES, navGroups, type NavCapabilities, type RoleView } from "@/components/shell/nav";

const hrefs = (view: RoleView, caps: Partial<NavCapabilities> = {}) =>
  navGroups(view, { ...EMPTY_NAV_CAPABILITIES, ...caps }).flatMap((group) => group.items.map((item) => item.href));

describe("navGroups", () => {
  it.each<RoleView>(["staff", "chair"])("sends a user manager in the %s view to one User management entry", (view) => {
    const items = hrefs(view, { manageUsers: true });
    expect(items).toContain("/admin/users");
    expect(items).not.toContain("/admin/panels");
    expect(items).not.toContain("/app/users");
  });

  it.each<RoleView>(["staff", "chair"])("keeps the management screens from others in the %s view", (view) => {
    const items = hrefs(view);
    expect(items).toContain("/app/users");
    expect(items).not.toContain("/admin/users");
    expect(items).not.toContain("/admin/panels");
  });

  it.each<RoleView>(["staff", "chair"])("shows gated admin links only when permitted in the %s view", (view) => {
    expect(hrefs(view)).not.toContain("/admin/audit");
    expect(hrefs(view)).not.toContain("/admin/forms");
    expect(hrefs(view)).not.toContain("/admin/workflows");
    expect(hrefs(view)).not.toContain("/admin/notifications");
    expect(hrefs(view)).not.toContain("/admin/holidays");
    expect(hrefs(view)).not.toContain("/admin/retention");
    expect(hrefs(view)).not.toContain("/admin/fees");

    const all = hrefs(view, {
      viewAudit: true,
      editForms: true,
      editWorkflow: true,
      editSettings: true,
      editHolidays: true,
      reviewRetention: true,
      manageFees: true,
    });
    expect(all).toEqual(
      expect.arrayContaining([
        "/admin/audit",
        "/admin/forms",
        "/admin/workflows",
        "/admin/notifications",
        "/admin/holidays",
        "/admin/retention",
        "/admin/fees",
      ]),
    );
  });

  it.each<RoleView>(["staff", "chair"])("lists each screen once with its own icon in the %s view", (view) => {
    const items = navGroups(view, {
      manageUsers: true,
      viewAudit: true,
      editForms: true,
      editWorkflow: true,
      editSettings: true,
      editHolidays: true,
      reviewRetention: true,
      manageFees: true,
    }).flatMap((group) => group.items);
    expect(new Set(items.map((item) => item.label)).size).toBe(items.length);
    expect(new Set(items.map((item) => item.icon)).size).toBe(items.length);
    expect(items.map((item) => item.href)).not.toContain("/app/settings");
  });

  it("drops a group whose links are all gated away", () => {
    const groups = navGroups("staff");
    expect(groups.every((group) => group.items.length > 0)).toBe(true);
    expect(groups.map((group) => group.label)).not.toContain("Administration");
  });

  it.each<RoleView>(["proponent", "adviser", "reviewer", "panel-chair"])("leaves the %s view unchanged", (view) => {
    expect(hrefs(view, { manageUsers: true, editForms: true })).toEqual(hrefs(view));
    expect(hrefs(view, { manageUsers: true })).not.toContain("/admin/panels");
  });
});
