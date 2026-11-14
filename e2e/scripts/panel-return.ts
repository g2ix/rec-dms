/**
 * INTAKE-04 e2e fixture: takes a new protocol on the November process through review with two
 * flagged points, the Panel Chair's endorsement of F-37, and its release by REC Staff, using the
 * app's own workflow code (the same steps the database tests take). Prints the ids the browser
 * test needs as one JSON line.
 *
 * Run by e2e/revision.spec.ts with the test environment only (DATABASE_URL on recdms_test):
 *   node --conditions=react-server --experimental-transform-types --import ./scripts/register-ts.mjs e2e/scripts/panel-return.ts <suffix>
 */
import { hash } from "@node-rs/argon2";
import { prisma } from "@/server/db";
import { generateDecisionDocuments } from "@/server/docs/generate";
import { decideBill } from "@/server/fees/bills";
import { createProtocolForUser } from "@/server/protocols/affiliation";
import { putObject } from "@/server/storage";
import { testDatabaseRefusal } from "@/server/test/test-database";
import { fillIntake, finish, formOn, grant, writeForm } from "@/server/test/usc-cycle";
import { startInstance } from "@/server/workflow/engine";

const LEADER = ["PROPONENT", "PROJECT_LEADER"];
const STAFF = ["REC_STAFF"];
const CHAIR = ["PANEL_CHAIR"];
const REVIEWER = ["REVIEWER"];
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

async function person(email: string, firstName: string, familyName: string, password: string | null) {
  const verifiedAt = new Date();
  const user = await prisma.user.create({
    data: {
      firstName,
      familyName,
      displayName: `${firstName} ${familyName}`,
      name: `${firstName} ${familyName}`,
      email,
      emailVerified: verifiedAt,
      status: "ACTIVE",
      approvedAt: verifiedAt,
      passwordHash: password ? await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }) : null,
      emails: { create: { email, verifiedAt, isContact: true, isPrimary: true } },
    },
    include: { emails: true },
  });
  await prisma.user.update({ where: { id: user.id }, data: { primaryEmailId: user.emails[0]?.id } });
  await prisma.signature.create({ data: { userId: user.id, imageKey: `signatures/e2e/${user.id}.png`, method: "UPLOADED", active: true } });
  return user;
}

async function uploadPdf(versionId: string, protocolId: string, userId: string, kind: "MANUSCRIPT" | "COVER_LETTER") {
  const storageKey = `protocols/${protocolId}/versions/${versionId}/${kind.toLowerCase()}/${crypto.randomUUID()}`;
  await putObject(storageKey, PDF, "application/pdf");
  await prisma.storedFile.create({
    data: { protocolVersionId: versionId, kind, originalName: `${kind.toLowerCase()}.pdf`, storageKey, mime: "application/pdf", size: PDF.length, sha256: "e2e", uploadedById: userId, scanStatus: "CLEAN" },
  });
}

/** Keep the "Needs action" flag on the first `count` flagged rows of a table only. */
async function flagOnly(versionId: string, code: string, field: string, count: number) {
  const form = await formOn(versionId, code);
  const data = { ...(form.data as Record<string, Record<string, Record<string, unknown>>>) };
  let left = count;
  const table = { ...(data[field] ?? {}) };
  for (const [rowId, cells] of Object.entries(table)) {
    const flag = left > 0 && cells.needs_action === true;
    if (flag) left -= 1;
    table[rowId] = { ...cells, needs_action: flag };
  }
  data[field] = table;
  for (const other of Object.keys(data)) {
    if (other === field || typeof data[other] !== "object" || !data[other]) continue;
    for (const [rowId, cells] of Object.entries(data[other])) {
      if (cells && typeof cells === "object" && "needs_action" in cells) data[other][rowId] = { ...cells, needs_action: false };
    }
  }
  await prisma.formInstance.update({ where: { id: form.id }, data: { data: data as never } });
}

