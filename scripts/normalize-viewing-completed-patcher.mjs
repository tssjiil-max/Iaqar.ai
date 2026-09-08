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
let normalized = source.replace(marker, replacement);

const interpolation = "${workerBase()}";
const escapedInterpolation = "\\${workerBase()}";
const interpolationCount = normalized.split(interpolation).length - 1;
if (interpolationCount !== 3) {
  throw new Error(`patcher workerBase interpolation count=${interpolationCount}, expected 3`);
}
normalized = normalized.split(interpolation).join(escapedInterpolation);

const helperAnchor = "\n// 1) Canonical viewing domain: a confirmed appointment is not a completed viewing.\n";
if ((normalized.split(helperAnchor).length - 1) !== 1) {
  throw new Error("patcher helper anchor is not unique");
}
const helper = `
function replaceFirstOfTwo(file, before, after, label = before.slice(0, 60)) {
  const source = readFileSync(file, "utf8");
  const count = source.split(before).length - 1;
  if (count !== 2) {
    throw new Error(\`${file}: expected exactly two matches for \${label}, found \${count}\`);
  }
  writeFileSync(file, source.replace(before, after));
  console.log(\`[patched] \${file} :: \${label} (first of 2 contexts)\`);
}
`;
normalized = normalized.replace(helperAnchor, `${helper}${helperAnchor}`);

const secondaryCall = 'replaceOnce(\n  taskController,\n  `    if (action === "complete_info") {';
const secondaryCallCount = normalized.split(secondaryCall).length - 1;
if (secondaryCallCount !== 1) {
  throw new Error(`secondary handler patch call count=${secondaryCallCount}, expected 1`);
}
normalized = normalized.replace(
  secondaryCall,
  'replaceFirstOfTwo(\n  taskController,\n  `    if (action === "complete_info") {'
);

writeFileSync(file, normalized);
console.log("Guarded patcher normalized: exact match-group contexts, escaped controller interpolation, secondary handler targeted safely.");
