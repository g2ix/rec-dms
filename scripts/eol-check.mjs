// Fails when a file that .gitattributes marks `eol=lf` contains a carriage return.
// Those files run on Linux (Cloud Build, Cloud Run, CI), where `#!/bin/sh\r` and
// `set -euo pipefail\r` fail. Checks the working tree, tracked and new files alike,
// because `gcloud builds submit` uploads the working tree, not the index.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function git(args, input) {
  return execFileSync("git", args, { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const files = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
  .split("\0")
  .filter(Boolean);

// `git check-attr -z` prints path, attribute, value, each followed by NUL.
const attrs = git(["check-attr", "-z", "--stdin", "eol"], files.join("\0")).split("\0");
const lfFiles = [];
for (let i = 0; i + 2 < attrs.length; i += 3) {
  if (attrs[i + 2] === "lf") lfFiles.push(attrs[i]);
}

const bad = [];
for (const file of new Set(lfFiles)) {
  let content;
  try {
    content = readFileSync(file);
  } catch {
    continue; // Deleted in the working tree but still in the index.
  }
  if (content.includes(0x0d)) bad.push(file);
}

if (bad.length > 0) {
  console.error("These files must use LF line endings but contain a carriage return (\\r):");
  for (const file of bad) console.error(`  ${file}`);
  console.error("Fix: delete them and run `git checkout -- <file>`, or convert them to LF.");
  process.exit(1);
}
console.log(`eol-check: ${lfFiles.length} LF-only files, no carriage returns.`);
