import { describe, expect, it } from "vitest";
import { bellSections, sectionSummary, type BellItem, type BellRole } from "@/lib/notifications/bell-sections";

const item = (id: string, view: BellItem["view"]): BellItem => ({
  id,
  title: id,
  body: "",
  link: null,
  read: false,
  createdAt: "2026-11-23T00:00:00.000Z",
  view,
});

const role = (view: BellRole["view"], current: boolean, unread = 0, tasks = 0): BellRole => ({
  view,
  label: view,
  unread,
  tasks,
  current,
});

describe("bellSections", () => {
  it("puts the current role first, then the account, then roles with something waiting", () => {
    const roles = [role("proponent", false, 1), role("reviewer", false, 0, 0), role("staff", true, 0, 2)];
    const items = [item("a", "proponent"), item("b", null), item("c", "staff")];
    const sections = bellSections(roles, items, 1);
    expect(sections.map((section) => section.key)).toEqual(["staff", "account", "proponent"]);
    expect(sections[0]?.items.map((row) => row.id)).toEqual(["c"]);
    expect(sections[0]?.tasks).toBe(2);
  });

  it("keeps the current role even when nothing waits there", () => {
    const sections = bellSections([role("proponent", true), role("reviewer", false, 0, 3)], [], 0);
    expect(sections.map((section) => section.key)).toEqual(["proponent", "reviewer"]);
  });

  it("does not split the list for a person with one role", () => {
    const sections = bellSections([role("proponent", true, 1)], [item("a", "proponent"), item("b", null)], 2);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.items).toHaveLength(2);
    expect(sections[0]?.unread).toBe(3);
  });

  it("summarises unread notices and tasks", () => {
    const [section] = bellSections([role("staff", true, 2, 1)], [], 0);
    expect(section && sectionSummary(section)).toBe("2 unread · 1 task");
  });
});
