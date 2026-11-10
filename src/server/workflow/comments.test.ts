import { describe, expect, it } from "vitest";
import type { WorkflowGraph } from "@/lib/workflow/graph";
import { listAuditEvents } from "@/server/audit/query";
import { prisma } from "@/server/db";
import { toJson } from "@/server/forms/json";
import { createProtocolForUser } from "@/server/protocols/affiliation";
import { roster } from "@/server/protocols/read";
import { makeUser } from "@/server/test/users";
import { protocolTaskComments } from "@/server/workflow/comments";
import { publishWorkflow } from "@/server/workflow/definitions";
import { completeTask, startInstance } from "@/server/workflow/engine";
import { protocolFlow, reviewerNameMask } from "@/server/workflow/read";

const outcome = (key: string) => ({ "==": [{ var: "outcome" }, key] });

const graph: WorkflowGraph = {
  startStep: "submit",
  steps: [
    { key: "submit", name: "Submit", type: "TASK", assignee: { kind: "PROTOCOL_LEADER" }, statusLabel: "Draft" },
    {
      key: "screen",
      name: "Screen",
      type: "DECISION",
      assignee: { kind: "ROLE", role: "REC_STAFF" },
      statusLabel: "Under Screening",
      outcomes: [
        { key: "ACCEPT", label: "Accept" },
        { key: "RETURN_INCOMPLETE", label: "Return incomplete" },
      ],
      assignReviewers: { roles: ["PRIMARY_REVIEWER"], min: 1 },
    },
    { key: "freeze", name: "Freeze", type: "AUTO", statusLabel: "Under Review", actions: [{ kind: "SNAPSHOT_VERSION", hook: "onEnter" }] },
    { key: "assess", name: "Assess", type: "TASK", assignee: { kind: "ASSIGNED_IN_STEP", stepKey: "screen" }, statusLabel: "Under Review" },
    { key: "decide", name: "Decide", type: "TASK", assignee: { kind: "ROLE", role: "REC_CHAIR" }, statusLabel: "Under Review" },
    {
      key: "release",
      name: "Release",
      type: "TASK",
      assignee: { kind: "ROLE", role: "REC_STAFF" },
      statusLabel: "Decision Released",
      actions: [{ kind: "GENERATE_DOCUMENTS", hook: "onExit", params: { template: "letter" } }],
    },
    { key: "end", name: "End", type: "END", statusLabel: "Approved" },
  ],
  transitions: [
    { from: "submit", to: "screen" },
    { from: "screen", to: "submit", when: outcome("RETURN_INCOMPLETE"), statusLabel: "Returned" },
    { from: "screen", to: "freeze", when: outcome("ACCEPT") },
    { from: "freeze", to: "assess" },
    { from: "assess", to: "decide" },
    { from: "decide", to: "release" },
    { from: "release", to: "end" },
  ],
};

async function grant(userId: string, key: string) {
  const role = await prisma.role.upsert({ where: { key }, update: {}, create: { key, name: key, scope: "GLOBAL" } });
  await prisma.userRole.create({ data: { userId, roleId: role.id } });
}

async function publish(userId: string, key: string) {
  const definition = await prisma.workflowDefinition.create({ data: { key, name: key, submissionType: "INITIAL" } });
  const version = await prisma.workflowVersion.create({
    data: { definitionId: definition.id, number: 1, status: "DRAFT", graph: toJson(graph) },
  });
  await publishWorkflow(version.id, userId);
}

