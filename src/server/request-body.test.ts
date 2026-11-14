import { describe, expect, it } from "vitest";
import { readJsonBody } from "@/server/request-body";

function post(body: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/x", { method: "POST", body, headers, duplex: "half" } as RequestInit);
}

function chunked(text: string, size: number) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < bytes.length; at += size) controller.enqueue(bytes.slice(at, at + size));
      controller.close();
    },
  });
}

describe("readJsonBody", () => {
  it("parses a small JSON body", async () => {
    expect(await readJsonBody(post(JSON.stringify({ fields: [{ path: "a", value: 1 }] })))).toEqual({ fields: [{ path: "a", value: 1 }] });
  });

  it("returns null for invalid JSON or no body", async () => {
    expect(await readJsonBody(post("{nope"))).toBeNull();
    expect(await readJsonBody(post(null))).toBeNull();
  });

  it("refuses a body over the limit by its declared length", async () => {
    expect(await readJsonBody(post("[1]", { "content-length": "999999" }), 100)).toBeNull();
  });

  it("refuses a streamed body that grows past the limit without a length", async () => {
    const big = `[${Array(5_000).fill("0").join(",")}]`;
    expect(await readJsonBody(post(chunked(big, 512)), 1024)).toBeNull();
    expect(await readJsonBody(post(chunked("[1,2,3]", 2)), 1024)).toEqual([1, 2, 3]);
  });
});
