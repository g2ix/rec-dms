/** Official wording from the USC REC Word files in docs/forms/2026-11/. Do not paraphrase. */

/** The official F-27 declarations, word for word from the Word file. */
export const F27_DECLARATIONS = [
  "I am aware of the ethical aspects of this research project.",
  "I hereby grant my express consent to USC REC, its officer/s, its member/s, independent consultant/s, and all person/s involved in the conduct of the review of my/our protocol and anything related to it, such as but not limited to: collection, use, share, storage, protection, and access of all types of personal information.",
  "I commit and submit the Continuing Review Approval Form on an annual basis to the University of San Carlos Research Ethics Committee (USC REC).",
  "I will ensure that changes in approved research protocols are reported promptly and are not initiated without approval by the USC REC, except when necessary to eliminate apparent immediate hazards to the participant(s).",
  "I will ensure that all adverse or unforeseen problems arising from the research project are reported in a timely fashion to the USC REC.",
  "I will provide notification when the study is complete and if it fails to start or is abandoned.",
] as const;

export const F27_COI = {
  NONE: "I hereby declare that I have no actual or potential conflict of interest in this protocol",
  SPECIFY: "I hereby declare that I have either an actual or potential conflict of interest in this protocol, please specify the COI here:",
} as const;

/** The two F-28 consents, word for word from the Word file. */
export const F28_CONSENTS = [
  "I/we have fully read this form, fully understood all its contents, and hereby give my/our full and express consent to the collection, processing, and/or storage of my/our personal information/data.",
  "I/we fully understand that I/we have data privacy rights which include the following: right to be informed, right to access, right to object, right to erasure or blocking, right to damages, right to file a complaint, right to rectify, and right to data portability.",
] as const;
