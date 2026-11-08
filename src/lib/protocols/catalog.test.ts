import { describe, expect, it } from "vitest";
import { formatFunding, formatResearchType, RESEARCH_TYPE_GROUPS, RESEARCH_TYPES, selectionError, studySelectionFromForm } from "./catalog";

describe("research type and funding catalogs", () => {
  it("joins the selected research types and the other specification", () => {
    expect(formatResearchType(["GENETIC", "OTHER"], "Community survey")).toBe(
      "Genetic Research; Others: Community survey",
    );
  });

  it("names a funding source with the detail it requires", () => {
    expect(formatFunding("AGENCY", "DOST")).toBe("Agency other than institution: DOST");
    expect(formatFunding("RESEARCHER", "")).toBe("Researcher-funded");
  });

  it("requires a specification when Others or a named funder is selected", () => {
    expect(selectionError({ researchTypeCodes: [], researchTypeOther: "", funding: [] }).researchType).toBe(
      "Choose at least one research type.",
    );
    expect(selectionError({ researchTypeCodes: ["OTHER"], researchTypeOther: "", funding: [] }).researchTypeOther).toBe(
      "Describe the other research type.",
    );
    const funding = selectionError({
      researchTypeCodes: ["STEM_CELL"],
      researchTypeOther: "",
      funding: [
        { code: "INSTITUTION", detail: "" },
        { code: "AGENCY", detail: "" },
        { code: "OTHER", detail: "" },
      ],
    }).fundingFields;
    expect(funding.INSTITUTION).toBe("Name the institution.");
    expect(funding.AGENCY).toBe("Name the agency.");
    expect(funding.OTHER).toBe("Describe the other source.");
  });

  it("groups every research type except Others", () => {
    const grouped = RESEARCH_TYPE_GROUPS.flatMap((group) => [...group.codes]);
    const listed = RESEARCH_TYPES.filter((type) => !type.specify).map((type) => type.code);
    expect(grouped.slice().sort()).toEqual(listed.slice().sort());
  });

  it("reads the posted choices in catalog order", () => {
    const form = new FormData();
    form.append("researchTypeCode", "OTHER");
    form.append("researchTypeCode", "SOCIAL_BEHAVIORAL");
    form.set("researchTypeOther", "Pilot");
    form.append("fundingCode", "OTHER");
    form.set("fundingDetail_OTHER", "Barangay fund");
    form.set("fundingDetail_AGENCY", "DOST-PCHRD");
    expect(studySelectionFromForm(form)).toEqual({
      researchType: "Social / Behavioral Research; Others: Pilot",
      researchTypeCodes: ["SOCIAL_BEHAVIORAL", "OTHER"],
      researchTypeOther: "Pilot",
      fundingSources: [{ code: "OTHER", name: "Others: Barangay fund", detail: "Barangay fund" }],
    });
  });
});