async function main() {
  const refusal = testDatabaseRefusal(process.env.DATABASE_URL);
  if (refusal) throw new Error(`Refusing to write fixtures: ${refusal}`);
  const suffix = process.argv[2] ?? crypto.randomUUID().slice(0, 6);
  const password = "Usc-ethics-review-2026-revision";
  const leader = await person(`e2e.rev.leader.${suffix}@usc.edu.ph`, "Rhea", `Leader${suffix}`, password);
  const adviser = await person(`e2e.rev.adviser.${suffix}@usc.edu.ph`, "Arturo", `Adviser${suffix}`, password);
  const staff = await person(`e2e.rev.staff.${suffix}@usc.edu.ph`, "Sol", "Staff", null);
  const chair = await person(`e2e.rev.chair.${suffix}@usc.edu.ph`, "Carmen", "Chair", null);
  const scientist = await person(`e2e.rev.sci.${suffix}@usc.edu.ph`, "Simeon", `SecretScientist${suffix}`, null);
  const layperson = await person(`e2e.rev.lay.${suffix}@usc.edu.ph`, "Lara", `SecretLayperson${suffix}`, null);
  const panel = await prisma.panel.create({ data: { code: `E${suffix}`, name: `E2E panel ${suffix}` } });
  await grant(staff.id, "REC_STAFF");
  await grant(chair.id, "PANEL_CHAIR", panel.id, { isScientist: true, designation: "Chair" });
  await grant(scientist.id, "PANEL_MEMBER", panel.id, { isScientist: true, designation: "Scientist" });
  await grant(layperson.id, "PANEL_MEMBER", panel.id, { isScientist: false, designation: "Non-scientist" });

  const created = await createProtocolForUser(leader.id, {
    title: `E2E returned for revision ${suffix}`,
    researchType: "Basic",
    affiliation: { kind: "STUDENT", course: "BS Biology", yearLabel: "4th year", institution: "University of San Carlos", contactEmailId: leader.emails[0]!.id },
  });
  const protocolId = created.protocol.id;
  const versionId = created.version.id;
  await prisma.protocol.update({ where: { id: protocolId }, data: { panelId: panel.id, clientTypeKey: "USC_SHS_UNDERGRADUATE" } });
  await prisma.protocolMember.create({ data: { protocolId, userId: adviser.id, role: "ADVISER", status: "ACTIVE", rosterOrder: 9 } });
  const instance = await prisma.workflowInstance.findFirst({ where: { protocolId, status: "RUNNING" } });
  const instanceId = instance?.id ?? (await startInstance("INITIAL_SUBMISSION", protocolId, versionId, leader.id)).id;
  const run = { protocolId, versionId, instanceId };

  await fillIntake(protocolId, versionId);
  for (const code of ["F-27", "F-28", "F-30", "F-35", "F-36"]) await writeForm({ ...run, code, stepKey: "proponent_submit", roles: LEADER, userId: leader.id });
  await uploadPdf(versionId, protocolId, leader.id, "MANUSCRIPT");
  await uploadPdf(versionId, protocolId, leader.id, "COVER_LETTER");
  await finish(instanceId, "proponent_submit", leader.id);
  await finish(instanceId, "adviser_check", adviser.id, { outcome: "FORWARD" });
  await writeForm({ ...run, code: "F-26", stepKey: "staff_screening", roles: STAFF, userId: staff.id, overrides: { submission_type: "INITIAL" } });
  await finish(instanceId, "staff_screening", staff.id, { outcome: "ACCEPT" });
  await writeForm({ ...run, code: "F-31", stepKey: "determine_review", roles: CHAIR, userId: chair.id, overrides: { exempt: "NO", review_type: "EXPEDITED", submission_type: "INITIAL" } });
  await finish(instanceId, "determine_review", chair.id, { outcome: "EXPEDITED", reviewerSlots: { SCIENTIST: scientist.id, NON_SCIENTIST: layperson.id }, reviewDueDate: "2027-01-20" });
  for (const reviewer of [scientist, layperson]) await finish(instanceId, "reviewer_accept", reviewer.id, { outcome: "ACCEPT" });
  for (const [reviewer, code] of [
    [scientist, "F-35"],
    [layperson, "F-36"],
  ] as const) {
    const member = await prisma.protocolMember.findFirstOrThrow({ where: { protocolId, userId: reviewer.id, status: "ACTIVE" } });
    await writeForm({ ...run, code, stepKey: "reviewer_assess", roles: REVIEWER, userId: reviewer.id, memberId: member.id, overrides: { recommended_action: "MINOR", reviewer_name: reviewer.displayName } });
    await finish(instanceId, "reviewer_assess", reviewer.id);
  }
  // The chair keeps two points of the protocol part flagged.
  await flagOnly(versionId, "F-37", "praf", 2);
  await writeForm({ ...run, code: "F-37", stepKey: "chair_review", roles: CHAIR, userId: chair.id, overrides: { recommended_action: "MINOR", icf_action: "MINOR" } });
  await finish(instanceId, "chair_review", chair.id, { outcome: "MINOR" });
  await writeForm({ ...run, code: "F-37", stepKey: "staff_sign_summary", roles: STAFF, userId: staff.id });
  await finish(instanceId, "staff_sign_summary", staff.id);
  await writeForm({ ...run, code: "F-37", stepKey: "chair_sign_decision", roles: CHAIR, userId: chair.id });
  await writeForm({ ...run, code: "F-39", stepKey: "chair_sign_decision", roles: CHAIR, userId: chair.id, overrides: { decision: "MINOR" } });
  await finish(instanceId, "chair_sign_decision", chair.id);
  const bill = await prisma.bill.findFirst({ where: { protocolId, round: 1 } });
  if (bill) await decideBill({ billId: bill.id, actorUserId: staff.id, decision: "VERIFIED" });
  await finish(instanceId, "staff_release", staff.id, { outcome: "RELEASE" });
  const jobs = await prisma.job.findMany({ where: { kind: "GENERATE_DOCUMENTS", doneAt: null, payload: { path: ["instanceId"], equals: instanceId } } });
  for (const job of jobs) {
    await generateDecisionDocuments(job.payload);
    await prisma.job.update({ where: { id: job.id }, data: { doneAt: new Date() } });
  }
  const f35 = await formOn(versionId, "F-35");
  const f37 = await formOn(versionId, "F-37");
  console.log(
    JSON.stringify({
      protocolId,
      f35: f35.id,
      f37: f37.id,
      leader: leader.emails[0]!.email,
      adviser: adviser.emails[0]!.email,
      adviserId: adviser.id,
      password,
      secretNames: [scientist.displayName, layperson.displayName],
    }),
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
