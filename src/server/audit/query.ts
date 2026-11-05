import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { manilaDayEnd, manilaDayStart } from "@/lib/time";

const PAGE_SIZE = 25;
const EXPORT_LIMIT = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const actorInclude = {
  actor: { select: { displayName: true, email: true } },
} as const;

export type AuditFilters = {
  actor?: string;
  action?: string;
  entity?: string;
  protocol?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  order?: "asc" | "desc";
  simplified?: boolean;
};

function one(input: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const value = input[key];
  const text = (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  return text || undefined;
}

export function parseAuditFilters(input: Record<string, string | string[] | undefined>): AuditFilters {
  const pageRaw = Number(one(input, "page") ?? "1");
  const from = one(input, "from");
  const to = one(input, "to");
  return {
    actor: one(input, "actor"),
    action: one(input, "action"),
    entity: one(input, "entity"),
    protocol: one(input, "protocol"),
    from: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : undefined,
    to: to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : undefined,
    page: Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1,
    simplified: one(input, "simplified") === "1",
  };
}

async function whereFor(filters: AuditFilters): Promise<{
  where: Prisma.AuditEventWhereInput;
  protocolId: string | null;
}> {
  const where: Prisma.AuditEventWhereInput = {};
  if (filters.action) where.action = { contains: filters.action, mode: "insensitive" };
  if (filters.entity) where.entityType = { equals: filters.entity, mode: "insensitive" };
  if (filters.from || filters.to) {
    where.occurredAt = {
      ...(filters.from ? { gte: manilaDayStart(filters.from) } : {}),
      ...(filters.to ? { lte: manilaDayEnd(filters.to) } : {}),
    };
  }
  if (filters.actor) {
    if (UUID.test(filters.actor)) {
      where.actorUserId = filters.actor;
    } else {
      const users = await prisma.user.findMany({
        where: {
          OR: [
            { displayName: { contains: filters.actor, mode: "insensitive" } },
            { email: { contains: filters.actor, mode: "insensitive" } },
            { emails: { some: { email: { contains: filters.actor, mode: "insensitive" } } } },
          ],
        },
        select: { id: true },
        take: 100,
      });
      where.actorUserId = { in: users.map((user) => user.id) };
    }
  }

  let protocolId: string | null = null;
  if (filters.protocol) {
    if (UUID.test(filters.protocol)) {
      protocolId = filters.protocol;
      where.protocolId = filters.protocol;
    } else {
      const protocols = await prisma.protocol.findMany({
        where: { code: { equals: filters.protocol, mode: "insensitive" } },
        select: { id: true },
        take: 20,
      });
      protocolId = protocols.length === 1 ? protocols[0]!.id : null;
      where.protocolId = { in: protocols.map((protocol) => protocol.id) };
    }
  }

  if (filters.simplified) {
    where.NOT = [
      { action: { startsWith: "auth." } },
      { action: { startsWith: "user." } },
      { action: { startsWith: "role." } },
      { action: { startsWith: "setting." } },
    ];
  }

  return { where, protocolId };
}

export async function listAuditEvents(filters: AuditFilters) {
  const pageSize = filters.pageSize ?? PAGE_SIZE;
  const { where, protocolId } = await whereFor(filters);
  const total = await prisma.auditEvent.count({ where });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(filters.page ?? 1, 1), pages);
  const rows = await prisma.auditEvent.findMany({
    where,
    include: actorInclude,
    orderBy: { seq: filters.order ?? "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return { total, page, pageSize, rows, protocolId };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  if (/[",\n\r]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}

function metaText(meta: unknown, key: string): string {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return "";
  const value = (meta as Record<string, unknown>)[key];
  return value === null || value === undefined ? "" : String(value);
}

export async function auditEventsCsv(filters: AuditFilters): Promise<string> {
  const { where } = await whereFor({ ...filters, simplified: false });
  const rows = await prisma.auditEvent.findMany({
    where,
    include: actorInclude,
    orderBy: { seq: "asc" },
    take: EXPORT_LIMIT,
  });
  const header = [
    "seq",
    "occurred_at",
    "actor",
    "acting_role",
    "action",
    "entity_type",
    "entity_id",
    "protocol_id",
    "diff",
    "ip",
    "user_agent",
  ];
  const lines = rows.map((row) =>
    [
      row.seq.toString(),
      row.occurredAt.toISOString(),
      row.actor?.displayName ?? "",
      row.actingRole ?? "",
      row.action,
      row.entityType,
      row.entityId,
      row.protocolId ?? "",
      JSON.stringify(row.diff),
      metaText(row.meta, "ip"),
      metaText(row.meta, "userAgent"),
    ]
      .map(csvCell)
      .join(","),
  );
  return `\uFEFF${[header.join(","), ...lines].join("\r\n")}\r\n`;
}
