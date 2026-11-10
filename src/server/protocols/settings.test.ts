import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { DEFAULT_MAX_UPLOAD_BYTES, maxUploadBytes, MAX_UPLOAD_KEY } from "@/server/protocols/settings";

describe("upload settings", () => {
  it("defaults to 100 MB when the setting is missing", async () => {
    await prisma.setting.deleteMany({ where: { key: MAX_UPLOAD_KEY } });
    expect(DEFAULT_MAX_UPLOAD_BYTES).toBe(100 * 1024 * 1024);
    expect(await maxUploadBytes()).toBe(100 * 1024 * 1024);
  });

  it("reads a stored limit", async () => {
    await prisma.setting.upsert({
      where: { key: MAX_UPLOAD_KEY },
      create: { key: MAX_UPLOAD_KEY, value: 12 * 1024 * 1024 },
      update: { value: 12 * 1024 * 1024 },
    });
    expect(await maxUploadBytes()).toBe(12 * 1024 * 1024);
  });
});
