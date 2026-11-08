import type { PersonProfileView } from "@/lib/profile";
import { calendarDaysBetween } from "@/lib/reports/days";
import type { QueueRow } from "@/server/reports/rows";

export type StatusCount = { status: string; count: number };

export type ProfileGap = { label: string; why: string };

export type ProfileProgress = {
  done: number;
  total: number;
  missing: ProfileGap | null;
};

export type DeadlineTone = "warning" | "danger" | null;

export type AttentionKind = "revision" | "signature";

export type AttentionItem = {
  id: string;
  href: string;
  code: string | null;
  status: string;
  title: string;
  dueAt: Date | null;
  openedAt: Date | null;
  askedBy: string | null;
  kind: AttentionKind;
  action: string;
  workingDays: number | null;
};

export type ActivityTone = "warning" | "primary" | "neutral";

export type ActivityPart = { kind: "text"; text: string } | { kind: "code"; text: string };

export type ActivitySentence = { tone: ActivityTone; parts: ActivityPart[] };

const STATUS_RANK = [
  "draft",
  "submitted",
  "screening",
  "review",
  "returned",
  "awaiting",
  "revision",
  "approved",
  "exempted",
  "resubmitted",
  "disapproved",
  "lapsed",
  "withdrawn",
];

function filled(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function gap(label: string, why: string, ok: boolean): { label: string; why: string; ok: boolean } {
  return { label, why, ok };
}

export function profileProgress(profile: PersonProfileView | null): ProfileProgress {
  if (!profile) {
    return {
      done: 0,
      total: 1,
      missing: {
        label: "Your affiliation",
        why: "It prints under your name on REC forms.",
      },
    };
  }

  const student = profile.kind === "USC_STUDENT" || profile.kind === "EXTERNAL_STUDENT";
  const checks = [
    student
      ? gap(
          "Academic level",
          "Undergraduate or graduate prints on your roster line.",
          profile.academicLevel === "UNDERGRADUATE" || profile.academicLevel === "GRADUATE",
        )
      : null,
    student ? gap("Year", "Your year prints beside your program.", filled(profile.yearLabel)) : null,
    student
      ? gap("Program", "Your program prints under your name.", filled(profile.programText) || filled(profile.programId))
      : null,
    profile.kind === "USC_STUDENT"
      ? gap("School", "Your school prints on the protocol roster.", filled(profile.schoolId))
      : null,
    profile.kind === "USC_STUDENT"
      ? gap(
          "Department",
          "Your department prints on the protocol roster.",
          filled(profile.departmentId) || filled(profile.unitText),
        )
      : null,
    profile.kind === "EXTERNAL_STUDENT"
      ? gap(
          "Institution",
          "Your institution prints under your name on REC forms.",
          filled(profile.institutionText) || filled(profile.institutionId),
        )
      : null,
    profile.kind === "USC_ACADEMIC"
      ? gap("Rank or position", "It prints under your name on REC forms.", filled(profile.position))
      : null,
    profile.kind === "USC_STAFF" || profile.kind === "EXTERNAL_ADVISER"
      ? gap("Position", "It prints under your name on REC forms.", filled(profile.position))
      : null,
    profile.kind === "INDUSTRY_PARTNER"
      ? gap("Role", "It prints under your name on REC forms.", filled(profile.position))
      : null,
    profile.kind === "USC_ACADEMIC"
      ? gap("School", "Your school prints on the protocol roster.", filled(profile.schoolId))
      : null,
    profile.kind === "USC_ACADEMIC" || profile.kind === "USC_STAFF"
      ? gap(
          "Department or office",
          "It prints on the protocol roster.",
          filled(profile.departmentId) || filled(profile.officeId) || filled(profile.unitText),
        )
      : null,
    profile.kind === "EXTERNAL_ADVISER"
      ? gap(
          "Institution",
          "Your institution prints under your name on REC forms.",
          filled(profile.institutionText) || filled(profile.institutionId),
        )
      : null,
    profile.kind === "EXTERNAL_ADVISER"
      ? gap("Unit", "Your unit prints on the protocol roster.", filled(profile.unitText))
      : null,
    profile.kind === "INDUSTRY_PARTNER"
      ? gap(
          "Organization",
          "Your organization prints under your name on REC forms.",
          filled(profile.institutionText) || filled(profile.institutionId),
        )
      : null,
  ].filter((item): item is { label: string; why: string; ok: boolean } => Boolean(item));

  const missing = checks.find((item) => !item.ok) ?? null;
  return {
    done: checks.filter((item) => item.ok).length,
    total: checks.length,
    missing: missing ? { label: missing.label, why: missing.why } : null,
  };
}

export function revisionLabel(count: number): string {
  return count === 1 ? "Revision deadline" : "Revision deadlines";
}

export function isReturnedStatus(status: string): boolean {
  const key = status.toLowerCase();
  return key.includes("return") || key.includes("revision") || key.includes("await");
}

function statusRank(status: string): number {
  const key = status.toLowerCase();
  const index = STATUS_RANK.findIndex((item) => key.includes(item));
  return index === -1 ? STATUS_RANK.length : index;
}

export function statusDetail(statuses: StatusCount[]): string {
  return statuses
    .filter((row) => row.count > 0)
    .sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.status.localeCompare(b.status))
    .map((row) => `${row.count} ${row.status.toLowerCase()}`)
    .join(", ");
}

export function workingDaysFromNote(note: string | null): number | null {
  if (!note) return null;
  if (note === "Due today") return 0;
  const left = /^(\d+) working days? left$/.exec(note);
  if (left?.[1]) return Number(left[1]);
  const over = /^(\d+) working days overdue$/.exec(note);
  if (over?.[1]) return -Number(over[1]);
  return null;
}

