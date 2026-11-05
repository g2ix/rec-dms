import "server-only";
import sharp from "sharp";
import { AppError } from "@/server/errors";

export const SIGNATURE_MAX_WIDTH = 600;
export const SIGNATURE_MAX_HEIGHT = 200;
const WHITE = 245;

/**
 * Trim empty edges, turn a white paper background transparent, and fit inside 600×200.
 * The result is a PNG the form can place on a white plate.
 */
export async function prepareSignaturePng(input: Buffer): Promise<Buffer> {
  let decoded;
  try {
    decoded = sharp(input, { failOn: "error" }).rotate();
    const meta = await decoded.metadata();
    if (meta.format !== "png" && meta.format !== "jpeg") {
      throw new AppError("INVALID", "Upload a PNG or JPG signature.", 400);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("INVALID", "That file is not a PNG or JPG signature.", 400);
  }

  const { data, info } = await decoded.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = Buffer.from(data);
  let opaque = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index] ?? 0;
    const green = pixels[index + 1] ?? 0;
    const blue = pixels[index + 2] ?? 0;
    if (red >= WHITE && green >= WHITE && blue >= WHITE) pixels[index + 3] = 0;
    else if ((pixels[index + 3] ?? 0) > 0) opaque += 1;
  }
  if (opaque < 8) throw new AppError("INVALID", "That image does not contain a signature.", 400);

  try {
    return await sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4 } })
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
      .resize(SIGNATURE_MAX_WIDTH, SIGNATURE_MAX_HEIGHT, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    throw new AppError("INVALID", "That image does not contain a signature.", 400);
  }
}
