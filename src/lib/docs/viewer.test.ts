import { describe, expect, it } from "vitest";
import { viewerKindFor } from "@/lib/docs/viewer";

describe("viewerKindFor", () => {
  it("treats PDFs as embedded documents", () => {
    expect(viewerKindFor("application/pdf", "a.pdf")).toBe("pdf");
    expect(viewerKindFor("application/octet-stream", "letter.PDF")).toBe("pdf");
  });

  it("treats common image types as images", () => {
    expect(viewerKindFor("image/png", "scan.png")).toBe("image");
    expect(viewerKindFor("image/jpeg", "receipt.jpg")).toBe("image");
    expect(viewerKindFor("application/octet-stream", "photo.webp")).toBe("image");
  });

  it("falls back to download for Word and unknown files", () => {
    expect(viewerKindFor("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "F-39.docx")).toBe(
      "download",
    );
    expect(viewerKindFor("application/zip", "package.zip")).toBe("download");
  });
});
