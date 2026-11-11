import "server-only";
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { AuditAction } from "@/lib/audit-log";
import { formatCentavos } from "@/lib/forms/money";
import { formatManila } from "@/lib/time";
import { audit, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { settingValue } from "@/server/effective";
import { putObject } from "@/server/storage";

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

/** Wraps plain text to a width in points for one font size. */
function wrap(value: string, width: number, measure: (line: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** Plain WinAnsi text: pdf-lib standard fonts cannot draw characters outside it. */
function ascii(value: string): string {
  return value.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E\n -ÿ]/g, "?");
}

/**
 * Statement of account for one bill. The title, payment instructions, and certification line
 * are the settings `fees.statementTitle`, `fees.paymentInstructions`, and `fees.certifiedLabel`.
 */
export async function generateStatement(billId: string): Promise<void> {
  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    include: {
      protocol: {
        include: {
          members: { where: { role: "PROPONENT", status: "ACTIVE" }, orderBy: { rosterOrder: "asc" }, include: { user: true } },
        },
      },
    },
  });
  if (!bill || bill.statementFileId) return;
  const [title, instructions, certified] = await Promise.all([
    settingValue(prisma, "fees.statementTitle"),
    settingValue(prisma, "fees.paymentInstructions"),
    settingValue(prisma, "fees.certifiedLabel"),
  ]);
  const issuer = bill.issuedById ? await prisma.user.findUnique({ where: { id: bill.issuedById }, select: { displayName: true } }) : null;
  const leader = bill.protocol.members.find((member) => member.isLeader) ?? bill.protocol.members[0];
  const names = bill.protocol.members.map((member) => member.user?.displayName).filter(Boolean).join(", ");
  const department = [leader?.departmentName, leader?.schoolName, leader?.programName].filter(Boolean).join(", ");

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  let y = 780;
  const left = 64;
  const width = 595 - left * 2;
  const draw = (value: string, size = 11, face = font) => {
    for (const line of wrap(ascii(value), width, (candidate) => face.widthOfTextAtSize(candidate, size))) {
      page.drawText(line, { x: left, y, size, font: face, color: rgb(0, 0, 0) });
      y -= size + 5;
    }
  };
  draw(text(title, "Statement of Account"), 16, bold);
  y -= 8;
  draw(`Date: ${formatManila(bill.issuedAt, "d MMMM yyyy")}`);
  draw(`Name: ${names || "-"}`);
  if (department) draw(`Department: ${department}`);
  y -= 6;
  draw("Description", 11, bold);
  draw(bill.description);
  y -= 6;
  draw(`Amount: PHP ${formatCentavos(bill.amount).replace(/[^\d.,-]/g, "")}`, 12, bold);
  y -= 10;
  const pay = text(instructions, "");
  if (pay) {
    draw("Payment instructions", 11, bold);
    draw(pay);
    y -= 10;
  }
  draw(text(certified, "Certified correct:"));
  y -= 18;
  draw(issuer?.displayName ?? "");
  const bytes = Buffer.from(await pdf.save());

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storageKey = `generated/bills/${bill.id}/${sha256}`;
  await putObject(storageKey, bytes, "application/pdf");
  const fileName = `Statement of account ${bill.protocol.code ?? bill.protocolId}.pdf`.replace(/[\\/]/g, "-");
  await prisma.$transaction(async (tx) => {
    const created = await tx.storedFile.create({
      data: {
        protocolVersionId: bill.versionId,
        kind: "GENERATED_PDF",
        originalName: fileName,
        suggestedName: fileName,
        storageKey,
        mime: "application/pdf",
        size: bytes.length,
        sha256,
        uploadedById: bill.issuedById ?? bill.protocol.leaderUserId,
        scanStatus: "CLEAN",
        variant: "statement",
        audience: "PROPONENT",
      },
    });
    await tx.bill.update({ where: { id: bill.id }, data: { statementFileId: created.id } });
    await audit.record(tx, {
      actorUserId: bill.issuedById,
      action: AuditAction.fileUploaded,
      entityType: "file",
      entityId: created.id,
      protocolId: bill.protocolId,
      diff: diffOf({}, { kind: "GENERATED_PDF", originalName: fileName, billId: bill.id }),
      meta: {},
    });
  });
}
