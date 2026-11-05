import { describe, expect, it } from "vitest";
import { sampleFormSchema } from "@/lib/forms/sample";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { createDefinition, publishDefinition, updateDefinition } from "@/server/forms/definitions";
import { saveField } from "@/server/forms/fill";
import { makeUser } from "@/server/test/users";

describe("form saves", () => {
  it("stores a field, reports a stale revision, recalculates the total, and locks a published definition", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const user = await makeUser({
      email: `forms.${suffix}@usc.edu.ph`,
      firstName: "Juan",
      familyName: "Cruz",
    });
    const definition = await createDefinition({
      code: `T${suffix}`,
      title: "Save test",
      version: "01-00",
      effectiveDate: "2026-11-05",
      schema: sampleFormSchema,
      userId: user.id,
    });
    const instance = await prisma.formInstance.create({
      data: {
        formDefinitionId: definition.id,
        ownerType: "SANDBOX",
        ownerId: user.id,
        data: {},
        previewRoles: ["PROPONENT"],
      },
    });

    const saved = await saveField({
      instanceId: instance.id,
      path: "study_title",
      value: "Habits",
      expectedRevision: 0,
      userId: user.id,
    });
    expect(saved.ok).toBe(true);

    const conflict = await saveField({
      instanceId: instance.id,
      path: "study_title",
      value: "Other title",
      expectedRevision: 0,
      userId: user.id,
    });
    expect(conflict).toMatchObject({
      ok: false,
      code: "CONFLICT",
      value: "Habits",
      changedBy: { id: user.id, name: "Juan D. Cruz" },
    });
    if (conflict.ok || conflict.code !== "CONFLICT") throw new Error("expected a conflict");

    await expect(
      saveField({
        instanceId: instance.id,
        path: "assessment.p101.reviewer",
        value: "Clear",
        expectedRevision: conflict.revision,
        userId: user.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await prisma.formInstance.update({
      where: { id: instance.id },
      data: { previewRoles: ["PRIMARY_REVIEWER"] },
    });
    const review = await saveField({
      instanceId: instance.id,
      path: "assessment.p101.reviewer",
      value: "Clear",
      expectedRevision: conflict.revision,
      userId: user.id,
    });
    expect(review.ok).toBe(true);
    if (!review.ok) return;

    await expect(
      saveField({
        instanceId: instance.id,
        path: "assessment.p101.proponent",
        value: "Page 2",
        expectedRevision: review.revision,
        userId: user.id,
      }),
    ).rejects.toBeInstanceOf(AppError);

    await prisma.formInstance.update({
      where: { id: instance.id },
      data: { previewRoles: ["PROPONENT"] },
    });
    const budget = await saveField({
      instanceId: instance.id,
      path: "budget",
      value: [{ _rowId: "r1", item: "Printing", total: 15000 }],
      expectedRevision: review.revision,
      userId: user.id,
    });
    expect(budget.ok).toBe(true);
    if (budget.ok) expect(budget.data.budget_total).toBe(15000);

    const audited = await prisma.auditEvent.findFirst({
      where: { entityId: instance.id, action: "form.field_saved" },
    });
    expect(audited).toBeTruthy();

    await publishDefinition(definition.id, user.id);
    await expect(
      updateDefinition({
        id: definition.id,
        code: `T${suffix}`,
        title: "Changed",
        version: "01-00",
        effectiveDate: "2026-11-05",
        schema: sampleFormSchema,
        userId: user.id,
      }),
    ).rejects.toMatchObject({ code: "LOCKED" });
  });
});
