export const ROLE_VIEWS = ["proponent", "adviser", "reviewer", "panel-chair", "staff", "chair"] as const;

export type RoleView = (typeof ROLE_VIEWS)[number];

export function knownRoleView(value: string | null | undefined): RoleView | null {
  if (!value) return null;
  return (ROLE_VIEWS as readonly string[]).includes(value) ? (value as RoleView) : null;
}
