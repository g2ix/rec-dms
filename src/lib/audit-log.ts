export const AuditAction = {
  signIn: "auth.sign_in",
  signOut: "auth.sign_out",
  signInFailed: "auth.sign_in_failed",
  signUpStarted: "auth.sign_up_started",
  emailVerified: "auth.email_verified",
  identityLinked: "auth.identity_linked",
  identityUnlinked: "auth.identity_unlinked",
  emailRemoved: "auth.email_removed",
  passwordSet: "auth.password_set",
  passwordRemoved: "auth.password_removed",
  contactEmailSet: "auth.contact_email_set",
  userApproved: "user.approved",
  userRejected: "user.rejected",
  userSuspended: "user.suspended",
  userMerged: "user.merged",
  roleGranted: "user.role_granted",
  roleRevoked: "user.role_revoked",
  permissionChanged: "role.permission_changed",
  settingChanged: "setting.changed",
  fieldSaved: "form.field_saved",
  formSigned: "form.signed",
  signatureVoided: "form.signature_voided",
  signatureSaved: "signature.saved",
  definitionCreated: "form.definition_created",
  definitionUpdated: "form.definition_updated",
  definitionPublished: "form.definition_published",
  definitionRetired: "form.definition_retired",
  versionCreated: "form.version_created",
  markedComplete: "form.marked_complete",
  reopened: "form.reopened",
  protocolCreated: "protocol.created",
  protocolUpdated: "protocol.updated",
  memberInvited: "protocol.member_invited",
  memberAccepted: "protocol.member_accepted",
  inviteBound: "protocol.invite_bound",
  memberRemoved: "protocol.member_removed",
  leadershipTransferred: "protocol.leadership_transferred",
  rosterReordered: "protocol.roster_reordered",
  panelChanged: "protocol.panel_changed",
  fileUploaded: "protocol.file_uploaded",
  fileDownloaded: "protocol.file_downloaded",
  versionSubmitted: "protocol.version_submitted",
  revisionStarted: "protocol.revision_started",
  feeVerified: "protocol.fee_verified",
  feeRejected: "protocol.fee_rejected",
  instanceStarted: "workflow.instance_started",
  stepEntered: "workflow.step_entered",
  instanceCompleted: "workflow.instance_completed",
  instanceCancelled: "workflow.instance_cancelled",
  taskCompleted: "task.completed",
  taskClaimed: "task.claimed",
  taskReassigned: "task.reassigned",
  workflowPublished: "workflow.published",
  workflowSaved: "workflow.saved",
  holidaySaved: "holiday.saved",
} as const;

const LABELS: Record<string, string> = {
  [AuditAction.signIn]: "Signed in",
  [AuditAction.signOut]: "Signed out",
  [AuditAction.signInFailed]: "Sign-in failed",
  [AuditAction.signUpStarted]: "Sign-up started",
  [AuditAction.emailVerified]: "Email verified",
  [AuditAction.identityLinked]: "Sign-in method linked",
  [AuditAction.identityUnlinked]: "Sign-in method removed",
  [AuditAction.emailRemoved]: "Email removed",
  [AuditAction.passwordSet]: "Password set",
  [AuditAction.passwordRemoved]: "Password removed",
  [AuditAction.contactEmailSet]: "Contact email changed",
  [AuditAction.userApproved]: "User approved",
  [AuditAction.userRejected]: "User rejected",
  [AuditAction.userSuspended]: "User suspended",
  [AuditAction.userMerged]: "Accounts merged",
  [AuditAction.roleGranted]: "Role granted",
  [AuditAction.roleRevoked]: "Role revoked",
  [AuditAction.permissionChanged]: "Role permissions changed",
  [AuditAction.settingChanged]: "Setting changed",
  [AuditAction.fieldSaved]: "Form field saved",
  [AuditAction.formSigned]: "Form signed",
  [AuditAction.signatureVoided]: "Signature voided",
  [AuditAction.signatureSaved]: "Signature saved",
  [AuditAction.definitionCreated]: "Form definition created",
  [AuditAction.definitionUpdated]: "Form definition updated",
  [AuditAction.definitionPublished]: "Form definition published",
  [AuditAction.definitionRetired]: "Form definition retired",
  [AuditAction.versionCreated]: "Form version created",
  [AuditAction.markedComplete]: "Form marked complete",
  [AuditAction.reopened]: "Form reopened",
  [AuditAction.protocolCreated]: "Protocol created",
  [AuditAction.protocolUpdated]: "Shared details saved",
  [AuditAction.memberInvited]: "Member invited",
  [AuditAction.memberAccepted]: "Invitation accepted",
  [AuditAction.inviteBound]: "Invitation linked to an account",
  [AuditAction.memberRemoved]: "Member removed",
  [AuditAction.leadershipTransferred]: "Leadership transferred",
  [AuditAction.rosterReordered]: "Roster reordered",
  [AuditAction.panelChanged]: "Panel changed",
  [AuditAction.fileUploaded]: "File uploaded",
  [AuditAction.fileDownloaded]: "File downloaded",
  [AuditAction.versionSubmitted]: "Version submitted",
  [AuditAction.revisionStarted]: "Revision started",
  [AuditAction.feeVerified]: "Fee receipt verified",
  [AuditAction.feeRejected]: "Fee receipt rejected",
  [AuditAction.instanceStarted]: "Workflow started",
  [AuditAction.stepEntered]: "Step opened",
  [AuditAction.instanceCompleted]: "Workflow completed",
  [AuditAction.instanceCancelled]: "Workflow cancelled",
  [AuditAction.taskCompleted]: "Task completed",
  [AuditAction.taskClaimed]: "Task claimed",
  [AuditAction.taskReassigned]: "Task reassigned",
  [AuditAction.workflowPublished]: "Workflow published",
  [AuditAction.workflowSaved]: "Workflow draft saved",
  [AuditAction.holidaySaved]: "Holiday saved",
};

const INTERNAL_PREFIXES = ["auth.", "user.", "role.", "setting."];

export function auditActionLabel(action: string): string {
  return LABELS[action] ?? action;
}

export function isInternalAuditAction(action: string): boolean {
  return INTERNAL_PREFIXES.some((prefix) => action.startsWith(prefix));
}

export function formatSeq(seq: bigint | number): string {
  const text = typeof seq === "bigint" ? seq.toString() : String(seq);
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function chainStatusLabel(
  result: { ok: true; seq: bigint | null } | { ok: false; seq: bigint },
  timeLabel: string,
): { tone: "success" | "danger"; label: string } {
  if (!result.ok) {
    return { tone: "danger", label: `Chain broken at #${formatSeq(result.seq)}` };
  }
  const seq = result.seq === null ? "0" : formatSeq(result.seq);
  return { tone: "success", label: `Chain verified up to #${seq} at ${timeLabel}` };
}

export function changedFields(diff: unknown): string {
  if (!diff || typeof diff !== "object" || Array.isArray(diff)) return "";
  return Object.keys(diff).join(", ");
}
