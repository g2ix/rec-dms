import { describe, expect, it } from "vitest";
import { insertLoad } from "@/lib/reports/load-data";
import { prisma, useAppSchema } from "@/server/db";
import { dashboardIn } from "@/server/reports/dashboard";

class Rollback extends Error {}

describe("dashboard load", () => {
  it("answers the staff and chair dashboards in under a second for 5,000 protocols", async () => {
    let staffMs = 0;
    let chairMs = 0;
    try {
      await prisma.$transaction(
        async (tx) => {
          await useAppSchema(tx);
          const { userId } = await insertLoad(tx, 5000);
          let started = performance.now();
          await dashboardIn(tx, userId, "staff");
          staffMs = performance.now() - started;
          started = performance.now();
          await dashboardIn(tx, userId, "chair");
          chairMs = performance.now() - started;
          throw new Rollback();
        },
        { timeout: 180_000, maxWait: 20_000 },
      );
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(staffMs).toBeLessThan(1000);
    expect(chairMs).toBeLessThan(1000);
  }, 180_000);
});
