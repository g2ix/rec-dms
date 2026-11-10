import { describe, expect, it } from "vitest";
import { sampleFormSchema } from "@/lib/forms/sample";
import { prisma } from "@/server/db";
import { createDefinition, createVersion, publishDefinition } from "@/server/forms/definitions";
import { makeUser } from "@/server/test/users";

describe("form definition versions", () => {
  it("keeps existing instances on the old definition after a newer version is published", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const user = await makeUser({
      email: `version.${suffix}@usc.edu.ph`,
      firstName: "Juan",
      familyName: "Cruz",
    });
    const first = await createDefinition({
      code: `V${suffix.slice(0, 6)}`,
      title: "Version keep",
      version: "09-00",
      effectiveDate: "2025-08-01",
      schema: sampleFormSchema,
      userId: user.id,
    });
    await publishDefinition(first.id, user.id);
    const instance = await prisma.formInstance.create({
      data: {
        formDefinitionId: first.id,
        ownerType: "SANDBOX",
        ownerId: user.id,
        data: { study_title: "Kept on 09-00" },
        status: "DRAFT",
      },
    });

    const draft = await createVersion(first.id, "09-01", user.id);
    await publishDefinition(draft.id, user.id);

    const kept = await prisma.formInstance.findUnique({ where: { id: instance.id } });
    expect(kept?.formDefinitionId).toBe(first.id);
    const old = await prisma.formDefinition.findUnique({ where: { id: first.id } });
    const next = await prisma.formDefinition.findUnique({ where: { id: draft.id } });
    expect(old?.status).toBe("PUBLISHED");
    expect(next?.status).toBe("PUBLISHED");
    expect(next?.version).toBe("09-01");
  });
});
