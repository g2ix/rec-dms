const encoder = new TextEncoder();

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export async function signTotpCookie(userId: string, secret: string, now = Date.now()): Promise<string> {
  const exp = now + 12 * 60 * 60 * 1000;
  const payload = `${userId}.${exp}`;
  const signature = await hmac(secret, payload);
  return `${payload}.${signature}`;
}

export async function totpCookieValid(
  value: string | undefined,
  userId: string,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  if (!value || !secret || !userId) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [id, expText, signature] = parts;
  if (id !== userId || !expText || !signature) return false;
  const exp = Number(expText);
  if (!Number.isFinite(exp) || exp < now) return false;
  const expected = await hmac(secret, `${id}.${expText}`);
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return mismatch === 0;
}

export function sameOriginHost(originHost: string, host: string, development: boolean): boolean {
  if (originHost === host) return true;
  if (!development) return false;
  return originHost.replace("127.0.0.1", "localhost") === host.replace("127.0.0.1", "localhost");
}
