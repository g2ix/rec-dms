import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { loadTestEnv } from "./test-env";
import { uscForms } from "../prisma/seed/usc-rec/forms";

// The test database only (.env.test); refuses anything else.
loadTestEnv();

const email = "e2e.assessment@usc.edu.ph";
const password = "Usc-ethics-review-2026-protocol";
const title = "E2E assessment protocol";

async function signIn(page: Page) {
  await page.locator("#sign-in-email").fill(email);
  await page.locator("#sign-in-password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 20_000 });
}

async function ensureProtocol(): Promise<string> {
  const prisma = new PrismaClient();
  try {
    const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    let userId = (await prisma.userEmail.findUnique({ where: { email } }))?.userId;
    if (!userId) {
      const verifiedAt = new Date();
      const user = await prisma.user.create({
        data: {
          firstName: "Assessment",
          familyName: "Proponent",
          displayName: "Assessment Proponent",
          name: "Assessment Proponent",
          email,
          emailVerified: verifiedAt,
          status: "ACTIVE",
          approvedAt: verifiedAt,
          passwordHash,
          emails: { create: { email, verifiedAt, isContact: true, isPrimary: true } },
        },
        include: { emails: true },
      });
      await prisma.user.update({ where: { id: user.id }, data: { primaryEmailId: user.emails[0]?.id } });
      userId = user.id;
    }
    const form = uscForms.find((item) => item.code === "F-35");
    if (!form) throw new Error("F-35 is missing from the seed.");
    const definition =
      (await prisma.formDefinition.findFirst({ where: { code: "F-35", status: "PUBLISHED" } })) ??
      (await prisma.formDefinition.create({
        data: {
          code: form.code,
          title: form.title,
          version: form.version,
          effectiveDate: new Date("2025-08-01T00:00:00.000Z"),
          status: "PUBLISHED",
          publishedAt: new Date(),
          schema: form.schema as never,
          createdById: userId,
        },
      }));
    const existing = await prisma.protocol.findFirst({
      where: { title, leaderUserId: userId },
      include: { versions: true },
    });
    const protocol =
      existing ??
      (await prisma.protocol.create({
        data: {
          title,
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
              institution: "University of San Carlos",
              designation: "Researcher",
            },
          },
          versions: { create: { number: 1, label: "1/06Nov2026", state: "WORKING" } },
        },
        include: { versions: true },
      }));
    const version = protocol.versions[0];
    if (!version) throw new Error("The sample protocol has no version.");
    const instance =
      (await prisma.formInstance.findFirst({
        where: { ownerType: "PROTOCOL_VERSION", ownerId: version.id, formDefinitionId: definition.id },
      })) ??
      (await prisma.formInstance.create({
        data: {
          formDefinitionId: definition.id,
          ownerType: "PROTOCOL_VERSION",
          ownerId: version.id,
          status: "DRAFT",
          data: {},
        },
      }));
    return `/app/protocols/${protocol.id}/forms/${instance.id}`;
  } finally {
    await prisma.$disconnect();
  }
}

test("F-37 shows only the points flagged as needing action", async ({ page }) => {
  test.setTimeout(60_000);
  const prisma = new PrismaClient();
  const form = uscForms.find((item) => item.code === "F-37");
  if (!form) throw new Error("F-37 is missing from the seed.");
  const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  let userId = (await prisma.userEmail.findUnique({ where: { email } }))?.userId;
  if (!userId) {
    const verifiedAt = new Date();
    const user = await prisma.user.create({
      data: {
        firstName: "Assessment",
        familyName: "Proponent",
        displayName: "Assessment Proponent",
        name: "Assessment Proponent",
        email,
        emailVerified: verifiedAt,
        status: "ACTIVE",
        approvedAt: verifiedAt,
        passwordHash,
        emails: { create: { email, verifiedAt, isContact: true, isPrimary: true } },
      },
      include: { emails: true },
    });
    await prisma.user.update({ where: { id: user.id }, data: { primaryEmailId: user.emails[0]?.id } });
    userId = user.id;
  }
  const definition = await prisma.formDefinition.create({
    data: {
      code: "F-37",
      title: form.title,
      version: `e2e-${crypto.randomUUID().slice(0, 8)}`,
      effectiveDate: new Date("2025-08-01T00:00:00.000Z"),
      status: "PUBLISHED",
      publishedAt: new Date(),
      schema: form.schema as never,
      createdById: userId,
    },
  });
  const protocol = await prisma.protocol.create({
    data: {
      title: `E2E summary ${crypto.randomUUID().slice(0, 8)}`,
      leaderUserId: userId,
      createdById: userId,
      institution: "University of San Carlos",
      status: "Under Review",
      members: {
        create: { userId, role: "PROPONENT", isLeader: true, status: "ACTIVE", rosterOrder: 1, institution: "University of San Carlos", designation: "Researcher" },
      },
      versions: { create: { number: 1, label: "1/06Nov2026", state: "WORKING" } },
    },
    include: { versions: true },
  });
  const version = protocol.versions[0];
  if (!version) throw new Error("The sample protocol has no version.");
  const instance = await prisma.formInstance.create({
    data: {
      formDefinitionId: definition.id,
      ownerType: "PROTOCOL_VERSION",
      ownerId: version.id,
      status: "DRAFT",
      data: {
        praf: {
          p101: { comments: "Reviewer 1: Narrow the question.", recommendations: "", needs_action: true },
          p102: { comments: "Looks fine.", recommendations: "No recommendations", needs_action: false },
        },
      },
    },
  });
  await prisma.$disconnect();
  await page.goto("/sign-in");
  await signIn(page);
  await page.goto(`/app/protocols/${protocol.id}/forms/${instance.id}`);
  await expect(page.getByText("Is/Are the main research question(s) reasonable?")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Needs action")).toBeVisible();
  await expect(page.getByText("Are the study objectives specific, measurable, attainable, and reasonable based on the research instrument(s) presented?")).toHaveCount(0);
  const comment = page.locator("[id='praf.p101.comments']");
  await expect(comment).toHaveValue("Reviewer 1: Narrow the question.");
  await expect(comment).toHaveAttribute("readonly", "");
});

test("the protocol assessment shows the form wording and stacks on a phone", async ({ page }) => {
  test.setTimeout(60_000);
  const path = await ensureProtocol();
  await page.goto("/sign-in");
  await signIn(page);
  await page.goto(path);
  await expect(page.getByText("Is/Are the main research question(s) reasonable?")).toBeVisible({ timeout: 20_000 });
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(
    page.locator(".rec-assess__label", { hasText: "Page and paragraph number where assessment point can be found" }).first(),
  ).toBeVisible();
});
