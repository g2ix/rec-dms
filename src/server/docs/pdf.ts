import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "@/lib/env";
import { AppError } from "@/server/errors";

export type PdfConverterKind = "gotenberg" | "soffice";

export type PdfConvertOptions = {
  converter?: PdfConverterKind;
  gotenbergUrl?: string;
  gotenbergSecret?: string;
  fetchImpl?: typeof fetch;
  soffice?: (docx: Uint8Array) => Promise<Uint8Array>;
};

export async function sofficeBin(): Promise<string | null> {
  const fromEnv = process.env.SOFFICE_PATH?.trim();
  const candidates = [fromEnv, "C:\\Program Files\\LibreOffice\\program\\soffice.exe"].filter(
    (value): value is string => Boolean(value),
  );
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return "soffice";
}

export async function convertDocxToPdf(docx: Uint8Array, options: PdfConvertOptions = {}): Promise<Uint8Array> {
  const converter = options.converter ?? (env.PDF_CONVERTER === "gotenberg" ? "gotenberg" : "soffice");
  try {
    return await convertOnce(docx, converter, options);
  } catch (error) {
    if (error instanceof AppError && error.code === "PDF_UNAVAILABLE") throw error;
    return convertOnce(docx, converter, options);
  }
}

async function convertOnce(
  docx: Uint8Array,
  converter: PdfConverterKind,
  options: PdfConvertOptions,
): Promise<Uint8Array> {
  if (converter === "gotenberg") return convertWithGotenberg(docx, options);
  if (options.soffice) return options.soffice(docx);
  return convertWithSoffice(docx);
}

async function convertWithGotenberg(docx: Uint8Array, options: PdfConvertOptions): Promise<Uint8Array> {
  const base = (options.gotenbergUrl ?? env.GOTENBERG_URL).replace(/\/$/, "");
  if (!base) {
    throw new AppError("PDF_UNAVAILABLE", "PDF conversion is not configured. Set GOTENBERG_URL or use LibreOffice.", 503);
  }
  const secret = options.gotenbergSecret ?? env.GOTENBERG_SECRET;
  const headers: Record<string, string> = {};
  if (secret.includes(":")) headers.Authorization = `Basic ${Buffer.from(secret).toString("base64")}`;
  else if (secret) headers.Authorization = `Bearer ${secret}`;
  const body = new FormData();
  body.append("files", new Blob([new Uint8Array(docx)]), "form.docx");
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${base}/forms/libreoffice/convert`, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Gotenberg returned ${response.status}.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 5 || Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-") {
    throw new Error("Gotenberg did not return a PDF.");
  }
  return bytes;
}

async function convertWithSoffice(docx: Uint8Array): Promise<Uint8Array> {
  const bin = await sofficeBin();
  const dir = await mkdtemp(join(tmpdir(), "rec-dms-pdf-"));
  const input = join(dir, "form.docx");
  try {
    await writeFile(input, docx);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin ?? "soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, input], {
        windowsHide: true,
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("LibreOffice took too long."));
      }, 30_000);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`LibreOffice exited with ${code ?? "no code"}.`));
      });
    });
    return await readFile(join(dir, "form.pdf"));
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (missing) {
      throw new AppError(
        "PDF_UNAVAILABLE",
        "LibreOffice is not installed. Set PDF_CONVERTER=gotenberg or install soffice.",
        503,
      );
    }
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
