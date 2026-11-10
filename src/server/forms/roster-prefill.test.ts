import { describe, expect, it } from "vitest";
import { validateSchema } from "@/lib/forms/schema";
import { prisma } from "@/server/db";
import { toJson } from "@/server/forms/json";
import { createProtocolForUser } from "@/server/protocols/affiliation";
import { prefillResearcherTable } from "@/server/forms/roster-prefill";
import { makeUser } from "@/server/test/users";

const schema = validateSchema({
  sections: [
    {
      id: "researchers",
      title: "Researchers",
      fields: [
        {
          id: "researcher_table",
          label: "Researcher(s)/Proponent(s)",
          type: "repeatingTable",
          fillers: ["PROPONENT"],
          validation: { required: true },
          columns: [
            { id: "name", label: "Name", type: "text", required: true, fillers: ["PROPONENT"] },
            { id: "designation", label: "Designation", type: "text", fillers: ["PROPONENT"] },
            { id: "email", label: "Email", type: "text", required: true, fillers: ["PROPONENT"] },
            { id: "cv", label: "CV appendix no.", type: "text", fillers: ["PROPONENT"] },
          ],
        },
      ],
    },
  ],
});

if (!schema.ok) throw new Error("fixture schema");

describe("researcher table prefill", () => {
  it("creates rows from each proponent’s contact email", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const leader = await makeUser({ email: `prefill.${suffix}@usc.edu.ph`, firstName: "Juan", familyName: "Cruz" });
    const panel = await prisma.panel.create({ data: { code: `PF${suffix.slice(0, 4)}`, name: "Prefill panel" } });
    const discipline = await prisma.discipline.create({ data: { name: `Prefill ${suffix}`, panelId: panel.id } });
    const created = await createProtocolForUser(leader.id, {
      title: "Prefill capsule proposal",
      disciplineId: discipline.id,
      researchType: "Applied",
      affiliation: {
        kind: "STUDENT",
        course: "BS Biology",
        yearLabel: "3rd year",
        institution: "University of San Carlos",
        contactEmailId: leader.emails[0]!.id,
      },
    });
    const definition = await prisma.formDefinition.create({
      data: {
        code: `R${suffix.slice(0, 6)}`,
        title: "Roster prefill",
        version: "01-00",
        effectiveDate: new Date("2026-11-10T00:00:00.000Z"),
        schema: toJson(schema.schema),
        createdById: leader.id,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
    const instance = await prisma.formInstance.create({
      data: {
        formDefinitionId: definition.id,
        ownerType: "PROTOCOL_VERSION",
        ownerId: created.version.id,
        data: {},
        status: "DRAFT",
      },
    });

    const data = await prefillResearcherTable(prisma, {
      instanceId: instance.id,
      protocolId: created.protocol.id,
      schema: schema.schema,
      data: {},
    });
    const rows = data.researcher_table as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: expect.stringContaining("Cruz"),
      email: `prefill.${suffix}@usc.edu.ph`,
    });
  });
});
