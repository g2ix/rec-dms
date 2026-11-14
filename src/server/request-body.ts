/** Browsers cap a keepalive request body at 64 KB, which is all these JSON routes take. */
export const JSON_BODY_LIMIT = 64 * 1024;

/**
 * Reads a JSON request body of at most `limit` bytes. Returns null for a larger body, invalid
 * JSON, or no body, so the caller's schema rejects it as before. Stopping at the limit keeps an
 * oversized array from reaching zod, which builds one issue per failing element (GHSA-mrhx-c7xc-m3w5).
 */
export async function readJsonBody(request: Request, limit = JSON_BODY_LIMIT): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    return null;
  }
}
