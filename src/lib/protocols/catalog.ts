import { z } from "zod";

/** Research types from the REC application. `OTHER` needs a specification. */
export const RESEARCH_TYPES = [
  { code: "CLINICAL_SPONSORED", label: "Clinical Trial (Sponsored)", specify: false },
  { code: "SOCIAL_BEHAVIORAL", label: "Social / Behavioral Research", specify: false },
  { code: "STEM_CELL", label: "Stem Cell Research", specify: false },
  { code: "CLINICAL_RESEARCHER", label: "Clinical Trials (Researcher-initiated)", specify: false },
  { code: "PUBLIC_HEALTH", label: "Public Health / Epidemiologic Research", specify: false },
  { code: "GENETIC", label: "Genetic Research", specify: false },
  { code: "HEALTH_OPERATIONS", label: "Health Operations Research (Health Programs and Policies)", specify: false },
  { code: "BIOMEDICAL", label: "Biomedical research (Retrospective, Prospective and diagnostic studies)", specify: false },
  { code: "OTHER", label: "Others: please specify", specify: true },
] as const;

/** Funding sources from the REC application. Three of them need a specification. */
export const FUNDING_KINDS = [
  { code: "RESEARCHER", label: "Researcher-funded", detail: "NONE" },
  {
    code: "INSTITUTION",
    label: "Institution-funded",
    detail: "INSTITUTION",
    prompt: "Which institution?",
    placeholder: "University of San Carlos",
    empty: "Name the institution.",
  },
  {
    code: "AGENCY",
    label: "Agency other than institution",
    detail: "AGENCY",
    prompt: "Agency name",
    placeholder: "DOST-PCHRD",
    empty: "Name the agency.",
  },
  {
    code: "OTHER",
    label: "Others",
    detail: "OTHER",
    prompt: "Please specify",
    placeholder: "Describe the source",
    empty: "Describe the other source.",
  },
] as const;

export type ResearchTypeCode = (typeof RESEARCH_TYPES)[number]["code"];
export type FundingKindCode = (typeof FUNDING_KINDS)[number]["code"];

/** Display groups for the research-type tiles. Stored labels stay on RESEARCH_TYPES. */
export const RESEARCH_TYPE_GROUPS = [
  {
    label: "Clinical and biomedical",
    codes: ["CLINICAL_SPONSORED", "CLINICAL_RESEARCHER", "BIOMEDICAL"],
  },
  {
    label: "Laboratory and genetic",
    codes: ["STEM_CELL", "GENETIC"],
  },
  {
    label: "Population and social",
    codes: ["SOCIAL_BEHAVIORAL", "PUBLIC_HEALTH", "HEALTH_OPERATIONS"],
  },
] as const;

export const RESEARCH_TYPE_OPTIONS = RESEARCH_TYPES.map((type) => ({ value: type.code, label: type.label }));
export const FUNDING_KIND_OPTIONS = FUNDING_KINDS.map((kind) => ({ value: kind.code, label: kind.label }));

const RESEARCH_CODES = new Set<string>(RESEARCH_TYPES.map((type) => type.code));
const FUNDING_BY_CODE = new Map(FUNDING_KINDS.map((kind) => [kind.code, kind]));

export function formatResearchType(codes: readonly string[], other: string): string {
  const specified = other.trim();
  return RESEARCH_TYPES.filter((type) => codes.includes(type.code))
    .map((type) => (type.specify ? `Others: ${specified}` : type.label))
    .join("; ");
}

export function formatFunding(code: string, detail: string): string {
  const kind = FUNDING_BY_CODE.get(code as FundingKindCode);
  const specified = detail.trim();
  if (!kind || kind.detail === "NONE") return kind?.label ?? specified;
  if (kind.detail === "OTHER") return `Others: ${specified}`;
  return `${kind.label}: ${specified}`;
}

function fundingDetailMessage(code: string): string {
  const kind = FUNDING_BY_CODE.get(code as FundingKindCode);
  if (kind && "empty" in kind) return kind.empty;
  return "Describe the other source.";
}

function fundingIssueCode(path: readonly PropertyKey[], funding: { code: string }[]): FundingKindCode | undefined {
  const slot = path[1];
  if (typeof slot === "string" && FUNDING_BY_CODE.has(slot as FundingKindCode)) return slot as FundingKindCode;
  if (typeof slot === "number") {
    const code = funding[slot]?.code;
    if (code && FUNDING_BY_CODE.has(code as FundingKindCode)) return code as FundingKindCode;
  }
  return undefined;
}

