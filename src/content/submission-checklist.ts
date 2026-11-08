/**
 * What a proponent should have before starting a protocol.
 * REC Staff can edit this list. The dashboard and the submission guide both read it.
 */
export const SUBMISSION_READY = [
  "Your full research proposal",
  "Informed consent and assent forms",
  "Questionnaires, interview guides or other instruments",
  "Names and emails of your co-proponents and adviser",
] as const;

export const SUBMISSION_GUIDE_HREF = "/app/guide";

export const SUBMISSION_STEPS = [
  { name: "Prepare", detail: "Fill in the forms and attach your documents." },
  { name: "Submit", detail: "Sign and send it to the REC office." },
  { name: "Screening", detail: "REC Staff check that it is complete." },
  { name: "Review", detail: "Reviewers assess it and may ask for revisions." },
  { name: "Decision", detail: "The Chair releases the decision to you." },
] as const;
