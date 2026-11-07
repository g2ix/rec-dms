import { findAuthzGaps } from "../src/lib/authz-surface";

const gaps = findAuthzGaps();
if (gaps.length === 0) {
  console.log("Every server action and route handler is gated.");
  process.exit(0);
}
for (const gap of gaps) console.error(`${gap.file} ${gap.name}: ${gap.reason}`);
process.exit(1);
