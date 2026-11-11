import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { createDefinition, publishDefinition } from "@/server/forms/definitions";
import { makeUser, STRONG_PASSWORD } from "@/server/test/users";
import { prefillForm } from "@/server/workflow/prefill";

const pointsSchema = {
  sections: [
    {
      id: "a",
      title: "A",
      fields: [
        {
          id: "points",
          label: "Points",
          type: "assessmentTable",
          fillers: ["PRIMARY_REVIEWER"],
          rows: [
            { id: "p101", code: "1.01", label: "Objectives" },
            { id: "p102", code: "1.02", label: "Methods" },
          ],
          columns: [
            { id: "comments", label: "Comments", type: "text", fillers: ["PRIMARY_REVIEWER"] },
            { id: "recommendations", label: "Recommendations", type: "text", fillers: ["PRIMARY_REVIEWER"] },
            { id: "needs_action", label: "Needs action", type: "checkbox", fillers: ["PRIMARY_REVIEWER"] },
          ],
        },
      ],
    },
  ],
};

const summarySchema = {
  sections: [
    {
      id: "a",
      title: "A",
      fields: [
        {
          id: "praf",
          label: "PRAF",
          type: "assessmentTable",
          fillers: ["REC_CHAIR"],
          showRowsWhenFilled: ["needs_action"],
          rows: [
            { id: "p101", code: "1.01", label: "Objectives" },
            { id: "p102", code: "1.02", label: "Methods" },
          ],
          columns: [
            { id: "comments", label: "Comments", type: "text", fillers: ["REC_CHAIR"] },
            { id: "recommendations", label: "Recommendations", type: "text", fillers: ["REC_CHAIR"] },
            { id: "needs_action", label: "Needs action", type: "checkbox", fillers: ["REC_CHAIR"] },
          ],
        },
      ],
    },
  ],
};

const actionsSchema = {
  sections: [
    {
      id: "a",
      title: "A",
      fields: [
        {
          id: "praf",
          label: "PRAF",
          type: "assessmentTable",
          fillers: ["PROPONENT", "PRIMARY_REVIEWER"],
          showRowsWhenFilled: ["needs_action"],
          rows: [
            { id: "p101", code: "1.01", label: "Objectives" },
            { id: "p102", code: "1.02", label: "Methods" },
          ],
          columns: [
            { id: "panel_comments", label: "Panel", type: "text", fillers: ["PROPONENT"] },
            { id: "panel_remarks", label: "Remarks", type: "text", fillers: ["PRIMARY_REVIEWER"] },
            { id: "needs_action", label: "Still needs action", type: "checkbox", fillers: ["PRIMARY_REVIEWER"] },
          ],
        },
      ],
    },
  ],
};

