import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { AppError } from "@/server/errors";
import { convertDocxToPdf } from "@/server/docs/pdf";

describe("pdf converter", () => {
  it("posts the docx to Gotenberg and retries once", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = await pdf.save();
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return new Response("busy", { status: 503 });
      return new Response(Buffer.from(bytes), { status: 200 });
    };
    const out = await convertDocxToPdf(new Uint8Array([1, 2, 3]), {
      converter: "gotenberg",
      gotenbergUrl: "http://gotenberg.test",
      gotenbergSecret: "user:secret",
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(calls).toBe(2);
    expect(Buffer.from(out.subarray(0, 5)).toString()).toBe("%PDF-");
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
      converter: "soffice",
      soffice: async () => bytes,
    });
    expect(Buffer.from(out.subarray(0, 5)).toString()).toBe("%PDF-");
  });
});
