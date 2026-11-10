import "server-only";
import type { Prisma } from "@prisma/client";
import { formatFormalName } from "@/lib/display-name";
import { findField, validateSchema } from "@/lib/forms/schema";
import { prisma } from "@/server/db";

type Tx = Prisma.TransactionClient | typeof prisma;

type MemberRow = {
  designation: string;
  rosterOrder: number;
  user: {
    displayName: string;
    title?: string | null;
    firstName?: string;
    middleName?: string | null;
    middleInitial?: string | null;
    familyName?: string;
    suffix?: string | null;
    credentials?: string[] | null;
  } | null;
  contactEmail: { email: string } | null;
};

function researcherName(user: MemberRow["user"]): string {
  if (!user) return "";
  if (!user.firstName || !user.familyName) return user.displayName;
  return formatFormalName({
    title: user.title,
    firstName: user.firstName,
    middleName: user.middleName,
    middleInitial: user.middleInitial,
    familyName: user.familyName,
    suffix: user.suffix,
    credentials: user.credentials,
  });
}

function empty(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row));
}

/** Fills F-29 researcher_table name/email from active proponents when those cells are still blank. */
export async function prefillResearcherTable(
  tx: Tx,
  input: { instanceId: string; protocolId: string; schema: unknown; data: unknown },
): Promise<Record<string, unknown>> {
  const checked = validateSchema(input.schema);
  if (!checked.ok) return asRecord(input.data);
  const field = findField(checked.schema, "researcher_table");
  if (!field || field.type !== "repeatingTable") return asRecord(input.data);

  const members = await tx.protocolMember.findMany({
    where: { protocolId: input.protocolId, role: "PROPONENT", status: "ACTIVE" },
    include: { user: true, contactEmail: true },
    orderBy: [{ rosterOrder: "asc" }, { createdAt: "asc" }],
  });
  const roster = members
    .filter((member) => member.user)
    .map((member) => ({
      name: researcherName(member.user),
      designation: member.designation || "",
      email: member.contactEmail?.email ?? "",
    }))
    .filter((row) => row.name || row.email);
  if (roster.length === 0) return asRecord(input.data);

  const data = asRecord(input.data);
  const existing = asRows(data.researcher_table);
  let next: Record<string, unknown>[];
  if (existing.length === 0) {
    next = roster.map((row) => ({
      _rowId: crypto.randomUUID(),
      name: row.name || null,
      designation: row.designation || null,
      email: row.email || null,
      cv: null,
    }));
  } else {
    next = existing.map((row, index) => {
      const match = roster[index];
      if (!match) return row;
      const patched = { ...row };
      if (empty(patched.name) && match.name) patched.name = match.name;
      if (empty(patched.designation) && match.designation) patched.designation = match.designation;
      if (empty(patched.email) && match.email) patched.email = match.email;
      return patched;
    });
  }

  if (JSON.stringify(existing) === JSON.stringify(next)) return data;
  data.researcher_table = next;
  await tx.formInstance.update({
    where: { id: input.instanceId },
    data: { data: data as Prisma.InputJsonValue },
  });
  return data;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}
