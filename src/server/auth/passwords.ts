import "server-only";
import { hash, verify } from "@node-rs/argon2";
import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import { adjacencyGraphs, dictionary as commonDictionary } from "@zxcvbn-ts/language-common";
import { dictionary as englishDictionary, translations } from "@zxcvbn-ts/language-en";
import { AppError } from "@/server/errors";

const options = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

let checker: ZxcvbnFactory | null = null;

function passwordChecker(): ZxcvbnFactory {
  checker ??= new ZxcvbnFactory({
    translations,
    graphs: adjacencyGraphs,
    dictionary: { ...commonDictionary, ...englishDictionary },
  });
  return checker;
}

export function assertPasswordAcceptable(password: string, userInputs: string[] = []): void {
  if (password.length < 12) {
    throw new AppError("WEAK_PASSWORD", "Use at least 12 characters.", 400);
  }
  const result = passwordChecker().check(password, userInputs);
  if (result.score < 3) {
    throw new AppError(
      "WEAK_PASSWORD",
      result.feedback.warning || "Choose a less predictable password.",
      400,
    );
  }
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, options);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password, options);
}
