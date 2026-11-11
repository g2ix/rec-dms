import "server-only";
import { assignMeeting, describeRule, parseMeetingSchedule, ruleFor } from "@/lib/reports/meetings";
import { settingValue } from "@/server/effective";
import { manilaDay } from "@/lib/workflow/calendar";
import { readTransaction, useAppSchema } from "@/server/db";
import { constrainPanel, reportScope } from "@/server/reports/access";
import { stepFacts } from "@/server/reports/steps";

export type MeetingRow = {
  protocolId: string;
  code: string | null;
  title: string;
  reviewType: string;
  completeDay: string | null;
  missedCutoff: boolean;
  cutoffDays: number | null;
};

export type MeetingGroup = {
  /** yyyy-MM-dd, or null when the setting names no meeting day for the panel. */
  meeting: string | null;
  panelCode: string | null;
  panelName: string | null;
  rule: string | null;
  rows: MeetingRow[];
};

export async function meetingGroups(userId: string, now = new Date()): Promise<MeetingGroup[]> {
  return readTransaction(async (tx) => {
    await useAppSchema(tx);
    const scope = await reportScope(tx, userId);
    const panelId = constrainPanel(scope, undefined);
    const facts = await stepFacts(tx);
    if (facts.meetingKeys.length === 0) return [];
    const tasks = await tx.task.findMany({
      where: {
        status: { in: ["OPEN", "CLAIMED"] },
        stepKey: { in: facts.meetingKeys },
        instance: { status: "RUNNING", ...(panelId ? { protocol: { panelId } } : {}) },
      },
      select: {
        instance: {
          select: {
            protocol: { select: { id: true, code: true, title: true, reviewType: true, panel: { select: { code: true, name: true } } } },
          },
        },
      },
    });
    const protocols = new Map<
      string,
      { code: string | null; title: string; reviewType: string | null; panel: { code: string; name: string } | null }
    >();
    for (const task of tasks) {
      const protocol = task.instance?.protocol;
      if (protocol) protocols.set(protocol.id, protocol);
    }
    const ids = [...protocols.keys()];
    const completed = ids.length === 0 || facts.screeningKeys.length === 0
      ? []
      : await tx.task.findMany({
          where: {
            status: "COMPLETED",
            stepKey: { in: facts.screeningKeys },
            completedAt: { not: null },
            ...(facts.acceptOutcomes.length > 0 ? { outcome: { in: facts.acceptOutcomes } } : {}),
            instance: { protocolId: { in: ids } },
          },
          select: { completedAt: true, instance: { select: { protocolId: true } } },
          orderBy: { completedAt: "desc" },
        });
    const completeOf = new Map<string, Date>();
    for (const task of completed) {
      const protocolId = task.instance?.protocolId;
      if (protocolId && task.completedAt && !completeOf.has(protocolId)) completeOf.set(protocolId, task.completedAt);
    }
    const today = manilaDay(now);
    const schedule = parseMeetingSchedule(await settingValue(tx, "meetings.schedule", now));
    const groups = new Map<string, MeetingGroup>();
    for (const [protocolId, protocol] of protocols) {
      const completedAt = completeOf.get(protocolId) ?? null;
      const rule = ruleFor(schedule, protocol.panel?.code);
      const assigned = assignMeeting({
        completeDay: completedAt ? manilaDay(completedAt) : null,
        today,
        fullReview: protocol.reviewType === "FULL",
        rule,
      });
      const row: MeetingRow = {
        protocolId,
        code: protocol.code,
        title: protocol.title,
        reviewType: protocol.reviewType ?? "",
        completeDay: completedAt ? manilaDay(completedAt) : null,
        missedCutoff: assigned.missedCutoff,
        cutoffDays: rule?.cutoffDays ?? null,
      };
      const key = `${assigned.meeting ?? "~"}|${protocol.panel?.code ?? ""}`;
      const group = groups.get(key) ?? {
        meeting: assigned.meeting,
        panelCode: protocol.panel?.code ?? null,
        panelName: protocol.panel?.name ?? null,
        rule: rule ? describeRule(rule) : null,
        rows: [],
      };
      group.rows.push(row);
      groups.set(key, group);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, group]) => ({ ...group, rows: group.rows.sort((a, b) => (a.code ?? "").localeCompare(b.code ?? "")) }));
  });
}
