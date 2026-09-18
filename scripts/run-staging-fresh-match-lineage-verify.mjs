#!/usr/bin/env node
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(scriptsDir, "staging-fresh-match-lineage-verify.mjs");
const tempPath = path.join(scriptsDir, ".staging-fresh-match-lineage-verify.runtime.mjs");

const oldBlock = `  await page.goBack();
  await overlay.waitFor({ state: "hidden", timeout: 10000 });
  await selectMatchesFilter(page);`;

const newBlock = `  // The workflow overlay changes SPA history/state. A plain goBack can leave the
  // second Bank card outside the active rendered list even though it existed before
  // opening the first CTA. Reload the deployed Bank deterministically before the
  // second-side assertion, then re-open the Matches filter.
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await openBankTab(page);
  await selectMatchesFilter(page);`;

const source = readFileSync(sourcePath, "utf8");
if (!source.includes(oldBlock)) {
  throw new Error("Fresh Match verifier patch target changed; update the runner instead of silently skipping the fix");
}

writeFileSync(tempPath, source.replace(oldBlock, newBlock), "utf8");
try {
  const result = spawnSync(process.execPath, [tempPath, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env
  });
  if (result.error) throw result.error;
  process.exitCode = Number.isInteger(result.status) ? result.status : 1;
} finally {
  rmSync(tempPath, { force: true });
}
