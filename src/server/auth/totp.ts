import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { env } from "@/lib/env";

authenticator.options = { window: 1 };

/** The name authenticator apps show for this account. */
export const TOTP_ISSUER = "USC REC-DMS";

function key(): Buffer {
  return scryptSync(env.AUTH_SECRET, "recdms-totp-v1", 32);
}

export function sealSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function openSecret(sealed: string): string | null {
  const [ivText, tagText, dataText] = sealed.split(".");
  if (!ivText || !tagText || !dataText) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const plain = Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    return null;
  }
}

export function newTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpUri(email: string, secret: string): string {
  return authenticator.keyuri(email || "account", TOTP_ISSUER, secret);
}

/** An SVG QR code of the otpauth:// link, for authenticator apps to scan. */
export function totpQrSvg(uri: string): Promise<string> {
  return QRCode.toString(uri, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#000000", light: "#ffffff" } });
}

export function totpCodeMatches(secret: string, code: string): boolean {
  const token = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(token)) return false;
  return authenticator.verify({ token, secret });
}
