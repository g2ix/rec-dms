import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { authoredRowMap } from "@/lib/forms/authored";
import { eachField, type FormSchema } from "@/lib/forms/schema";

type Db = PrismaClient | Prisma.TransactionClient;

export async function loadAuthoredRows(
  db: Db,
  userId: string,
  protocolVersionId: string,
  schema: FormSchema,
): Promise<Record<string, string[]>> {
  const codes = new Set<string>();
  for (const field of eachField(schema)) {
    for (const column of field.columns ?? []) {
      for (const code of column.authoredFrom?.forms ?? []) codes.add(code);
    }
  }
  if (codes.size === 0) return {};
  const instances = await db.formInstance.findMany({
    where: {
      ownerType: "PROTOCOL_VERSION",
      ownerId: protocolVersionId,
      filledByMember: { userId },
      formDefinition: { code: { in: [...codes] } },
    },
    include: { formDefinition: { select: { code: true } } },
  });
  return authoredRowMap(
    schema,
    instances.map((instance) => ({ code: instance.formDefinition.code, data: instance.data })),
  );
}
