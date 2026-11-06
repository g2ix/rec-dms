export const OFFICIAL_FILE_STEMS: Record<string, string> = {
  "F-26": "F-26 Document Receipt Form",
  "F-27": "F-27 Research Protocol Application Form",
  "F-28": "F-28 Data Privacy Consent Form",
  "F-29": "F-29 Capsule Proposal",
  "F-30": "F-30 Detailed Budget Sheet",
  "F-31": "F-31 Form on Determining the Type of Review",
  "F-35": "F-35 Protocol Review Assessment Form",
  "F-36": "F-36 Informed Consent Form Assessment Checklist",
  "F-37": "F-37 Summary of Reviewers' Comments",
  "F-38": "F-38 Summary of Actions Taken",
  "F-39": "F-39 Notification of REC Decision",
  "F-41": "F-41 Checklist for Exemption from Ethical Review",
  COA: "Certificate of Approval",
};

export const PACKAGE_PARTS = [
  { type: "form", code: "F-26" },
  { type: "upload", kind: "COVER_LETTER" },
  { type: "form", code: "F-27" },
  { type: "form", code: "F-28" },
  { type: "form", code: "F-29" },
  { type: "form", code: "F-35" },
  { type: "form", code: "F-36" },
  { type: "form", code: "F-30" },
  { type: "upload", kind: "MANUSCRIPT" },
] as const;

export type FileNameSetting = Record<string, string>;

export function defaultFileNameSetting(): FileNameSetting {
  const setting: FileNameSetting = {};
  for (const [code, stem] of Object.entries(OFFICIAL_FILE_STEMS)) {
    setting[code] = `${stem}.{ext}`;
  }
  setting.COVER_LETTER = "Cover Letter.{ext}";
  setting.MANUSCRIPT = "{name}";
  return setting;
}

export function applyFileNamePattern(
  pattern: string,
  vars: { code?: string; title?: string; ext: string; name?: string },
): string {
  return pattern
    .replaceAll("{code}", vars.code ?? "")
    .replaceAll("{title}", vars.title ?? "")
    .replaceAll("{ext}", vars.ext)
    .replaceAll("{name}", vars.name ?? "")
    .replace(/[\\/:*?"<>|]/g, "")
    .trim();
}

export function officialFormFileName(setting: FileNameSetting, code: string, ext: string): string {
  const pattern = setting[code] || defaultFileNameSetting()[code] || `${code}.{ext}`;
  const stem = OFFICIAL_FILE_STEMS[code] ?? code;
  return applyFileNamePattern(pattern, { code, title: stem, ext, name: `${stem}.${ext}` });
}
