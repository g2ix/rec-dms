import "server-only";
import { env } from "@/lib/env";

export type ScanResult = { clean: boolean; signature?: string };

export async function scanBytes(
  bytes: Uint8Array,
  options?: { fetchImpl?: typeof fetch; url?: string; token?: string },
): Promise<ScanResult> {
  const url = (options?.url ?? env.CLAMAV_URL).replace(/\/$/, "");
  const token = options?.token ?? env.CLAMAV_TOKEN;
  if (!url || !token) throw new Error("The virus scanner is not configured.");
  const fetchImpl = options?.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${url}/scan`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
      },
      body: Buffer.from(bytes),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    const wrapped = new Error(error instanceof Error ? error.message : "The virus scanner timed out.");
    (wrapped as Error & { retryable: boolean }).retryable = true;
    throw wrapped;
  }
  if (!response.ok) {
    const error = new Error(`The virus scanner returned ${response.status}.`) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  const body = (await response.json()) as { clean?: boolean; signature?: string };
  if (typeof body.clean !== "boolean") throw new Error("The virus scanner returned an unexpected result.");
  return { clean: body.clean, signature: body.signature };
}
