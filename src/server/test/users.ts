import type { UserStatus } from "@prisma/client";
import { hashPassword } from "@/server/auth/passwords";
import { createPerson } from "@/server/auth/users";

export async function makeUser(input: {
  email: string;
  firstName?: string;
  familyName?: string;
  middleInitial?: string | null;
  password?: string;
  status?: UserStatus;
}) {
  return createPerson({
    firstName: input.firstName ?? "Juan",
    middleInitial: input.middleInitial === undefined ? "D" : input.middleInitial,
    familyName: input.familyName ?? "Cruz",
    email: input.email,
    status: input.status ?? "ACTIVE",
    passwordHash: input.password ? await hashPassword(input.password) : null,
  });
}

export const STRONG_PASSWORD = "Usc-ethics-review-2026-protocol";
