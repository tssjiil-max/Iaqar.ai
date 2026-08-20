#!/usr/bin/env node
/**
 * Write public/version.json from the current Git commit. Never invents a SHA.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { buildVersionPayload } from "../public/js/release-version-domain.js";

const root = path.resolve(import.meta.dirname, "..");
const outPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, "public", "version.json");

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

const fullSha = git(["rev-parse", "HEAD"]).toLowerCase();
const shortSha = git(["rev-parse", "--short=7", "HEAD"]).toLowerCase();
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const payload = buildVersionPayload({
  fullSha,
  shortSha,
  branch,
  deployedAt: new Date().toISOString(),
  channel: "staging"
});

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`wrote ${path.relative(root, outPath)} shortSha=${payload.shortSha}`);
