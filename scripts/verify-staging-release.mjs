#!/usr/bin/env node
/**
 * Compare published /version.json with the local HEAD commit.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  APPROVED_STAGING_URL,
  assertReleaseMatch,
  parseReleaseVersion
} from "../public/js/release-version-domain.js";

const root = path.resolve(import.meta.dirname, "..");
const hosting = process.env.STAGING_HOSTING_URL || APPROVED_STAGING_URL;
const localSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

if (!hosting.includes("--staging")) {
  console.error("verify-staging-release: hosting URL is not the staging channel");
  process.exit(1);
}

const versionUrl = new URL("/version.json", hosting).toString();
const response = await fetch(versionUrl, { cache: "no-store", redirect: "follow" });
const cacheControl = String(response.headers.get("cache-control") || "").toLowerCase();
const text = await response.text();
if (!response.ok) {
  console.error(`verify-staging-release: ${versionUrl} → HTTP ${response.status}`);
  process.exit(1);
}
if (!cacheControl.includes("no-store")) {
  console.error(`verify-staging-release: version.json Cache-Control must be no-store, got ${cacheControl || "(missing)"}`);
  process.exit(1);
}

let json;
try {
  json = JSON.parse(text);
} catch {
  console.error("verify-staging-release: version.json is not JSON");
  process.exit(1);
}

const parsed = parseReleaseVersion(json);
if (!parsed) {
  console.error("verify-staging-release: version.json failed validation");
  process.exit(1);
}

assertReleaseMatch(parsed, localSha);
console.log(`verify-staging-release: OK ${parsed.shortSha} ${parsed.fullSha}`);
