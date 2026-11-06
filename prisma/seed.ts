import { PrismaClient } from "@prisma/client";
import { installUscRec } from "./seed/usc-rec/install";

const prisma = new PrismaClient();

function displayName(firstName: string, familyName: string): string {
  return `${firstName} ${familyName}`;
}

async function main() {
  const emails = (process.env.BOOTSTRAP_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const email = emails[0];

  await prisma.setting.upsert({
    where: { key: "auth.autoApproveDomains" },
    create: { key: "auth.autoApproveDomains", value: ["usc.edu.ph"] },
    update: {},
  });
  await prisma.setting.upsert({
    where: { key: "protocol.requiredForms" },
    create: { key: "protocol.requiredForms", value: [] },
    update: {},
  });
  await prisma.setting.upsert({
    where: { key: "protocol.requiredUploads" },
    create: { key: "protocol.requiredUploads", value: ["MANUSCRIPT", "COVER_LETTER", "FEE_RECEIPT"] },
    update: {},
  });
  await prisma.setting.upsert({
    where: { key: "uploads.maxBytes" },
    create: { key: "uploads.maxBytes", value: 25 * 1024 * 1024 },
    update: {},
  });

  const panels = [
    {
      code: "P1",
      name: "Panel 1 — Management, Education, Political Science, Law, Economics, Accountancy",
      disciplines: ["Management", "Education", "Political Science", "Law", "Economics", "Accountancy"],
    },
    {
      code: "P2",
      name: "Panel 2 — Engineering, Architecture, Fine Arts, Psychology, SoAn, other social sciences",
      disciplines: ["Engineering", "Architecture", "Fine Arts", "Psychology", "SoAn", "Other social sciences"],
    },
    {
      code: "P3",
      name: "Panel 3 — Natural Sciences and Health Sciences",
      disciplines: ["Natural Sciences", "Health Sciences"],
    },
  ];
  for (const panel of panels) {
    const row = await prisma.panel.upsert({
      where: { code: panel.code },
      create: { code: panel.code, name: panel.name },
      update: { name: panel.name },
    });
    for (const name of panel.disciplines) {
      await prisma.discipline.upsert({
        where: { name },
        create: { name, panelId: row.id },
        update: { panelId: row.id },
      });
    }
  }

  await installUscRec(prisma);

  if (!email) {
    console.log("BOOTSTRAP_ADMIN_EMAILS is empty. No admin was created.");
    return;
  }

  const existing = await prisma.userEmail.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin already exists for ${email}.`);
    return;
  }

  const name = displayName("System", "Admin");
  const verifiedAt = new Date();
  const user = await prisma.user.create({
    data: {
      firstName: "System",
      familyName: "Admin",
      displayName: name,
      name,
      email,
      emailVerified: verifiedAt,
      status: "ACTIVE",
      emails: {
        create: { email, verifiedAt, isContact: true, isPrimary: true },
      },
    },
    include: { emails: true },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { primaryEmailId: user.emails[0]?.id, approvedAt: verifiedAt },
  });
  console.log(`Created bootstrap admin ${email}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
