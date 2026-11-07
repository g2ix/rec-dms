import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "@/lib/env";
import { AppError } from "@/server/errors";

export type PdfConverterKind = "gotenberg" | "libreoffice-local" | "soffice";

export type PdfConvertOptions = {
  converter?: PdfConverterKind;
  gotenbergUrl?: string;
  gotenbergSecret?: string;
  gotenbergUsername?: string;
  gotenbergPassword?: string;
  fetchImpl?: typeof fetch;
  soffice?: (docx: Uint8Array) => Promise<Uint8Array>;
  timeoutMs?: number;
  retryDelayMs?: number;
};

export interface PdfConverter {
  convert(docx: Uint8Array): Promise<Uint8Array>;
}

const DEFAULT_TIMEOUT_MS = 90_000;

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

function kindOf(options: PdfConvertOptions): "gotenberg" | "libreoffice-local" {
  const requested = options.converter ?? env.pdfConverter;
  return requested === "gotenberg" ? "gotenberg" : "libreoffice-local";
}

export function pdfConverter(options: PdfConvertOptions = {}): PdfConverter {
  if (kindOf(options) === "gotenberg") return new GotenbergConverter(options);
  return new LocalLibreOfficeConverter(options);
}

export async function convertDocxToPdf(docx: Uint8Array, options: PdfConvertOptions = {}): Promise<Uint8Array> {
  return pdfConverter(options).convert(docx);
}

export class GotenbergConverter implements PdfConverter {
  constructor(private readonly options: PdfConvertOptions = {}) {}

  async convert(docx: Uint8Array): Promise<Uint8Array> {
    const base = (this.options.gotenbergUrl ?? env.GOTENBERG_URL).replace(/\/$/, "");
    if (!base) {
      throw new AppError(
        "PDF_UNAVAILABLE",
        "PDF conversion is not configured. Set GOTENBERG_URL or use LibreOffice.",
        503,
      );
    }
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const delayMs = this.options.retryDelayMs ?? 500;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await postOnce(docx, base, this.options, timeoutMs);
      } catch (error) {
        lastError = error;
        if (error instanceof AppError && error.code === "PDF_UNAVAILABLE") throw error;
        if (!isRetryable(error) || attempt === 2) break;
        await sleep(delayMs * 2 ** attempt);
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error("Gotenberg did not return a PDF.");
  }
}

export class LocalLibreOfficeConverter implements PdfConverter {
  constructor(private readonly options: PdfConvertOptions = {}) {}

  async convert(docx: Uint8Array): Promise<Uint8Array> {
    if (this.options.soffice) return this.options.soffice(docx);
    return convertWithSoffice(docx, this.options.timeoutMs ?? 30_000);
  }
}

function authHeader(options: PdfConvertOptions): string | null {
  const username = options.gotenbergUsername ?? env.GOTENBERG_USERNAME;
  const password = options.gotenbergPassword ?? env.GOTENBERG_PASSWORD;
  if (username) {
    return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }
  const secret = options.gotenbergSecret ?? env.GOTENBERG_SECRET;
  if (!secret) return null;
  if (secret.includes(":")) return `Basic ${Buffer.from(secret).toString("base64")}`;
  return `Bearer ${secret}`;
}

async function postOnce(
  docx: Uint8Array,
  base: string,
  options: PdfConvertOptions,
  timeoutMs: number,
): Promise<Uint8Array> {
  const headers: Record<string, string> = {};
  const authorization = authHeader(options);
  if (authorization) headers.Authorization = authorization;
  const body = new FormData();
  body.append("files", new Blob([new Uint8Array(docx)]), "form.docx");
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${base}/forms/libreoffice/convert`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const retryable = new Error(error instanceof Error ? error.message : "Gotenberg timed out.");
    (retryable as Error & { retryable: boolean }).retryable = true;
    throw retryable;
  }
  if (!response.ok) {
    const error = new Error(`Gotenberg returned ${response.status}.`) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 5 || Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-") {
    throw new Error("Gotenberg did not return a PDF.");
  }
  return bytes;
}

function isRetryable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("retryable" in error && error.retryable === true) return true;
  if ("status" in error && typeof error.status === "number") return error.status >= 500 || error.status === 429;
  return false;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function convertWithSoffice(docx: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
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
      }, timeoutMs);
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
