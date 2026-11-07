export type NoticeChannel = "IN_APP" | "EMAIL";

export type NoticeTemplate = {
  key: string;
  subject: string;
  bodyMarkdown: string;
  channels: NoticeChannel[];
  description: string;
  variables: string[];
};

/** Reminders can wait for the daily digest. Assignments and decisions cannot. */
const DIGESTABLE = new Set(["task.due_soon", "task.due", "protocol.revision_due_soon", "review.submitted"]);

export function prefersDigest(templateKey: string, digest: "IMMEDIATE" | "DAILY"): boolean {
  return digest === "DAILY" && DIGESTABLE.has(templateKey);
}

export const SAMPLE_VARIABLES: Record<string, string> = {
  recipientName: "Juan D. Cruz",
  protocolCode: "USC-REC-2026-0001",
  protocolTitle: "Classroom study of study habits",
  taskName: "Assess the protocol",
  stepName: "Assess the protocol",
  dueAt: "10 Nov 2026, 5:00 PM",
  link: "https://rec.example.edu/app/tasks",
  reason: "The receipt image is unreadable.",
  decision: "Minor modifications",
  roleLabel: "an adviser",
  daysLeft: "5",
};

export const TEMPLATES: NoticeTemplate[] = [
  {
    key: "task.assigned",
    subject: "Task assigned: {{taskName}}",
    bodyMarkdown: "{{recipientName}}, you have a task on {{protocolCode}} — {{protocolTitle}}.\n\n**{{taskName}}** is due {{dueAt}}.\n\n[Open the task]({{link}})",
    channels: ["IN_APP", "EMAIL"],
    description: "Sent when a workflow task is assigned.",
    variables: ["recipientName", "protocolCode", "protocolTitle", "taskName", "dueAt", "link"],
  },
  {
    key: "task.due_soon",
    subject: "Due soon: {{taskName}}",
    bodyMarkdown: "{{taskName}} on {{protocolCode}} — {{protocolTitle}} is due {{dueAt}}.\n\n[Open the task]({{link}})",
    channels: ["IN_APP", "EMAIL"],
    description: "Sent once for each reminder offset before a task is due.",
    variables: ["recipientName", "protocolCode", "protocolTitle", "taskName", "dueAt", "link"],
  },
  {
    key: "task.overdue",
    subject: "Overdue: {{taskName}}",
    bodyMarkdown: "{{taskName}} on {{protocolCode}} — {{protocolTitle}} was due {{dueAt}} and is still open.\n\n[Open the task]({{link}})",
    channels: ["IN_APP", "EMAIL"],
    description: "Sent once when a task reaches its due time and is still open.",
    variables: ["recipientName", "protocolCode", "protocolTitle", "taskName", "dueAt", "link"],
  },
  {
    key: "task.escalated",
    subject: "Escalated: {{taskName}}",
    bodyMarkdown: "{{taskName}} on {{protocolCode}} — {{protocolTitle}} is overdue (due {{dueAt}}) and was escalated to you.\n\n[Open the protocol]({{link}})",
    channels: ["IN_APP", "EMAIL"],
    description: "Sent once to the step's escalation target after a task is overdue.",
    variables: ["recipientName", "protocolCode", "protocolTitle", "taskName", "dueAt", "link"],
  },
  {
    key: "task.reassigned",
    subject: "Task reassigned to you: {{taskName}}",
    bodyMarkdown: "{{taskName}} on {{protocolCode}} — {{protocolTitle}} is now assigned to you. It is due {{dueAt}}.\n\n[Open the task]({{link}})",
    channels: ["IN_APP", "EMAIL"],
    description: "Sent when REC Staff reassigns an open task.",
    variables: ["recipientName", "protocolCode", "protocolTitle", "taskName", "dueAt", "link"],
  },
  {
    key: "protocol.returned_incomplete",
    subject: "Submission returned: {{protocolTitle}}",
    bodyMarkdown: "{{protocolCode}} — {{protocolTitle}} was returned as incomplete. Update it and submit again.\n\n[Open the protocol]({{link}})",
    channels: ["IN_APP", "EMAIL"],
    description: "Sent to the project leader when screening returns a submission.",
    variables: ["recipientName", "protocolCode", "protocolTitle", "link"],
  },
  {
    key: "protocol.decision_released",
    subject: "Decision released: {{protocolTitle}}",
    bodyMarkdown: "The decision on {{protocolCode}} — {{protocolTitle}} has been released.\n\n{{decision}}\n\n[Open the protocol]({{link}})",
    channels: ["IN_APP", "EMAIL"],
    description: "Sent when staff release a decision.",
    variables: ["recipientName", "protocolCode", "protocolTitle", "decision", "link"],
  },
  {
    key: "protocol.revision_due_soon",
    subject: "Revision due in {{daysLeft}} working days",
    bodyMarkdown: "The revision of {{protocolCode}} — {{protocolTitle}} is due {{dueAt}} ({{daysLeft}} working days left).\n\n[Open the protocol]({{link}})",
    channels: ["IN_APP", "EMAIL"],
    description: "Sent 5 working days and 1 working day before a revision deadline.",
    variables: ["recipientName", "protocolCode", "protocolTitle", "dueAt", "daysLeft", "link"],
  },
  {
    key: "protocol.lapsed",
    subject: "Revision deadline passed: {{protocolTitle}}",
    bodyMarkdown: "The revision deadline for {{protocolCode}} — {{protocolTitle}} passed on {{dueAt}}. The protocol has lapsed and must be reapplied under the same protocol code.\n\n[Open the protocol]({{link}})",
    channels: ["IN_APP", "EMAIL"],
    description: "Sent when a revision wait reaches its due time.",
    variables: ["recipientName", "protocolCode", "protocolTitle", "dueAt", "link"],
  },
  {
    key: "invite.member",
    subject: "Invitation to {{protocolTitle}}",
    bodyMarkdown: "You are invited to “{{protocolTitle}}” as {{roleLabel}}.\n\n[Respond to the invitation]({{link}})",
    channels: ["IN_APP", "EMAIL"],
    description: "Sent when a project leader invites a proponent or an adviser.",
    variables: ["recipientName", "protocolTitle", "roleLabel", "link"],
  },
  {
    key: "account.approved",
    subject: "Your REC-DMS account is approved",
    bodyMarkdown: "{{recipientName}}, REC Staff approved your account. You can sign in and continue.\n\n[Open REC-DMS]({{link}})",
    channels: ["IN_APP", "EMAIL"],
    description: "Sent when a pending account is approved.",
    variables: ["recipientName", "link"],
  },
  {
    key: "signature.voided",
    subject: "Signature void on {{protocolTitle}}",
    bodyMarkdown: "A form you signed was edited. Your signature is void and needs to be signed again.\n\n[Open the protocol]({{link}})",
    channels: ["IN_APP", "EMAIL"],
    description: "Sent to each signer when a signed form changes.",
    variables: ["recipientName", "protocolTitle", "protocolCode", "link"],
  },
  {
    key: "fee.rejected",
    subject: "Fee receipt rejected: {{protocolTitle}}",
    bodyMarkdown: "The fee receipt for {{protocolCode}} — {{protocolTitle}} was rejected.\n\n{{reason}}\n\n[Open the protocol]({{link}})",
    channels: ["IN_APP", "EMAIL"],
    description: "Sent to the project leader when REC Staff reject a fee receipt.",
    variables: ["recipientName", "protocolCode", "protocolTitle", "reason", "link"],
  },
  {
    key: "exemption.not_qualified",
    subject: "Not qualified for exemption: {{protocolTitle}}",
    bodyMarkdown: "{{protocolCode}} — {{protocolTitle}} was not qualified for exemption and was returned to the project leader.\n\n[Open the protocol]({{link}})",
    channels: ["IN_APP", "EMAIL"],
    description: "Sent when an exemption check is not qualified. REC Staff are copied from the step.",
    variables: ["recipientName", "protocolCode", "protocolTitle", "link"],
  },
  {
    key: "review.submitted",
    subject: "Review submitted: {{protocolTitle}}",
    bodyMarkdown: "A review was submitted for {{protocolCode}} — {{protocolTitle}}.\n\n[Open the protocol]({{link}})",
    channels: ["IN_APP", "EMAIL"],
    description: "Sent when a reviewer finishes, including the people copied on that step.",
    variables: ["recipientName", "protocolCode", "protocolTitle", "link"],
  },
  {
    key: "file.infected",
    subject: "File blocked: {{protocolTitle}}",
    bodyMarkdown: "A file on {{protocolCode}} — {{protocolTitle}} was blocked because the virus scan found a threat ({{reason}}). It has been removed from storage and cannot be downloaded or submitted.\n\n[Open the protocol]({{link}})",
    channels: ["IN_APP", "EMAIL"],
    description: "Sent to the uploader and REC Staff when a scan marks a file infected.",
    variables: ["recipientName", "protocolCode", "protocolTitle", "reason", "link"],
  },
  {
    key: "scan.unavailable",
    subject: "Virus scanner unreachable",
    bodyMarkdown: "The virus scanner has been unreachable for 24 hours. Files stay “Scan pending” until it returns. REC Staff can still download them, with a warning.\n\n[Open REC-DMS]({{link}})",
    channels: ["IN_APP", "EMAIL"],
    description: "Sent to system administrators when ClamAV cannot be reached for a day.",
    variables: ["recipientName", "link"],
  },
  {
    key: "retention.flagged",
    subject: "Protocols ready for retention review",
    bodyMarkdown: "{{reason}} closed protocol(s) are older than the retention period and are waiting for REC Staff to archive or delete them. Nothing is deleted automatically.\n\n[Open the list]({{link}})",
    channels: ["IN_APP", "EMAIL"],
    description: "Sent when the weekly retention job flags closed protocols.",
    variables: ["recipientName", "reason", "link"],
  },
  {
    key: "audit.chain_broken",
    subject: "Audit chain broken",
    bodyMarkdown: "The nightly audit check failed at event {{reason}}. Review the audit log.\n\n[Open the audit log]({{link}})",
    channels: ["IN_APP", "EMAIL"],
    description: "Sent to system administrators when the nightly hash-chain check fails.",
    variables: ["recipientName", "reason", "link"],
  },
];

export function templateByKey(key: string): NoticeTemplate | undefined {
  return TEMPLATES.find((template) => template.key === key);
}

export function fallbackTemplate(key: string): NoticeTemplate {
  return (
    templateByKey(key) ?? {
      key,
      subject: key,
      bodyMarkdown: "{{protocolCode}} — {{protocolTitle}}\n\n{{taskName}}\n\n[Open]({{link}})",
      channels: ["IN_APP", "EMAIL"],
      description: "",
      variables: ["protocolCode", "protocolTitle", "taskName", "link"],
    }
  );
}
