export type AffiliationKind = "STUDENT" | "FACULTY";

export type StudentAffiliation = {
  kind: "STUDENT";
  course: string;
  yearLabel: string;
  institution: string;
};

export type FacultyAffiliation = {
  kind: "FACULTY";
  position: string;
  unit: string;
  institution: string;
};

export type Affiliation = StudentAffiliation | FacultyAffiliation;

export function formatDesignation(affiliation: Affiliation): string {
  if (affiliation.kind === "STUDENT") {
    return `${affiliation.course}, ${affiliation.yearLabel}, ${affiliation.institution}`;
  }
  return `${affiliation.position}, ${affiliation.unit}, ${affiliation.institution}`;
}

export type MembershipPrint = {
  name: string;
  designation: string;
  email: string;
  institution: string;
  kind: AffiliationKind;
};

/** Values a form such as F-29 binds for one protocol member. */
export function bindMembershipPrint(input: {
  name: string;
  email: string;
  affiliation: Affiliation;
}): MembershipPrint {
  return {
    name: input.name,
    designation: formatDesignation(input.affiliation),
    email: input.email,
    institution: input.affiliation.institution,
    kind: input.affiliation.kind,
  };
}