export function deadlineTone(workingDays: number | null): DeadlineTone {
  if (workingDays === null) return null;
  if (workingDays < 0) return "danger";
  if (workingDays <= 5) return "warning";
  return null;
}

export function daysLeftPhrase(due: Date, now: Date): string {
  const days = calendarDaysBetween(now, due);
  if (days === 0) return "Due today";
  if (days === 1) return "1 day left";
  if (days === -1) return "1 day overdue";
  if (days > 1) return `${days} days left`;
  return `${Math.abs(days)} days overdue`;
}

export function isSignatureStep(step: string): boolean {
  return /sign|signature|\bF-\d+\b/i.test(step);
}

export function signAction(step: string): string {
  const code = step.match(/\bF-\d+\b/i)?.[0]?.toUpperCase();
  return code ? `Sign ${code}` : "Sign";
}

export function attentionItems(waiting: QueueRow[], revisions: QueueRow[]): AttentionItem[] {
  const revisionIds = new Set(revisions.map((row) => row.id));
  const items: AttentionItem[] = [
    ...revisions.map((row) => toAttention(row, "revision")),
    ...waiting
      .filter((row) => !revisionIds.has(row.id) && isSignatureStep(row.step))
      .map((row) => toAttention(row, "signature")),
  ];
  return items.sort((a, b) => {
    if (a.dueAt && b.dueAt) return a.dueAt.getTime() - b.dueAt.getTime() || a.title.localeCompare(b.title);
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return a.title.localeCompare(b.title);
  });
}

function toAttention(row: QueueRow, kind: AttentionKind): AttentionItem {
  const protocolHref = row.href;
  return {
    id: row.id,
    href: kind === "signature" ? `${protocolHref}/forms` : protocolHref,
    code: row.code,
    status: row.status,
    title: kind === "signature" ? row.step : row.title,
    dueAt: row.dueAt,
    openedAt: row.openedAt ?? null,
    askedBy: row.askedBy ?? null,
    kind,
    action: kind === "revision" ? "Open revision" : signAction(row.step),
    workingDays: workingDaysFromNote(row.note),
  };
}

function field(diff: unknown, key: string): string {
  if (!diff || typeof diff !== "object" || Array.isArray(diff)) return "";
  const value = (diff as Record<string, unknown>)[key];
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "after" in value) {
    const after = (value as { after: unknown }).after;
    return typeof after === "string" ? after : "";
  }
  return "";
}

export function shortProtocolCode(code: string | null): string | null {
  if (!code) return null;
  const tail = code.match(/(\d{3,})$/);
  return tail?.[1] ?? code;
}

function codePart(code: string | null): ActivityPart[] {
  const short = shortProtocolCode(code);
  if (!short) return [{ kind: "text", text: "your protocol" }];
  return [{ kind: "code", text: short }];
}

function sentence(tone: ActivityTone, parts: ActivityPart[]): ActivitySentence {
  return { tone, parts };
}

export function describeActivity(input: {
  action: string;
  actingRole: string | null;
  actorUserId: string | null;
  viewerId: string;
  code: string | null;
  diff: unknown;
}): ActivitySentence | null {
  const outcome = field(input.diff, "outcome");
  const stepKey = field(input.diff, "stepKey");
  const stepName = field(input.diff, "stepName");
  const role = field(input.diff, "role");
  const invitee = field(input.diff, "userId");
  const stepText = `${stepKey} ${stepName}`;
  const code = codePart(input.code);

  if (input.action === "task.completed" && (outcome === "RETURN_INCOMPLETE" || /return incomplete/i.test(stepText))) {
    return sentence("warning", [{ kind: "text", text: "REC Staff returned " }, ...code, { kind: "text", text: " as incomplete" }]);
  }
  if (input.action === "task.completed" && outcome === "APPROVED") {
    return sentence("primary", [{ kind: "text", text: "The Chair approved " }, ...code]);
  }
  if (input.action === "task.completed" && outcome === "EXEMPT") {
    return sentence("primary", [{ kind: "text", text: "The Chair exempted " }, ...code]);
  }
  if (input.action === "workflow.instance_completed" && /approv/i.test(stepText)) {
    return sentence("primary", [{ kind: "text", text: "The Chair approved " }, ...code]);
  }
  if (input.action === "workflow.instance_completed" && /exempt/i.test(stepText)) {
    return sentence("primary", [{ kind: "text", text: "The Chair exempted " }, ...code]);
  }
  if (
    input.action === "protocol.member_invited" &&
    role === "PROPONENT" &&
    invitee === input.viewerId
  ) {
    return sentence("neutral", [{ kind: "text", text: "You were added as co-proponent on " }, ...code]);
  }
  if (
    input.action === "protocol.member_accepted" &&
    input.actingRole === "PROPONENT" &&
    input.actorUserId === input.viewerId
  ) {
    return sentence("neutral", [{ kind: "text", text: "You were added as co-proponent on " }, ...code]);
  }
  if (input.action === "workflow.step_entered" && /reviewer/i.test(stepText) && /ack|assign/i.test(stepText)) {
    return sentence("neutral", [...code, { kind: "text", text: " was assigned to reviewers" }]);
  }
  if (input.action === "protocol.version_submitted") {
    const who = input.actorUserId === input.viewerId ? "You submitted " : "A version was submitted for ";
    return sentence("neutral", [{ kind: "text", text: who }, ...code]);
  }
  if (input.action === "protocol.revision_started") {
    return sentence("neutral", [{ kind: "text", text: "A revision started on " }, ...code]);
  }
  return null;
}