describe("protocol task comments", () => {
  it("shows return reasons at once, holds review comments until release, and hides reviewer names", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const person = (name: string) => makeUser({ email: `${name}.${suffix}@usc.edu.ph`, familyName: `${name}${suffix}` });
    const leader = await person("leader");
    const adviser = await person("adviser");
    const staff = await person("staff");
    const chair = await person("chair");
    const reviewer = await person("reviewer");
    const outsider = await person("outsider");
    await grant(staff.id, "REC_STAFF");
    await grant(chair.id, "REC_CHAIR");
    await grant(reviewer.id, "PRIMARY_REVIEWER");

    const email = await prisma.userEmail.findFirstOrThrow({ where: { userId: leader.id } });
    const created = await createProtocolForUser(leader.id, {
      title: `Comments ${suffix}`,
      researchType: "Basic",
      affiliation: { kind: "STUDENT", course: "BS Biology", yearLabel: "1st year", institution: "University of San Carlos", contactEmailId: email.id },
    });
    const protocolId = created.protocol.id;
    await prisma.protocolMember.create({ data: { protocolId, userId: adviser.id, role: "ADVISER", status: "ACTIVE", rosterOrder: 2 } });

    await publish(leader.id, `COMMENTS_${suffix}`);
    const instance = await startInstance(`COMMENTS_${suffix}`, protocolId, created.version.id, leader.id);
    const open = (stepKey: string) =>
      prisma.task.findFirstOrThrow({ where: { instanceId: instance.id, stepKey, status: { in: ["OPEN", "CLAIMED"] } } });
    const texts = async (userId: string) => (await protocolTaskComments(userId, protocolId)).comments.map((item) => item.comment);

    await completeTask((await open("submit")).id, leader.id);
    await completeTask((await open("screen")).id, staff.id, { outcome: "RETURN_INCOMPLETE", comment: "The budget page is missing." });

    const returned = await protocolTaskComments(adviser.id, protocolId);
    expect(returned.returnReason).toMatchObject({
      comment: "The budget page is missing.",
      stepName: "Screen",
      outcomeLabel: "Return incomplete",
      author: staff.displayName,
      role: "REC Staff",
    });
    expect(returned.returnReason?.at).toBeInstanceOf(Date);

    await completeTask((await open("submit")).id, leader.id, { comment: "Added the budget page." });
    const resubmitted = await protocolTaskComments(leader.id, protocolId);
    expect(resubmitted.returnReason).toBeNull();
    expect(resubmitted.comments[0]).toMatchObject({ author: leader.displayName, role: "Project leader" });

    await completeTask((await open("screen")).id, staff.id, { outcome: "ACCEPT", comment: "Complete.", reviewerUserIds: [reviewer.id] });
    const rosterSeenBy = async (viewerId: string) => (await roster(viewerId, protocolId)).members.map((member) => member.userId);
    expect(await rosterSeenBy(leader.id)).not.toContain(reviewer.id);
    expect(await rosterSeenBy(leader.id)).toEqual(expect.arrayContaining([leader.id, adviser.id]));
    expect(await rosterSeenBy(adviser.id)).not.toContain(reviewer.id);
    expect(await rosterSeenBy(reviewer.id)).toContain(reviewer.id);
    expect(await rosterSeenBy(staff.id)).toContain(reviewer.id);

    const assigneeSeenBy = async (viewerId: string) => (await protocolFlow(protocolId, viewerId))?.open[0]?.assigneeName;
    expect(await assigneeSeenBy(leader.id)).toBe("Reviewer");
    expect(await assigneeSeenBy(adviser.id)).toBe("Reviewer");
    expect(await assigneeSeenBy(staff.id)).toBe(reviewer.displayName);

    await completeTask((await open("assess")).id, reviewer.id, { comment: "Narrow the question." });
    const actorsSeenBy = async (viewerId: string) => (await protocolFlow(protocolId, viewerId))?.history.map((event) => event.actorName);
    expect(await actorsSeenBy(leader.id)).toContain("Reviewer");
    expect(await actorsSeenBy(leader.id)).not.toContain(reviewer.displayName);
    expect(await actorsSeenBy(leader.id)).toContain(staff.displayName);
    expect(await actorsSeenBy(staff.id)).toContain(reviewer.displayName);

    const { rows } = await listAuditEvents({ protocol: protocolId, simplified: true, pageSize: 100 });
    const activitySeenBy = async (viewerId: string) => {
      const nameFor = await reviewerNameMask(protocolId, viewerId);
      return rows.map((row) => nameFor(row.actorUserId, row.actor?.displayName));
    };
    expect(rows.map((row) => row.actor?.displayName)).toContain(reviewer.displayName);
    expect(await activitySeenBy(leader.id)).not.toContain(reviewer.displayName);
    expect(await activitySeenBy(leader.id)).toContain("Reviewer");
    expect(await activitySeenBy(leader.id)).toContain(staff.displayName);
    expect(await activitySeenBy(staff.id)).toContain(reviewer.displayName);

    await completeTask((await open("decide")).id, chair.id, { comment: "Minor changes needed." });

    const beforeRelease = ["Complete.", "Added the budget page.", "The budget page is missing."];
    expect(await texts(leader.id)).toEqual(beforeRelease);
    expect(await texts(adviser.id)).toEqual(beforeRelease);
    expect(await texts(reviewer.id)).toEqual(["Minor changes needed.", "Narrow the question.", ...beforeRelease]);

    const ofStaff = await protocolTaskComments(staff.id, protocolId);
    expect(ofStaff.comments.find((item) => item.comment === "Narrow the question.")).toMatchObject({
      author: reviewer.displayName,
      role: "Primary reviewer",
    });
    const ofReviewer = await protocolTaskComments(reviewer.id, protocolId);
    expect(ofReviewer.comments.find((item) => item.comment === "Narrow the question.")).toMatchObject({ author: "Reviewer", role: null });

    await completeTask((await open("release")).id, staff.id, { comment: "Released." });
    const released = await protocolTaskComments(leader.id, protocolId);
    expect(released.comments.find((item) => item.comment === "Narrow the question.")).toMatchObject({ author: "Reviewer", role: null });
    expect(released.comments.find((item) => item.comment === "Minor changes needed.")).toMatchObject({
      author: chair.displayName,
      role: "REC Chair",
    });
    expect(JSON.stringify(released)).not.toContain(reviewer.displayName);

    await expect(protocolTaskComments(outsider.id, protocolId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  }, 240_000);
});
