#!/usr/bin/env node
/**
 * Pre-deploy safety gate for Staging-only release.
 * Reads Git + .firebaserc. Prints error codes, never secret values.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  REQUIRED_STAGING_BRANCH,
  STAGING_FIREBASE_PROJECT,
  assertSafeToDeployStaging
} from "../public/js/release-version-domain.js";

const root = path.resolve(import.meta.dirname, "..");

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const porcelain = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
const localSha = git(["rev-parse", "HEAD"]);
let remoteSha = "";
try {
  execFileSync("git", ["fetch", "origin", REQUIRED_STAGING_BRANCH], { cwd: root, stdio: "pipe" });
  remoteSha = git(["rev-parse", `origin/${REQUIRED_STAGING_BRANCH}`]);
} catch {
  console.error("staging-release-guard: unable to fetch origin branch");
  process.exit(1);
}

const firebaseRc = JSON.parse(readFileSync(path.join(root, ".firebaserc"), "utf8"));
const result = assertSafeToDeployStaging({
  branch,
  porcelain,
  localSha,
  remoteSha,
  firebaseRc,
  deployTarget: process.env.IAQAR_DEPLOY_TARGET || "staging",
  extraArgs: process.argv.slice(2)
});

if (!result.ok) {
  console.error(`staging-release-guard: refused (${result.errors.join(",")})`);
  if (result.errors.includes("branch")) {
    console.error(`branch must be ${REQUIRED_STAGING_BRANCH}`);
  }
  if (result.errors.includes("firebase-target")) {
    console.error(`Firebase staging alias must be ${STAGING_FIREBASE_PROJECT}`);
  }
  process.exit(1);
}

console.log("staging-release-guard: OK");
