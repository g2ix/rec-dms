export const ROLE_KEYS = [
  "PROPONENT",
  "PROJECT_LEADER",
  "ADVISER",
  "REVIEWER",
  "PRIMARY_REVIEWER",
  "INDEPENDENT_CONSULTANT",
  "REC_STAFF",
  "REC_CHAIR",
  "PANEL_CHAIR",
  "PANEL_VICE_CHAIR",
  "PANEL_SECRETARY",
  "PANEL_MEMBER",
  "REC_MEMBER",
  "MEMBER_SECRETARY",
  "SYSTEM_ADMIN",
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_KEY_LABEL: Record<RoleKey, string> = {
  PROPONENT: "Proponent",
  PROJECT_LEADER: "Project leader",
  ADVISER: "Adviser",
  REVIEWER: "Reviewer",
  PRIMARY_REVIEWER: "Primary reviewer",
  INDEPENDENT_CONSULTANT: "Independent consultant",
  REC_STAFF: "REC Staff",
  REC_CHAIR: "REC Chair",
  PANEL_CHAIR: "Panel Chair",
  PANEL_VICE_CHAIR: "Panel Vice-Chair",
  PANEL_SECRETARY: "Panel Secretary",
  PANEL_MEMBER: "Panel member",
  REC_MEMBER: "REC member",
  MEMBER_SECRETARY: "Member Secretary",
  SYSTEM_ADMIN: "System admin",
};

export function isRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}
