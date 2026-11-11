/**
 * Protocol code patterns. Tokens:
 * - `{YYYY}` the year in Asia/Manila
 * - `{###}` the sequence for that year, zero-padded to the number of `#`
 * - `{LEADER_FAMILY}` the project leader's family name
 * - `{ET_AL}` " et al" when the protocol has more than one researcher, otherwise empty
 */
export type CodeFacts = {
  year: string;
  sequence: number;
  leaderFamily: string;
  researcherCount: number;
};

const SEQUENCE = /\{(#+)\}/;

export function hasSequenceToken(pattern: string): boolean {
  return SEQUENCE.test(pattern);
}

export function renderProtocolCode(pattern: string, facts: CodeFacts): string {
  return pattern
    .replaceAll("{YYYY}", facts.year)
    .replace(SEQUENCE, (_match, hashes: string) => String(facts.sequence).padStart(hashes.length, "0"))
    .replaceAll("{LEADER_FAMILY}", facts.leaderFamily.trim())
    .replaceAll("{ET_AL}", facts.researcherCount > 1 ? " et al" : "");
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Reads the sequence back out of a code issued with `pattern` in `year`. Null when the code does
 * not follow the pattern, for example a code issued under an earlier pattern.
 */
export function sequenceFromCode(pattern: string, year: string, code: string): number | null {
  let source = "";
  let rest = pattern;
  while (rest.length > 0) {
    const token = /\{(YYYY|#+|LEADER_FAMILY|ET_AL)\}/.exec(rest);
    if (!token) {
      source += escape(rest);
      break;
    }
    source += escape(rest.slice(0, token.index));
    const name = token[1] ?? "";
    if (name === "YYYY") source += escape(year);
    else if (name.startsWith("#")) source += "(\\d+)";
    else if (name === "LEADER_FAMILY") source += ".+?";
    else source += "(?: et al)?";
    rest = rest.slice(token.index + token[0].length);
  }
  const match = new RegExp(`^${source}$`).exec(code);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : null;
}