export const studySelectionSchema = z
  .object({
    researchTypeCodes: z.array(z.string()),
    researchTypeOther: z.string().trim().max(160, "Keep the other research type to 160 characters."),
    funding: z
      .array(
        z.object({
          code: z.string(),
          detail: z.string().trim().max(160, "Keep the funding detail to 160 characters."),
        }),
      )
      .max(FUNDING_KINDS.length),
  })
  .superRefine((value, ctx) => {
    const codes = [...new Set(value.researchTypeCodes)];
    if (codes.length === 0) {
      ctx.addIssue({ code: "custom", path: ["researchTypeCodes"], message: "Choose at least one research type." });
    }
    for (const code of codes) {
      if (!RESEARCH_CODES.has(code)) {
        ctx.addIssue({ code: "custom", path: ["researchTypeCodes"], message: "Choose a research type from the list." });
      }
    }
    if (codes.includes("OTHER") && !value.researchTypeOther.trim()) {
      ctx.addIssue({ code: "custom", path: ["researchTypeOther"], message: "Describe the other research type." });
    }
    const seen = new Set<string>();
    for (const source of value.funding) {
      const kind = FUNDING_BY_CODE.get(source.code as FundingKindCode);
      if (!kind || seen.has(source.code)) {
        ctx.addIssue({ code: "custom", path: ["funding"], message: "Choose a funding source from the list." });
        continue;
      }
      seen.add(source.code);
      if (kind.detail !== "NONE" && !source.detail.trim()) {
        ctx.addIssue({ code: "custom", path: ["funding", source.code], message: fundingDetailMessage(source.code) });
      }
    }
  });

export type StoredFunding = { code: string; name: string; detail: string };

export function studySelectionFromForm(formData: FormData): {
  researchType: string;
  researchTypeCodes: string[];
  researchTypeOther: string;
  fundingSources: StoredFunding[];
} {
  const parsed = studySelectionSchema.parse({
    researchTypeCodes: formData.getAll("researchTypeCode").map(String),
    researchTypeOther: String(formData.get("researchTypeOther") ?? ""),
    funding: formData.getAll("fundingCode").map((code) => ({
      code: String(code),
      detail: String(formData.get(`fundingDetail_${String(code)}`) ?? ""),
    })),
  });
  const researchTypeCodes = RESEARCH_TYPES.map((type) => type.code).filter((code) => parsed.researchTypeCodes.includes(code));
  const researchTypeOther = researchTypeCodes.includes("OTHER") ? parsed.researchTypeOther.trim() : "";
  const chosen = new Set(parsed.funding.map((source) => source.code));
  const fundingSources = FUNDING_KINDS.filter((kind) => chosen.has(kind.code)).map((kind) => {
    const detail = kind.detail === "NONE" ? "" : (parsed.funding.find((source) => source.code === kind.code)?.detail.trim() ?? "");
    return { code: kind.code, name: formatFunding(kind.code, detail), detail };
  });
  return {
    researchType: formatResearchType(researchTypeCodes, researchTypeOther),
    researchTypeCodes,
    researchTypeOther,
    fundingSources,
  };
}

export function selectionError(input: {
  researchTypeCodes: readonly string[];
  researchTypeOther: string;
  funding: { code: string; detail: string }[];
}): {
  researchType?: string;
  researchTypeOther?: string;
  funding?: string;
  fundingFields: Partial<Record<FundingKindCode, string>>;
} {
  const parsed = studySelectionSchema.safeParse(input);
  const fundingFields: Partial<Record<FundingKindCode, string>> = {};
  if (parsed.success) return { fundingFields };
  const errors: { researchType?: string; researchTypeOther?: string; funding?: string } = {};
  for (const issue of parsed.error.issues) {
    if (issue.path[0] === "funding") {
      const code = fundingIssueCode(issue.path, input.funding);
      if (code) {
        if (!fundingFields[code]) fundingFields[code] = issue.message;
      } else if (!errors.funding) {
        errors.funding = issue.message;
      }
      continue;
    }
    const key = issue.path[0] === "researchTypeOther" ? "researchTypeOther" : "researchType";
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ...errors, fundingFields };
}
