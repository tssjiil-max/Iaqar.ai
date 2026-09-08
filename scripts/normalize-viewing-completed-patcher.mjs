#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const file = "scripts/apply-viewing-completed-deal-gate.mjs";
const source = readFileSync(file, "utf8");
const marker = `replaceOnce(
  "public/js/match-group-domain.js",
  '    || key === LIVING_TASK_STAGE.CLIENT_NEEDS_MISSING_INFO\\n    || key === LIVING_TASK_STAGE.FOLLOW_UP\\n  ) {',
  '    || key === LIVING_TASK_STAGE.CLIENT_NEEDS_MISSING_INFO\\n    || key === LIVING_TASK_STAGE.VIEWING_COMPLETED\\n    || key === LIVING_TASK_STAGE.FOLLOW_UP\\n  ) {',
  "viewing completed needs broker action"
);`;

const replacement = `{
  const file = "public/js/match-group-domain.js";
  const before = '    || key === LIVING_TASK_STAGE.CLIENT_NEEDS_MISSING_INFO\\n    || key === LIVING_TASK_STAGE.FOLLOW_UP\\n  ) {';
  const after = '    || key === LIVING_TASK_STAGE.CLIENT_NEEDS_MISSING_INFO\\n    || key === LIVING_TASK_STAGE.VIEWING_COMPLETED\\n    || key === LIVING_TASK_STAGE.FOLLOW_UP\\n  ) {';
  const current = readFileSync(file, "utf8");
  const count = current.split(before).length - 1;
  if (count !== 2) throw new Error(\`${file}: expected two broker-action contexts, found \${count}\`);
  writeFileSync(file, current.split(before).join(after));
  console.log(\`[patched] \${file} :: viewing completed needs broker action (2 contexts)\`);
}`;

const count = source.split(marker).length - 1;
if (count !== 1) throw new Error(`patcher normalization marker count=${count}`);
writeFileSync(file, source.replace(marker, replacement));
console.log("Guarded patcher normalized for the two intended match-group contexts.");
