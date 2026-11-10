import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const password = "Usc-ethics-review-2026-protocol";
const formEmail = "e2e.autosave.form@usc.edu.ph";
const staffEmail = "e2e.autosave.staff@usc.edu.ph";
const WORKFLOW_KEY = "E2E_AUTOSAVE_FLUSH";

const graph = {
  startStep: "submit",
  steps: [
    { key: "submit", name: "Submit the test protocol", type: "TASK", assignee: { kind: "PROTOCOL_LEADER" } },
    {
      key: "screen",
      name: "Screen the test submission",
      type: "TASK",
      assignee: { kind: "ROLE", role: "REC_STAFF" },
      outcomes: [
        { key: "ACCEPT", label: "Accept" },
        { key: "RETURN", label: "Return" },
      ],
      statusLabel: "Under Screening",
    },
    { key: "end", name: "Done", type: "END" },
  ],
  transitions: [
    { from: "submit", to: "screen" },
    { from: "screen", to: "end", when: { "==": [{ var: "outcome" }, "ACCEPT"] } },
    { from: "screen", to: "submit", when: { "==": [{ var: "outcome" }, "RETURN"] }, statusLabel: "Returned" },
  ],
};

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.locator("#sign-in-email").fill(email);
  await page.locator("#sign-in-password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 20_000 });
}

async function ensureUser(prisma: PrismaClient, email: string, firstName: string, familyName: string): Promise<string> {
  const existing = await prisma.userEmail.findUnique({ where: { email } });
  if (existing) return existing.userId;
  const verifiedAt = new Date();
  const user = await prisma.user.create({
    data: {
      firstName,
      familyName,
      displayName: `${firstName} ${familyName}`,
      name: `${firstName} ${familyName}`,
      email,
      emailVerified: verifiedAt,
      status: "ACTIVE",
      approvedAt: verifiedAt,
      passwordHash: await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
      emails: { create: { email, verifiedAt, isContact: true, isPrimary: true } },
    },
    include: { emails: true },
  });
  await prisma.user.update({ where: { id: user.id }, data: { primaryEmailId: user.emails[0]?.id } });
  return user.id;
}

async function ensureStaffRole(prisma: PrismaClient, userId: string) {
  const role =
    (await prisma.role.findUnique({ where: { key: "REC_STAFF" } })) ??
    (await prisma.role.create({ data: { key: "REC_STAFF", name: "REC Staff", scope: "GLOBAL" } }));
  const grant = await prisma.userRole.findFirst({ where: { userId, roleId: role.id, revokedAt: null } });
  if (!grant) {
    await prisma.userRole.create({ data: { userId, roleId: role.id } });
  }
}

test("typing a field and leaving immediately still saves the value", async ({ page }) => {
  test.setTimeout(90_000);
  const prisma = new PrismaClient();
  const marker = `Flush leave ${crypto.randomUUID().slice(0, 8)}`;
  let formPath = "";
  try {
    const userId = await ensureUser(prisma, formEmail, "Autosave", "Proponent");
    const definition = await prisma.formDefinition.create({
      data: {
        code: "E2E-FLUSH",
        title: "E2E flush form",
        version: `e2e-${crypto.randomUUID().slice(0, 8)}`,
        effectiveDate: new Date("2025-08-01T00:00:00.000Z"),
        status: "PUBLISHED",
        publishedAt: new Date(),
        schema: {
          sections: [
            {
              id: "main",
              title: "Main",
              fields: [
                {
                  id: "short_title",
                  type: "text",
                  label: "Short title",
                  fillers: ["PROPONENT"],
                  validation: { maxLength: 200 },
                },
              ],
            },
          ],
        },
        createdById: userId,
      },
    });
    const protocol = await prisma.protocol.create({
      data: {
        title: `E2E autosave leave ${crypto.randomUUID().slice(0, 8)}`,
        leaderUserId: userId,
        createdById: userId,
        institution: "University of San Carlos",
        status: "Draft",
        members: {
          create: {
            userId,
            role: "PROPONENT",
            isLeader: true,
            status: "ACTIVE",
            rosterOrder: 1,
            institution: "University of San Carlos",
            designation: "Researcher",
          },
        },
        versions: { create: { number: 1, label: "1/10Nov2026", state: "WORKING" } },
      },
      include: { versions: true },
    });
    const version = protocol.versions[0];
    if (!version) throw new Error("Missing version");
    const instance = await prisma.formInstance.create({
      data: {
        formDefinitionId: definition.id,
        ownerType: "PROTOCOL_VERSION",
        ownerId: version.id,
        status: "DRAFT",
        data: {},
      },
    });
    formPath = `/app/protocols/${protocol.id}/forms/${instance.id}`;
  } finally {
    await prisma.$disconnect();
  }

  await signIn(page, formEmail);
  await page.goto(formPath);
  const field = page.locator("#short_title");
  await expect(field).toBeVisible({ timeout: 20_000 });
  await field.fill(marker);
  // Leave before the 800 ms debounce would fire.
  await page.getByRole("link", { name: "Forms" }).click();
  await expect(page.getByRole("heading", { name: /Forms/i }).or(page.getByText("E2E-FLUSH"))).toBeVisible({
    timeout: 20_000,
  });
  await page.goto(formPath);
  await expect(page.locator("#short_title")).toHaveValue(marker, { timeout: 20_000 });
});

