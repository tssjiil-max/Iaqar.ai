#!/usr/bin/env node
/**
 * Workflow entry point for the fresh Match lineage verifier.
 *
 * It used to rewrite the verifier's source at runtime (string replace into a temp
 * copy) and failed whenever the verifier text drifted. That fix now lives in the
 * verifier itself, so this runner only launches it unchanged.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERIFIER_FILE = "staging-fresh-match-lineage-verify.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const result = spawnSync(process.execPath, [path.join(scriptsDir, VERIFIER_FILE), ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env
});
if (result.error) throw result.error;
process.exitCode = Number.isInteger(result.status) ? result.status : 1;
