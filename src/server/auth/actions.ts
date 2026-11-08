"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { AuditAction } from "@/lib/audit-log";
import { postSignInPath, SUSPENDED_SIGN_IN_MESSAGE } from "@/lib/auth-redirect";
import { env } from "@/lib/env";
import { normalizeEmail } from "@/lib/email";
import { codeSchema, emailOnlySchema, signInSchema, signUpSchema } from "@/lib/auth-schemas";
import { prisma } from "@/server/db";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { actionError, isNextRedirect, type ActionState } from "@/server/action-state";
import { assertBootstrapAdmin } from "@/server/auth/bootstrap";
import { issueEmailCode, verifyEmailCode } from "@/server/auth/codes";
import { writeLinkIntent } from "@/server/auth/link-intent";
import { removeSignInMethod, setContactEmail, setPassword, startEmailLink } from "@/server/auth/linking";
import { completeSelfMerge, confirmMergeStepUp, mergeAsAdmin } from "@/server/auth/merge";
import { assertPasswordAcceptable, hashPassword, verifyPassword } from "@/server/auth/passwords";
import { authenticatePassword, confirmRegistration, startRegistration } from "@/server/auth/register";
import { signIn, signOut } from "@/server/auth";
import { redirectToStartPage } from "@/server/auth/gate";
import { decidePendingUser, ensureVerifiedEmail } from "@/server/auth/users";
import { AppError } from "@/server/errors";
import { requireUser } from "@/server/session";
import { createProtocolForUser } from "@/server/protocols/affiliation";
import { affiliationFromForm, savePersonProfile } from "@/server/profiles/profile";

function optionalCount(value: FormDataEntryValue | null, label: string): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d+$/.test(text)) throw new AppError("INVALID", `Enter a whole number for ${label}.`, 400);
  return Number(text);
}

function afterSignIn(formData: FormData): string {
  return postSignInPath(String(formData.get("callbackUrl") ?? ""));
}

function isAuthErrorRedirect(value: unknown): value is string {
  return typeof value === "string" && authErrorPath(value).startsWith("/sign-in?") && authErrorPath(value).includes("error=");
}