test("typing a comment and clicking Return stores the comment", async ({ page }) => {
  test.setTimeout(120_000);
  const prisma = new PrismaClient();
  const comment = `Return flush ${crypto.randomUUID().slice(0, 8)}`;
  let protocolId = "";
  try {
    const staffId = await ensureUser(prisma, staffEmail, "Autosave", "Staff");
    await ensureStaffRole(prisma, staffId);
    const leaderId = await ensureUser(prisma, formEmail, "Autosave", "Proponent");
    const definition = await prisma.workflowDefinition.upsert({
      where: { key: WORKFLOW_KEY },
      update: {},
      create: { key: WORKFLOW_KEY, name: "E2E autosave flush", submissionType: "E2E" },
    });
    const version = await prisma.workflowVersion.upsert({
      where: { definitionId_number: { definitionId: definition.id, number: 1 } },
      update: { graph },
      create: { definitionId: definition.id, number: 1, status: "ARCHIVED", graph },
    });
    const protocol = await prisma.protocol.create({
      data: {
        title: `E2E autosave return ${crypto.randomUUID().slice(0, 8)}`,
        leaderUserId: leaderId,
        createdById: leaderId,
        institution: "University of San Carlos",
        status: "Under Screening",
        members: {
          create: {
            userId: leaderId,
            role: "PROPONENT",
            isLeader: true,
            status: "ACTIVE",
            rosterOrder: 1,
            institution: "University of San Carlos",
            designation: "Researcher",
          },
        },
        versions: { create: { number: 1, label: "1/10Nov2026", state: "WORKING" } },
      },
      include: { versions: true },
    });
    const protocolVersion = protocol.versions[0];
    if (!protocolVersion) throw new Error("Missing protocol version");
    await prisma.workflowInstance.create({
      data: {
        versionId: version.id,
        protocolId: protocol.id,
        protocolVersionId: protocolVersion.id,
        status: "RUNNING",
        currentStepKeys: ["screen"],
        tasks: {
          create: {
            stepKey: "screen",
            assigneeUserId: staffId,
            candidateRule: { kind: "ROLE", role: "REC_STAFF" },
            title: "Screen the test submission",
            status: "OPEN",
          },
        },
      },
    });
    protocolId = protocol.id;
  } finally {
    await prisma.$disconnect();
  }

  await signIn(page, staffEmail);
  await page.goto(`/app/protocols/${protocolId}`);
  await expect(page.getByText("Screen the test submission").first()).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Return").check();
  const box = page.locator('textarea[name="comment"]');
  await box.fill(comment);
  await page.getByRole("button", { name: /Complete Screen the test submission/i }).click();
  await expect(page.getByTestId("action-result")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.getByText(comment)).toBeVisible({ timeout: 20_000 });
});
