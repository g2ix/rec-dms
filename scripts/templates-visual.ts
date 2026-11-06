import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function onPath(command: string): boolean {
  const finder = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(finder, [command], { windowsHide: true, stdio: "ignore" });
  return result.status === 0;
}

const soffice =
  (process.env.SOFFICE_PATH && existsSync(process.env.SOFFICE_PATH) ? process.env.SOFFICE_PATH : null) ||
  (onPath("soffice") ? "soffice" : null);
const pdftoppm = onPath("pdftoppm");

if (!soffice || !pdftoppm) {
  console.log("templates:visual skipped. LibreOffice (soffice) and pdftoppm are not installed.");
  process.exit(0);
}

const baseline = join(process.cwd(), "templates", "baselines", "F-26.png");
if (!existsSync(baseline)) {
  console.log("templates:visual skipped. No baseline at templates/baselines/F-26.png.");
  process.exit(0);
}

const { fillDocx } = await import("../src/lib/docs/fill-docx");
const { placeholderMapSchema } = await import("../src/lib/docs/tags");
const { buildRenderModel } = await import("../src/lib/docs/view");
const { PREVIEW_BOUND_VALUES } = await import("../src/lib/forms/bindings");
const { convertDocxToPdf } = await import("../src/server/docs/pdf");
const { PNG } = await import("pngjs");
const pixelmatch = (await import("pixelmatch")).default;

const map = placeholderMapSchema.parse(JSON.parse(readFileSync("templates/maps/F-26.json", "utf8")));
const model = buildRenderModel({
  map,
  data: { submission_type: "INITIAL" },
  bound: PREVIEW_BOUND_VALUES,
  signatures: [],
});
const docx = fillDocx(readFileSync("templates/F-26.docx"), model.data, model.images);
const pdf = await convertDocxToPdf(docx, { converter: "soffice" });
const { mkdtempSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const dir = mkdtempSync(join(tmpdir(), "rec-visual-"));
writeFileSync(join(dir, "form.pdf"), pdf);
const raster = spawnSync(pdftoppm, ["-png", "-r", "72", "-f", "1", "-l", "1", join(dir, "form.pdf"), join(dir, "page")], {
  windowsHide: true,
});
if (raster.status !== 0) {
  console.error(raster.stderr?.toString() || "pdftoppm failed");
  process.exit(1);
}
const actual = PNG.sync.read(readFileSync(join(dir, "page-1.png")));
const expected = PNG.sync.read(readFileSync(baseline));
if (actual.width !== expected.width || actual.height !== expected.height) {
  console.error(`Page size ${actual.width}x${actual.height} does not match the baseline.`);
  process.exit(1);
}
const diff = new PNG({ width: actual.width, height: actual.height });
const mismatched = pixelmatch(expected.data, actual.data, diff.data, actual.width, actual.height, { threshold: 0.1 });
const ratio = mismatched / (actual.width * actual.height);
if (ratio > 0.01) {
  console.error(`F-26 page 1 differs from the baseline on ${(ratio * 100).toFixed(2)}% of pixels.`);
  process.exit(1);
}
console.log("templates:visual passed");
