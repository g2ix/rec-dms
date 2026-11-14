import { PrismaClient } from "@prisma/client";
import { test as base } from "@playwright/test";

/**
 * Every test signs in from the same address (127.0.0.1), and the app allows 10 password sign-ins per
 * address per minute (SIGN_IN_LIMIT). A full run signs in faster than that, and a limited sign-in reads
 * "That email and password don't match". So each test starts with the address's count cleared, the way
 * each test would start from its own address. The limit itself is covered by rate-limit.test.ts.
 */
export const test = base.extend<{ freshSignInLimit: void }>({
  freshSignInLimit: [
    // Playwright reads the fixtures a fixture needs from this destructuring; this one needs none.
    async ({}, use) => {
      const prisma = new PrismaClient();
      try {
        await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "signin:" } } });
      } finally {
        await prisma.$disconnect();
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
