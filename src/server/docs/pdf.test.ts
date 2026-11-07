import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { AppError } from "@/server/errors";
import { convertDocxToPdf } from "@/server/docs/pdf";

describe("pdf converter", () => {
  it("posts the docx to Gotenberg and retries twice on a 5xx", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = await pdf.save();
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls < 3) return new Response("busy", { status: 503 });
      return new Response(Buffer.from(bytes), { status: 200 });
    };
    const out = await convertDocxToPdf(new Uint8Array([1, 2, 3]), {
      converter: "gotenberg",
      gotenbergUrl: "http://gotenberg.test",
      gotenbergUsername: "user",
      gotenbergPassword: "secret",
      retryDelayMs: 0,
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(calls).toBe(3);
    expect(Buffer.from(out.subarray(0, 5)).toString()).toBe("%PDF-");
  });

  it("does not retry a 4xx from Gotenberg", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response("no", { status: 401 });
    };
    await expect(
      convertDocxToPdf(new Uint8Array([1]), {
        converter: "gotenberg",
        gotenbergUrl: "http://gotenberg.test",
        retryDelayMs: 0,
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toThrow(/401/);
    expect(calls).toBe(1);
  });

  it("refuses Gotenberg when no URL is configured", async () => {
    await expect(
      convertDocxToPdf(new Uint8Array([1]), { converter: "gotenberg", gotenbergUrl: "" }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("uses the injected LibreOffice converter", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = await pdf.save();
    const out = await convertDocxToPdf(new Uint8Array([1]), {
      converter: "libreoffice-local",
      soffice: async () => bytes,
    });
    expect(Buffer.from(out.subarray(0, 5)).toString()).toBe("%PDF-");
  });
});
