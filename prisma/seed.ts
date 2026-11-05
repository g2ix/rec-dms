import { PrismaClient } from "@prisma/client";

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
