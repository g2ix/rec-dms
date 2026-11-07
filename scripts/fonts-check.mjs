import { readFileSync } from "node:fs";

const base = (process.env.GOTENBERG_URL || "").replace(/\/$/, "");
const username = process.env.GOTENBERG_USERNAME || "";
const password = process.env.GOTENBERG_PASSWORD || "";
if (!base || !username) {
  console.error("Set GOTENBERG_URL, GOTENBERG_USERNAME, and GOTENBERG_PASSWORD.");
  process.exit(1);
}

const docx = readFileSync(new URL("../templates/F-26.docx", import.meta.url));
const body = new FormData();
body.append("files", new Blob([docx]), "F-26.docx");
const response = await fetch(`${base}/forms/libreoffice/convert`, {
  method: "POST",
  headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` },
  body,
  signal: AbortSignal.timeout(90_000),
});
if (!response.ok) {
  console.error(`Gotenberg returned ${response.status}.`);
  process.exit(1);
}
const pdf = Buffer.from(await response.arrayBuffer());
if (pdf.subarray(0, 5).toString() !== "%PDF-") {
  console.error("The response was not a PDF.");
  process.exit(1);
}
const text = pdf.toString("latin1");
if (!text.includes("TimesNewRoman") && !text.includes("Times New Roman")) {
  console.error("The PDF does not embed Times New Roman.");
  process.exit(1);
}
console.log("F-26 embeds Times New Roman.");