function authErrorPath(value: string): string {
  if (value.startsWith("/")) return value;
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}`;
  } catch {
    return "/sign-in";
  }
}

export async function signOutAction() {
  await signOut({ redirectTo: "/sign-in" });
}

export async function signInWithGoogle(_prev: ActionState, formData: FormData): Promise<ActionState> {
  void _prev;
  try {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      return { ok: false, error: "Google sign-in is not configured." };
    }
    await signIn("google", { redirectTo: afterSignIn(formData) });
    return null;
  } catch (error) {
    return actionError(error, "Google sign-in did not complete.");
  }
}

export async function signInWithPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter your email and password." };
  }
  try {
    const landed = await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
      redirectTo: "/app",
    });
    if (isAuthErrorRedirect(landed)) redirect(authErrorPath(landed));
    const row = await prisma.userEmail.findUnique({
      where: { email: normalizeEmail(parsed.data.email) },
      select: { defaultView: true },
    });
    await redirectToStartPage(String(formData.get("callbackUrl") ?? ""), row?.defaultView ?? null);
    return null;
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    try {
      await authenticatePassword(parsed.data.email, parsed.data.password);
    } catch (inner) {
      const state = actionError(inner, SUSPENDED_SIGN_IN_MESSAGE);
      if (state?.error === SUSPENDED_SIGN_IN_MESSAGE) return state;
    }
    return { ok: false, error: "The email or password is not right, or this account cannot sign in." };
  }
}

export async function sendMagicLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const parsed = emailOnlySchema.parse({ email: formData.get("email") });
    await signIn("nodemailer", { email: parsed.email, redirectTo: afterSignIn(formData) });
    return null;
  } catch (error) {
    return actionError(error, "The sign-in link could not be sent.");
  }
}

export async function signUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const titleChoice = String(formData.get("title") ?? "");
    const suffixChoice = String(formData.get("suffix") ?? "");
    const parsed = signUpSchema.parse({
      firstName: formData.get("firstName"),
      middleName: formData.get("middleName") ?? "",
      familyName: formData.get("familyName"),
      title: titleChoice === "other" ? formData.get("titleOther") : titleChoice,
      suffix: suffixChoice === "other" ? formData.get("suffixOther") : suffixChoice,
      credentials: formData.get("credentials") ?? "",
      email: formData.get("email"),
      password: formData.get("password"),
    });
    const result = await startRegistration(parsed);
    redirect(`/verify?email=${encodeURIComponent(result.email)}`);
  } catch (error) {
    return actionError(error, "The account could not be created.");
  }
}

export async function verifyEmailAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const parsed = codeSchema.parse({ email: formData.get("email"), code: formData.get("code") });
    await confirmRegistration(parsed.email, parsed.code);
    redirect("/sign-in?verified=1");
  } catch (error) {
    return actionError(error, "That code could not be confirmed.");
  }
}

export async function linkGoogleAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  void _prev;
  void _formData;
  try {
    const user = await requireUser();
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      return { ok: false, error: "Google sign-in is not configured." };
    }
    await writeLinkIntent(user.id);
    await signIn("google", { redirectTo: "/app/account/sign-in-methods" });
    return null;
  } catch (error) {
    return actionError(error, "Google could not be linked.");
  }
}

export async function addEmailAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const parsed = emailOnlySchema.parse({ email: formData.get("email") });
    const result = await startEmailLink(user.id, parsed.email);
    if (result.mergeSessionId) redirect(`/app/account/merge/${result.mergeSessionId}`);
    await issueEmailCode({ email: parsed.email, purpose: "LINK_EMAIL", userId: user.id });
    redirect(`/app/account/sign-in-methods?pending=${encodeURIComponent(normalizeEmail(parsed.email))}`);
  } catch (error) {
    return actionError(error, "That email could not be added.");
  }
}

export async function confirmEmailAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const parsed = codeSchema.parse({ email: formData.get("email"), code: formData.get("code") });
    await verifyEmailCode({ email: parsed.email, purpose: "LINK_EMAIL", code: parsed.code });
    const meta = await auditRequestMeta();
    await prisma.$transaction(async (tx) => {
      const row = await ensureVerifiedEmail(user.id, parsed.email, tx);
      await audit.record(tx, {
        actorUserId: user.id,
        action: AuditAction.identityLinked,
        entityType: "user_email",
        entityId: row.id,
        diff: diffOf({}, { email: normalizeEmail(parsed.email) }),
        meta,
      });
    });
    redirect("/app/account/sign-in-methods");
  } catch (error) {
    return actionError(error, "That code could not be confirmed.");
  }
}

export async function setPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const password = String(formData.get("password") ?? "");
    const current = String(formData.get("currentPassword") ?? "");
    if (user.passwordHash) {
      const matches = current ? await verifyPassword(user.passwordHash, current) : false;
      if (!matches) return { ok: false, error: "The current password is not right." };
    }
    assertPasswordAcceptable(password, [user.firstName, user.familyName, user.email ?? ""]);
    await setPassword(user.id, await hashPassword(password));
    redirect("/app/account/sign-in-methods");
  } catch (error) {
    return actionError(error, "The password could not be saved.");
  }
}

export async function removeMethodAction(formData: FormData) {
  const user = await requireUser();
  const kind = String(formData.get("kind") ?? "");
  try {
    if (kind === "password") await removeSignInMethod(user.id, { kind: "password" });
    if (kind === "oauth") {
      await removeSignInMethod(user.id, { kind: "oauth", accountId: String(formData.get("accountId") ?? "") });
    }
    if (kind === "email") {
      await removeSignInMethod(user.id, { kind: "email", emailId: String(formData.get("emailId") ?? "") });
    }
  } catch (error) {
    const state = actionError(error, "That method could not be removed.");
    redirect(`/app/account/sign-in-methods?error=${encodeURIComponent(state?.error ?? "")}`);
  }
  redirect("/app/account/sign-in-methods");
}

export async function setContactAction(formData: FormData) {
  const user = await requireUser();
  try {
    await setContactEmail(user.id, String(formData.get("emailId") ?? ""));
  } catch (error) {
    const state = actionError(error, "The contact email could not be changed.");
    redirect(`/app/account/sign-in-methods?error=${encodeURIComponent(state?.error ?? "")}`);
  }
  redirect("/app/account/sign-in-methods");
}

export async function sendStepUpAction(formData: FormData) {
  const user = await requireUser();
  const sessionId = String(formData.get("sessionId") ?? "");
  const side = String(formData.get("side") ?? "");
  const session = await prisma.mergeSession.findUnique({ where: { id: sessionId } });
  if (!session || session.primaryUserId !== user.id) redirect("/app/account/sign-in-methods");
  const userId = side === "secondary" ? session.secondaryUserId : session.primaryUserId;
  const email = await prisma.userEmail.findFirst({
    where: { userId, verifiedAt: { not: null } },
    orderBy: { isContact: "desc" },
  });
  if (!email) redirect(`/app/account/merge/${sessionId}?error=missing-email`);
  await issueEmailCode({ email: email.email, purpose: "STEP_UP", userId });
  redirect(`/app/account/merge/${sessionId}?sent=${side}`);
}

export async function confirmStepUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const side = formData.get("side") === "secondary" ? "secondary" : "primary";
    await confirmMergeStepUp({
      sessionId: String(formData.get("sessionId") ?? ""),
      actorUserId: user.id,
      side,
      password: String(formData.get("password") ?? "") || undefined,
      code: String(formData.get("code") ?? "") || undefined,
      email: String(formData.get("email") ?? "") || undefined,
    });
    redirect(`/app/account/merge/${String(formData.get("sessionId") ?? "")}`);
  } catch (error) {
    return actionError(error, "That confirmation was not accepted.");
  }
}

export async function completeMergeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    await completeSelfMerge(user.id, String(formData.get("sessionId") ?? ""));
    redirect("/app/account/sign-in-methods?merged=1");
  } catch (error) {
    return actionError(error, "The accounts could not be merged.");
  }
}

export async function approveUserAction(formData: FormData) {
  const actor = await requireUser();
  await assertBootstrapAdmin(actor.id);
  const userId = String(formData.get("userId") ?? "");
  await decidePendingUser({ actorUserId: actor.id, userId, decision: "approve" });
  redirect("/admin/users/pending");
}

export async function rejectUserAction(formData: FormData) {
  const actor = await requireUser();
  await assertBootstrapAdmin(actor.id);
  const userId = String(formData.get("userId") ?? "");
  await decidePendingUser({ actorUserId: actor.id, userId, decision: "reject" });
  redirect("/admin/users/pending");
}

export async function adminMergeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await assertBootstrapAdmin(actor.id);
    const first = String(formData.get("firstUserId") ?? "");
    const second = String(formData.get("secondUserId") ?? "");
    const keep = String(formData.get("keep") ?? "first");
    const primaryUserId = keep === "second" ? second : first;
    const secondaryUserId = primaryUserId === first ? second : first;
    await mergeAsAdmin(actor.id, primaryUserId, secondaryUserId);
    redirect("/admin/users?merged=1");
  } catch (error) {
    return actionError(error, "The accounts could not be merged.");
  }
}

export async function createProtocolAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const resolved = await affiliationFromForm(formData);
    if (resolved.draft && formData.get("saveToProfile") === "yes") {
      await savePersonProfile(user.id, resolved.draft);
    }
    const title = z.string().trim().min(1, "Enter the protocol title.").max(300).parse(formData.get("title"));
    const disciplineId = z.string().uuid("Choose a discipline.").parse(formData.get("disciplineId"));
    const researchType = z.string().trim().min(1, "Enter the research type.").max(160).parse(formData.get("researchType"));
    const created = await createProtocolForUser(user.id, {
      title,
      affiliation: resolved.affiliation,
      disciplineId,
      institutionAddress: String(formData.get("institutionAddress") ?? ""),
      researchType,
      durationMonths: optionalCount(formData.get("durationMonths"), "duration"),
      expectedParticipants: optionalCount(formData.get("expectedParticipants"), "expected participants"),
      studySite: String(formData.get("studySite") ?? ""),
      fundingSources: formData
        .getAll("funding")
        .map((value) => String(value).trim())
        .filter(Boolean)
        .map((name) => ({ name })),
      contactNumber: String(formData.get("contactNumber") ?? "") || null,
    });
    redirect(`/app/protocols/${created.protocol.id}`);
  } catch (error) {
    return actionError(error, "The protocol could not be created.");
  }
}
