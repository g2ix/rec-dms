import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { prepareSignaturePng, SIGNATURE_MAX_HEIGHT, SIGNATURE_MAX_WIDTH } from "@/server/signatures/image";

describe("signature images", () => {
  it("turns a white background transparent and keeps the drawing inside 600 by 200", async () => {
    const source = await sharp({
      create: { width: 800, height: 400, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 40, height: 12, channels: 3, background: { r: 10, g: 10, b: 10 } },
          })
            .png()
            .toBuffer(),
          left: 30,
          top: 40,
        },
      ])
      .png()
      .toBuffer();

    const png = await prepareSignaturePng(source);
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width ?? 999).toBeLessThanOrEqual(50);
    expect(meta.height ?? 999).toBeLessThanOrEqual(20);
    expect(meta.width ?? 0).toBeLessThanOrEqual(SIGNATURE_MAX_WIDTH);
    expect(meta.height ?? 0).toBeLessThanOrEqual(SIGNATURE_MAX_HEIGHT);

    const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const mid = Math.floor(data.length / 8) * 4;
    expect(data[mid + 3]).toBe(255);
    expect(data[mid] ?? 255).toBeLessThan(40);
  });

  it("refuses a blank page", async () => {
    const blank = await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();
    await expect(prepareSignaturePng(blank)).rejects.toMatchObject({ code: "INVALID" });
  });
});
