import "server-only";
import { quoteFee, scheduleOn } from "@/lib/fees/calc";
import { manilaDay } from "@/lib/workflow/calendar";
import { prisma } from "@/server/db";
import { loadSchedules } from "@/server/fees/bills";
import { suggestClientType } from "@/server/fees/client-type";

/**
 * The F-30 Ethics Review Fee before the review type is known: the expedited rate for the
 * protocol's client type (set by REC Staff, else suggested from the leader's profile) in the
 * schedule in effect today. Null when there is no client type or no rate. It is an estimate the
 * proponent may change; the bill issued on the type of review is what is paid.
 */
export async function estimateEthicsFee(protocolId: string): Promise<{ amount: number; clientTypeKey: string } | null> {
  const protocol = await prisma.protocol.findUnique({ where: { id: protocolId }, select: { clientTypeKey: true } });
  const clientTypeKey = protocol?.clientTypeKey ?? (await suggestClientType(protocolId));
  if (!clientTypeKey) return null;
  const schedule = scheduleOn(await loadSchedules(prisma), manilaDay(new Date()));
  if (!schedule) return null;
  const quote = quoteFee(schedule, { clientTypeKey, reviewType: "EXPEDITED", basis: "reviewType", round: 1 });
  return quote ? { amount: quote.amount, clientTypeKey } : null;
}
