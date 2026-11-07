import { describe, expect, it } from "vitest";
import { containsEicar } from "@/server/scan/eicar";
import { scanBytes } from "@/server/scan/clamav";

describe("virus scan client", () => {
  it("recognises the EICAR test string", () => {
    const bytes = new TextEncoder().encode("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    expect(containsEicar(bytes)).toBe(true);
    expect(containsEicar(new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it("reads a clean or infected result and sends the bearer token", async () => {
    let authorization = "";
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(JSON.stringify({ clean: false, signature: "Eicar-Test-Signature" }), { status: 200 });
    };
    const result = await scanBytes(new Uint8Array([1]), {
      url: "https://scan.example",
      token: "token-1",
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(authorization).toBe("Bearer token-1");
    expect(result).toEqual({ clean: false, signature: "Eicar-Test-Signature" });
  });
});
