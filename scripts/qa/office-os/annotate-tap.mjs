// Turns failing node:test (TAP) results into GitHub annotations so failures are
// readable from the check run without downloading logs.
import { readFileSync } from "node:fs";
const lines = readFileSync(process.argv[2], "utf8").split("\n");
let count = 0;
for (let i = 0; i < lines.length && count < 45; i += 1) {
  const m = lines[i].match(/^(\s*)not ok \d+ - (.*)$/);
  if (!m) continue;
  const detail = lines.slice(i + 1, i + 25).map((l) => l.trim()).find((l) => /^(error|message|expected|actual|code):|Error|Cannot find/.test(l)) || "";
  console.log(`::error title=failing test::${m[2].slice(0, 180)} — ${detail.slice(0, 300).replace(/%/g, "%25")}`);
  count += 1;
}
const summary = lines.filter((l) => /^# (tests|pass|fail) /.test(l)).join(" ");
console.log(`::notice title=test totals::${summary}`);
