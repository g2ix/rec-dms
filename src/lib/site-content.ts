import { SUBMISSION_READY, SUBMISSION_STEPS } from "@/content/submission-checklist";
import { USC_CAMPUS_ADDRESS, USC_INSTITUTION_NAME } from "@/lib/profile";

const HOW_ID = "how";
const PREPARE_ID = "prepare";
const CONTACT_ID = "contact";

/**
 * Public site copy. REC Staff can change wording and links here.
 * The five review stages and the "Have these ready" list are the same
 * values the proponent dashboard reads from `submission-checklist`.
 */
export const siteContent = {
  meta: {
    title: "REC-DMS · University of San Carlos Research Ethics Committee",
    description:
      "Submit research for ethics review at the University of San Carlos, see each stage, and receive the Research Ethics Committee's decision in one place.",
  },
  brand: {
    name: "REC-DMS",
    unit: "Research Ethics Committee",
    homeLabel: "REC-DMS, Research Ethics Committee",
  },
  nav: [
    { label: "How review works", id: HOW_ID },
    { label: "Forms and guides", id: PREPARE_ID },
    { label: "Contact", id: CONTACT_ID },
  ],
  signIn: { label: "Sign in", href: "/sign-in" },
  hero: {
    institution: USC_INSTITUTION_NAME,
    title: "Research Ethics Committee",
    lead: "Submit your research for ethics review, see where it stands at every step, and receive the committee's decision in one place.",
    signIn: { label: "Sign in with your USC account", href: "/sign-in" },
    outside: "Researcher from outside USC?",
    create: { label: "Create an account", href: "/sign-up" },
  },
  sample: {
    code: "USC-REC-2026-0000",
    status: "Under review",
    title: "[Your protocol title]",
    caption: "Every protocol shows its stage, so you never have to ask the office where it is.",
    steps: [
      { name: "Submitted", detail: "Sent to the REC office.", state: "done" },
      { name: "Screening", detail: "REC Staff checked that it is complete.", state: "done" },
      { name: "Review", detail: "Reviewers are assessing it.", state: "current" },
      { name: "Decision", detail: "The Chair releases the decision here.", state: "later" },
    ],
  },
  audiences: {
    title: "Who uses it",
    columns: [
      {
        title: "Proponents",
        body: "You prepare the protocol, complete the REC forms, and follow it from submission until the committee decides.",
      },
      {
        title: "Reviewers",
        body: "You assess the protocols assigned to you and record comments on the review forms.",
      },
      {
        title: "REC Staff and the Chair",
        body: "Staff check that a submission is complete. The Chair directs the review and releases the decision.",
      },
    ],
  },
  how: {
    id: HOW_ID,
    title: "How a protocol moves through the REC",
    intro: "A protocol passes through these five stages. The stage it is in is shown on the protocol, from the first draft to the decision.",
    steps: SUBMISSION_STEPS,
  },
  prepare: {
    id: PREPARE_ID,
    title: "Before you submit",
    readyTitle: "Have these ready",
    ready: SUBMISSION_READY,
    guidesTitle: "Forms and guides",
    guides: [
      { label: "Submission guide", href: "/app/guide" },
      { label: "Research Protocol Application Form (F-27)", href: "/sign-in" },
      { label: "Data Privacy Consent Form (F-28)", href: "/sign-in" },
      { label: "Capsule Proposal (F-29)", href: "/sign-in" },
      { label: "Detailed Budget Sheet (F-30)", href: "/sign-in" },
    ],
  },
  contact: {
    id: CONTACT_ID,
    title: "The REC office",
    rows: [
      {
        term: "Office",
        detail: `Research Ethics Committee, ${USC_CAMPUS_ADDRESS}\n(032) 4012300 local 204`,
      },
      { term: "Email", detail: "rec@usc.edu.ph", href: "mailto:rec@usc.edu.ph" },
      { term: "Office hours", detail: "Monday to Friday, 8:00 AM to 5:00 PM" },
    ],
  },
  footer: {
    name: `${USC_INSTITUTION_NAME} Research Ethics Committee`,
    links: [
      { label: "Privacy notice", href: "/privacy" },
      { label: "Data Privacy Act consent", href: "/data-privacy-consent" },
    ],
    rightsName: USC_INSTITUTION_NAME,
  },
  notices: {
    privacy: {
      title: "Privacy notice",
      description: "How REC-DMS handles personal data for ethics review at the University of San Carlos.",
      paragraphs: [
        "REC-DMS keeps the account and protocol information the Research Ethics Committee needs to review research at the University of San Carlos.",
        "A protocol is visible to its proponents, the adviser on that protocol, assigned reviewers, the panel chair, the REC Chair, and REC Staff.",
        "After you sign in, you can download your own profile, email addresses, memberships, and signature list. A request to delete a closed protocol goes to REC Staff. Records are kept for three years after closure, unless the committee sets another period.",
        "Questions about your data can be sent to the REC office at rec@usc.edu.ph.",
      ],
    },
    consent: {
      title: "Data Privacy Act consent",
      description: "Where proponents record Data Privacy Act consent for a USC REC protocol.",
      paragraphs: [
        "Consent under the Data Privacy Act of 2012 (RA 10173) is recorded on Form F-28, Data Privacy Consent Form.",
        "Every proponent signs F-28 inside the protocol before it is submitted. The signed form is kept with that protocol.",
      ],
      action: { label: "Sign in to open your protocol", href: "/sign-in" },
    },
  },
} as const;

export type SampleStepState = (typeof siteContent.sample.steps)[number]["state"];
