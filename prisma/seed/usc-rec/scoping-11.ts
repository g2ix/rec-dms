import type { ScopingRule } from "../../../src/lib/intake/scoping";

/**
 * Scoping rules for version 11-01, as data. Each marks assessment points N/A from the proponent's
 * scoping answers; reviewers see "N/A (proponent: <reason>)" and can still comment. A rule holds
 * only when the proponent answered no (false), never when the question is unanswered.
 *
 * Only points whose own wording on the November 2026 Word files limits them to a case are listed
 * (REC answer, 12 Nov 2026: "stick to what's in the form"). F-35 2.10 also covers vulnerable
 * participants, low literacy and indigenous peoples, so no answer marks it N/A.
 * Stored in the `intake.scopingRules` setting; REC Staff can change it on /admin/settings.
 */

const no = (key: string) => ({ "===": [{ var: `scoping.${key}` }, false] });

export const SCOPING_RULES_11: ScopingRule[] = [
  // F-36 A.07: "In case of a Minor or incompetent participant, …"
  { id: "minors-icf", when: no("minors"), form: "F-36", codes: ["A.07"], reason: "no minors among the participants" },
  // F-36 A.17: "(For focus group discussions only)"
  { id: "focus-groups", when: no("focusGroups"), form: "F-36", codes: ["A.17"], reason: "no focus group discussions" },
  // F-36 A.25: "(For online or electronic consent only)"
  { id: "online-consent", when: no("onlineConsent"), form: "F-36", codes: ["A.25"], reason: "consent is not given online" },
  // F-36 B.02: "Where the study involves participants whose primary language is not English, …"
  { id: "translated-icf", when: no("nonEnglishIcf"), form: "F-36", codes: ["B.02"], reason: "every participant reads the English ICF" },
  // F-35 2.02: "For faculty-initiated research only"
  { id: "faculty-initiated", when: no("facultyInitiated"), form: "F-35", codes: ["2.02"], reason: "not a faculty-initiated study" },
  // F-35 3.01 note: "If No, indicate N/A for assessment points 3.02 to 3.10 as applicable."
  {
    id: "personal-data",
    when: no("personalData"),
    form: "F-35",
    codes: ["3.02", "3.03", "3.04", "3.05", "3.06", "3.07", "3.08", "3.09", "3.10"],
    reason: "no personal or sensitive data is collected",
  },
  // F-36 gateway: "If YES, proceed to all items below."
  {
    id: "no-consent",
    when: no("consentNeeded"),
    form: "F-36",
    allExcept: ["1", "1.NO"],
    reason: "informed consent is not sought ({waiverReason})",
  },
];
