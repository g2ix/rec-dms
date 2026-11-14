import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "./fixtures";
import { loadTestEnv } from "./test-env";
import { confirmItIsYou, enrollAuthenticator } from "./totp";

// The test database only (.env.test); refuses anything else.
loadTestEnv();

const email = "e2e.form.editor@usc.edu.ph";
const password = "Usc-ethics-review-2026-protocol";

async function ensureSystemAdmin(prisma: PrismaClient): Promise<string> {
  const existing = await prisma.userEmail.findUnique({ where: { email } });
  let userId = existing?.userId;
  if (!userId) {
    const verifiedAt = new Date();
    const user = await prisma.user.create({
      data: {
        firstName: "Form",
        familyName: "Editor",
        displayName: "Form Editor",
        name: "Form Editor",
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
    userId = user.id;
  }
  const role =
    (await prisma.role.findUnique({ where: { key: "SYSTEM_ADMIN" } })) ??
    (await prisma.role.create({ data: { key: "SYSTEM_ADMIN", name: "System Admin", scope: "GLOBAL" } }));
  const grant = await prisma.userRole.findFirst({ where: { userId, roleId: role.id, revokedAt: null } });
  if (!grant) await prisma.userRole.create({ data: { userId, roleId: role.id } });
  await enrollAuthenticator(prisma, userId);
  return userId;
}

// Monaco must load from our own origin: the content security policy allows scripts from 'self' only.
test("the form builder's JSON editor loads under the content security policy", async ({ page }) => {
  // The first visit compiles the admin page and the Monaco chunk in the dev server.
  test.setTimeout(120_000);
  const prisma = new PrismaClient();
  let formId: string;
  try {
    await ensureSystemAdmin(prisma);
    const form = await prisma.formDefinition.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!form) throw new Error("The seed has no form definition.");
    formId = form.id;
  } finally {
    await prisma.$disconnect();
  }

  const blocked: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|cdn\.jsdelivr/i.test(message.text())) blocked.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (!new URL(request.url()).host.startsWith("localhost")) blocked.push(`${request.url()} ${request.failure()?.errorText ?? ""}`);
  });

  await page.goto("/sign-in");
  await page.locator("#sign-in-email").fill(email);
  await page.locator("#sign-in-password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await confirmItIsYou(page);

  await page.goto(`/admin/forms/${formId}`);
  const editor = page.locator(".rec-editor .monaco-editor");
  await expect(editor).toBeVisible({ timeout: 30_000 });
  // The schema text is in the editor, and no script was fetched from another origin.
  await expect(page.locator(".rec-editor .view-lines")).toContainText("sections", { timeout: 10_000 });
  expect(blocked).toEqual([]);
});