describe("needs action prefill", () => {
  it("copies only flagged rows into F-37, builds F-38 from them, blanks remarks, and carries still-flagged rows", async () => {
    const suffix = crypto.randomUUID().slice(0, 6);
    const user = await makeUser({
      email: `flag.${suffix}@usc.edu.ph`,
      familyName: "Flag",
      password: STRONG_PASSWORD,
    });
    const f35 = await createDefinition({
      code: `R${suffix}`,
      title: "Review",
      version: "10-01",
      effectiveDate: "2025-08-01",
      schema: pointsSchema,
      userId: user.id,
    });
    await publishDefinition(f35.id, user.id);
    const f37 = await createDefinition({
      code: `S${suffix}`,
      title: "Summary",
      version: "10-01",
      effectiveDate: "2025-08-01",
      schema: summarySchema,
      userId: user.id,
    });
    await publishDefinition(f37.id, user.id);
    const f38 = await createDefinition({
      code: `A${suffix}`,
      title: "Actions",
      version: "10-01",
      effectiveDate: "2025-08-01",
      schema: actionsSchema,
      userId: user.id,
    });
    await publishDefinition(f38.id, user.id);

    const protocol = await prisma.protocol.create({
      data: {
        title: `Flag ${suffix}`,
        leaderUserId: user.id,
        createdById: user.id,
        institution: "University of San Carlos",
        status: "Draft",
        members: { create: { userId: user.id, role: "PROPONENT", isLeader: true, status: "ACTIVE" } },
      },
    });
    const version = await prisma.protocolVersion.create({
      data: { protocolId: protocol.id, number: 1, label: "1", state: "WORKING" },
    });
    const member = await prisma.protocolMember.findFirstOrThrow({ where: { protocolId: protocol.id } });
    await prisma.formInstance.create({
      data: {
        formDefinitionId: f35.id,
        ownerType: "PROTOCOL_VERSION",
        ownerId: version.id,
        filledByMemberId: member.id,
        status: "DRAFT",
        data: {
          points: {
            p101: { comments: "Good", recommendations: "No recommendations", needs_action: false },
            p102: { comments: "Narrow the aim.", recommendations: "Rewrite objectives.", needs_action: true },
          },
        },
      },
    });
    const summary = await prisma.formInstance.create({
      data: {
        formDefinitionId: f37.id,
        ownerType: "PROTOCOL_VERSION",
        ownerId: version.id,
        status: "DRAFT",
        data: {},
      },
    });
    const actions = await prisma.formInstance.create({
      data: {
        formDefinitionId: f38.id,
        ownerType: "PROTOCOL_VERSION",
        ownerId: version.id,
        status: "DRAFT",
        data: {},
      },
    });
    const ctx = {
      protocolId: protocol.id,
      protocolVersionId: version.id,
      instanceId: crypto.randomUUID(),
      stepKey: "chair_decide",
    };

    await prisma.$transaction(async (tx) => {
      await prefillForm(
        tx,
        {
          strategy: "copyReviewerColumns",
          sourceForm: f35.code,
          sourceField: "points",
          targetForm: f37.code,
          targetField: "praf",
          flagColumn: "needs_action",
          onlyFlagged: true,
          columns: [
            { from: "comments", to: "comments" },
            { from: "recommendations", to: "recommendations" },
          ],
        },
        ctx,
      );
    });

    const afterSummary = await prisma.formInstance.findUniqueOrThrow({ where: { id: summary.id } });
    const summaryData = afterSummary.data as { praf?: Record<string, { needs_action?: boolean; comments?: string }> };
    expect(summaryData.praf?.p101).toBeUndefined();
    expect(summaryData.praf?.p102?.needs_action).toBe(true);
    expect(summaryData.praf?.p102?.comments).toContain("Narrow the aim.");

    await prisma.formInstance.update({
      where: { id: summary.id },
      data: {
        data: {
          praf: {
            p102: {
              comments: "Narrow the aim.",
              recommendations: "Rewrite objectives.",
              needs_action: true,
            },
          },
        } as Prisma.InputJsonValue,
      },
    });

    await prisma.$transaction(async (tx) => {
      await prefillForm(
        tx,
        {
          strategy: "prepareActionSummary",
          formCode: f38.code,
          fields: ["praf"],
          flagColumn: "needs_action",
          clearColumns: ["panel_remarks"],
          fallbackForm: f37.code,
        },
        { ...ctx, stepKey: "proponent_revise" },
      );
    });

    let afterActions = await prisma.formInstance.findUniqueOrThrow({ where: { id: actions.id } });
    let actionData = afterActions.data as {
      praf?: Record<string, { needs_action?: boolean; panel_comments?: string; panel_remarks?: string }>;
    };
    expect(Object.keys(actionData.praf ?? {})).toEqual(["p102"]);
    expect(actionData.praf?.p102?.panel_comments).toContain("Narrow the aim.");
    expect(actionData.praf?.p102?.panel_remarks ?? "").toBe("");

    await prisma.formInstance.update({
      where: { id: actions.id },
      data: {
        data: {
          praf: {
            p102: {
              panel_comments: "Narrow the aim.\n\nRewrite objectives.",
              panel_remarks: "Still incomplete.",
              needs_action: true,
            },
            p101: {
              panel_comments: "Closed.",
              panel_remarks: "Addressed.",
              needs_action: false,
            },
          },
        } as Prisma.InputJsonValue,
      },
    });

    await prisma.$transaction(async (tx) => {
      await prefillForm(
        tx,
        {
          strategy: "prepareActionSummary",
          formCode: f38.code,
          fields: ["praf"],
          flagColumn: "needs_action",
          clearColumns: ["panel_remarks"],
          fallbackForm: f37.code,
        },
        { ...ctx, stepKey: "proponent_revise" },
      );
    });

    afterActions = await prisma.formInstance.findUniqueOrThrow({ where: { id: actions.id } });
    actionData = afterActions.data as {
      praf?: Record<string, { needs_action?: boolean; panel_remarks?: string }>;
    };
    expect(Object.keys(actionData.praf ?? {})).toEqual(["p102"]);
    expect(actionData.praf?.p102?.panel_remarks).toBe("");
    expect(actionData.praf?.p102?.needs_action).toBe(true);
  }, 60_000);
});
