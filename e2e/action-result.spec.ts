import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { loadTestEnv } from "./test-env";

// The test database only (.env.test); refuses anything else.
loadTestEnv();

const password = "Usc-ethics-review-2026-protocol";
const proponentEmail = "e2e.result.proponent@usc.edu.ph";
const reviewerEmail = "e2e.result.reviewer@usc.edu.ph";

/** A small graph kept apart from the seeded workflows. It is never published, so no real protocol starts on it. */
const WORKFLOW_KEY = "E2E_ACTION_RESULT";
const graph = {
  startStep: "submit",
  steps: [
    { key: "submit", name: "Submit the test protocol", type: "TASK", assignee: { kind: "PROTOCOL_LEADER" } },
    {
      key: "screen",
      name: "Screen the test submission",
      type: "TASK",
      assignee: { kind: "ROLE", role: "REC_STAFF" },
      deadline: { amount: 2, unit: "CALENDAR_DAYS" },
      statusLabel: "Under Screening",
    },
    { key: "assess", name: "Assess the test protocol", type: "TASK", assignee: { kind: "ASSIGNED_IN_STEP", stepKey: "screen" } },
    {
      key: "decide",
      name: "Decide the test protocol",
      type: "TASK",
      assignee: { kind: "ROLE", role: "REC_CHAIR" },
      deadline: { amount: 3, unit: "CALENDAR_DAYS" },
    },
    { key: "end", name: "Done", type: "END" },
  ],
  transitions: [
    { from: "submit", to: "screen" },
    { from: "screen", to: "assess" },
    { from: "assess", to: "decide" },
    { from: "decide", to: "end" },
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

async function ensureWorkflowVersion(prisma: PrismaClient): Promise<string> {
  const definition = await prisma.workflowDefinition.upsert({
    where: { key: WORKFLOW_KEY },
    update: {},
    create: { key: WORKFLOW_KEY, name: "E2E action result", submissionType: "E2E" },
  });
  const version = await prisma.workflowVersion.upsert({
    where: { definitionId_number: { definitionId: definition.id, number: 1 } },
    update: { graph },
    create: { definitionId: definition.id, number: 1, status: "ARCHIVED", graph },
  });
  return version.id;
}

/** A protocol waiting on one step of the test graph, with that step's task open for `assigneeId`. */
async function protocolAtStep(input: { stepKey: "submit" | "assess"; assigneeId: string; reviewerId?: string }): Promise<string> {
  const prisma = new PrismaClient();
  try {
    const leaderId = await ensureUser(prisma, proponentEmail, "Result", "Proponent");
    const versionId = await ensureWorkflowVersion(prisma);
    const step = graph.steps.find((item) => item.key === input.stepKey);
    const protocol = await prisma.protocol.create({
      data: {
        title: `E2E action result ${crypto.randomUUID().slice(0, 8)}`,
        leaderUserId: leaderId,
        createdById: leaderId,
        institution: "University of San Carlos",
        researchType: "Social / Behavioral Research",
        researchTypeCodes: ["SOCIAL_BEHAVIORAL"],
        status: input.stepKey === "submit" ? "Draft" : "Under Review",
        members: {
          create: [
            { userId: leaderId, role: "PROPONENT", isLeader: true, status: "ACTIVE", rosterOrder: 1, institution: "University of San Carlos", designation: "Researcher" },
            ...(input.reviewerId ? [{ userId: input.reviewerId, role: "REVIEWER" as const, status: "ACTIVE" as const, rosterOrder: 2 }] : []),
          ],
        },
        versions: { create: { number: 1, label: "1/10Nov2026", state: "WORKING" } },
      },
      include: { versions: true },
    });
    const version = protocol.versions[0];
    if (!version) throw new Error("The test protocol has no version.");
    await prisma.workflowInstance.create({
      data: {
        versionId,
        protocolId: protocol.id,
        protocolVersionId: version.id,
        status: "RUNNING",
        currentStepKeys: [input.stepKey],
        assignments: input.reviewerId ? { screen: [input.reviewerId] } : {},
        tasks: {
          create: {
            stepKey: input.stepKey,
            assigneeUserId: input.assigneeId,
            candidateRule: step?.assignee,
            title: step?.name ?? "",
            status: "OPEN",
          },
        },
      },
    });
    return protocol.id;
  } finally {
    await prisma.$disconnect();
  }
}

async function userId(email: string, firstName: string, familyName: string): Promise<string> {
  const prisma = new PrismaClient();
  try {
    return await ensureUser(prisma, email, firstName, familyName);
  } finally {
    await prisma.$disconnect();
  }
}

test("a proponent submits, sees the confirmation, and lands on the protocol page", async ({ page }) => {
  test.setTimeout(150_000);
  const leaderId = await userId(proponentEmail, "Result", "Proponent");
  const protocolId = await protocolAtStep({ stepKey: "submit", assigneeId: leaderId });
  await signIn(page, proponentEmail);
  await page.goto(`/app/protocols/${protocolId}`);
  await page.getByRole("button", { name: "Submit for screening" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText("Protocol submitted.");
  // The actor and the deadline are the next step's own: REC Staff, 2 calendar days.
  await expect(dialog).toContainText("REC Staff acts next: Screen the test submission, within 2 days");

  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`/app/protocols/${protocolId}$`));
  await expect(page.getByRole("button", { name: "Submit for screening" })).toHaveCount(0);
});

test("a reviewer completes a review, sees the confirmation, and lands on My reviews", async ({ page }) => {
  test.setTimeout(150_000);
  const reviewerId = await userId(reviewerEmail, "Result", "Reviewer");
  const protocolId = await protocolAtStep({ stepKey: "assess", assigneeId: reviewerId, reviewerId });
  await signIn(page, reviewerEmail);
  await page.goto(`/app/protocols/${protocolId}`);
  await page.getByLabel("Comment").fill("Clear and complete.");
  await page.getByRole("button", { name: "Complete Assess the test protocol" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText("Completed: Assess the test protocol.");
  await expect(dialog).toContainText("REC Chair acts next: Decide the test protocol, within 3 days");

  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(page).toHaveURL(/\/app\/reviews$/, { timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "My reviews" })).toBeVisible({ timeout: 45_000 });
  await expect(dialog).toBeHidden();
});
