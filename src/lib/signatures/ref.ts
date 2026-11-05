import { randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 10-character base32 reference, without digits and letters that look alike. */
export function randomVerifyRef(): string {
  const bytes = randomBytes(8);
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && output.length < 10) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return output;
}

export function normalizeVerifyRef(value: string): string {
  return value.trim().toUpperCase();
}
