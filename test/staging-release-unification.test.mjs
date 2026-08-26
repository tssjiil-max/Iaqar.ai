/**
 * Staging release unification — URL, headers, version.json, SW cache, no production.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import {
  APPROVED_STAGING_URL,
  FORBIDDEN_STAGING_URL,
  IAQAR_CACHE_PREFIX,
  REQUIRED_STAGING_BRANCH,
  STAGING_FIREBASE_PROJECT,
  assertReleaseMatch,
  assertSafeToDeployStaging,
  buildVersionPayload,
  cacheNameFor,
  cachesToDelete,
  fetchStrategyFor,
  formatVersionLabel,
  parseReleaseVersion,
  scriptForbidsProductionDeploy
} from "../public/js/release-version-domain.js";

const root = path.resolve(import.meta.dirname, "..");

function read(...parts) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

function walkFiles(directory, found = []) {
  for (const name of readdirSync(directory)) {
    if (name === "node_modules" || name === ".git" || name === ".firebase") continue;
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) walkFiles(full, found);
    else found.push(full);
  }
  return found;
}

function cacheControlFor(source) {
  const firebase = JSON.parse(read("firebase.json"));
  const matches = firebase.hosting.headers.filter((row) => row.source === source);
  assert.ok(matches.length, `missing header source ${source}`);
  const last = matches[matches.length - 1];
  const header = last.headers.find((item) => item.key === "Cache-Control");
  return header?.value || "";
}

test("old default staging URL is gone; approved channel is the only default", () => {
  const hits = [];
  for (const file of walkFiles(root)) {
    if (!/\.(mjs|js|json|md|txt|html|sh|ps1|cmd|toml)$/i.test(file)) continue;
    const text = readFileSync(file, "utf8");
    if (text.includes(FORBIDDEN_STAGING_URL) || text.includes(`https://${["iaqar-ai-staging", "web.app"].join(".")}`)) {
      hits.push(path.relative(root, file));
    }
  }
  assert.deepEqual(hits, []);
  const verifyLive = read("scripts", "staging-verify-live.mjs");
  assert.ok(verifyLive.includes(APPROVED_STAGING_URL));
  assert.ok(read("scripts", "deploy-staging-safe.sh").includes(APPROVED_STAGING_URL));
});

test("Firebase Hosting headers pin HTML, version.json, and SW to no-store", () => {
  assert.equal(cacheControlFor("/index.html"), "no-store");
  assert.equal(cacheControlFor("/"), "no-store");
  assert.equal(cacheControlFor("/version.json"), "no-store");
  assert.equal(cacheControlFor("/firebase-messaging-sw.js"), "no-store");
  assert.equal(cacheControlFor("**"), "no-cache");
  assert.match(cacheControlFor("/icons/**"), /max-age=3600/);
  assert.match(cacheControlFor("/fonts/**"), /max-age=31536000/);
});

test("version.json is gitignored and generated from the current commit", () => {
  assert.ok(read(".gitignore").includes("public/version.json"));
  const out = path.join(tmpdir(), `iaqar-version-${process.pid}.json`);
  execFileSync(process.execPath, [path.join(root, "scripts", "write-staging-version.mjs"), out], {
    cwd: root
  });
  const payload = JSON.parse(readFileSync(out, "utf8"));
  const fullSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const shortSha = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(payload.fullSha, fullSha.toLowerCase());
  assert.equal(payload.shortSha, shortSha.toLowerCase());
  assert.equal(payload.channel, "staging");
  assert.ok(payload.deployedAt);
  const currentBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(payload.branch, currentBranch);
  unlinkSync(out);
  assert.equal(existsSync(path.join(root, "public", "version.json")), false);
});

test("cache name is tied to the release SHA and old iaqar caches are deleted", () => {
  assert.equal(cacheNameFor("d154a2d"), `${IAQAR_CACHE_PREFIX}d154a2d`);
  assert.equal(cacheNameFor(""), `${IAQAR_CACHE_PREFIX}pending`);
  assert.deepEqual(
    cachesToDelete([
      "iaqar-shell-workspace-v4",
      "iaqar-shell-phase9a-v9",
      "iaqar-shell-d154a2d",
      "other-cache"
    ], "iaqar-shell-d154a2d"),
    ["iaqar-shell-workspace-v4", "iaqar-shell-phase9a-v9"]
  );
});

test("fetch strategies: HTML/version network-first, JS network-first, images cache-first", () => {
  assert.equal(fetchStrategyFor("/"), "network-first-nostore");
  assert.equal(fetchStrategyFor("/index.html"), "network-first-nostore");
  assert.equal(fetchStrategyFor("/version.json"), "network-first-nostore");
  assert.equal(fetchStrategyFor("/js/opportunity-bank.js"), "network-first");
  assert.equal(fetchStrategyFor("/icons/iaqar-default-icon-192.png"), "network-first");
  assert.equal(fetchStrategyFor("/icons/icon-192.png"), "network-first");
  assert.equal(fetchStrategyFor("/fonts/tajawal/tajawal-400.woff2"), "cache-first");
});

test("service worker source uses versioned cache and one-shot skipWaiting", () => {
  const sw = read("public", "firebase-messaging-sw.js");
  assert.ok(sw.includes('IAQAR_CACHE_PREFIX = "iaqar-shell-"'));
  assert.ok(sw.includes("/version.json"));
  assert.ok(sw.includes('cache: "no-store"'));
  assert.ok(sw.includes("IAQAR_SKIP_WAITING"));
  assert.ok(sw.includes('key.startsWith(IAQAR_CACHE_FAMILY)'));
  assert.equal(sw.includes("iaqar-shell-workspace-v4"), false);
  assert.equal(sw.includes("self.skipWaiting();") && sw.includes("IAQAR_SKIP_WAITING"), true);
});

test("shell shows version footer and update prompt without inventing a SHA", () => {
  const html = read("public", "index.html");
  const ui = read("public", "js", "release-version-ui.js");
  assert.ok(html.includes("js/release-version-ui.js"));
  assert.ok(html.includes(".release-version"));
  assert.ok(ui.includes("يتوفر تحديث جديد"));
  assert.ok(ui.includes("تحديث الآن"));
  assert.ok(ui.includes("نسخة:") || ui.includes("formatVersionLabel"));
  assert.equal(html.includes('id="releaseVersion"'), false, "version node is created only after a valid SHA loads");
  assert.equal(formatVersionLabel("abc1234"), "نسخة: abc1234");
  assert.equal(formatVersionLabel(""), "");
  assert.equal(parseReleaseVersion({ shortSha: "not-a-sha" }), null);
  assert.equal(parseReleaseVersion({ shortSha: "d154a2d", fullSha: "d".repeat(40) }).shortSha, "d154a2d");
});

test("safe deploy refuses production, dirty trees, and SHA drift", () => {
  const firebaseRc = { projects: { default: "aqar-b5d76", staging: STAGING_FIREBASE_PROJECT } };
  const sha = "a".repeat(40);
  assert.equal(assertSafeToDeployStaging({
    branch: REQUIRED_STAGING_BRANCH,
    porcelain: "",
    localSha: sha,
    remoteSha: sha,
    firebaseRc
  }).ok, true);
  assert.ok(assertSafeToDeployStaging({
    branch: "main",
    porcelain: "",
    localSha: sha,
    remoteSha: sha,
    firebaseRc
  }).errors.includes("branch"));
  assert.ok(assertSafeToDeployStaging({
    branch: REQUIRED_STAGING_BRANCH,
    porcelain: "?? admin/package-lock.json",
    localSha: sha,
    remoteSha: sha,
    firebaseRc
  }).errors.includes("dirty-tree"));
  assert.ok(assertSafeToDeployStaging({
    branch: REQUIRED_STAGING_BRANCH,
    porcelain: "",
    localSha: sha,
    remoteSha: "b".repeat(40),
    firebaseRc
  }).errors.includes("origin-mismatch"));
  assert.ok(assertSafeToDeployStaging({
    branch: REQUIRED_STAGING_BRANCH,
    porcelain: "",
    localSha: sha,
    remoteSha: sha,
    firebaseRc: { projects: { staging: "aqar-b5d76" } }
  }).errors.includes("firebase-target"));
  assert.ok(assertSafeToDeployStaging({
    branch: REQUIRED_STAGING_BRANCH,
    porcelain: "",
    localSha: sha,
    remoteSha: sha,
    firebaseRc,
    extraArgs: ["--production"]
  }).errors.includes("production-flag"));
});

test("deploy scripts cannot publish production Hosting or the production Worker", () => {
  const safe = read("scripts", "deploy-staging-safe.sh");
  const deploy = read("scripts", "deploy-staging.sh");
  assert.equal(scriptForbidsProductionDeploy(safe), true);
  assert.equal(scriptForbidsProductionDeploy(deploy), true);
  assert.ok(safe.includes("staging-release-guard.mjs"));
  assert.ok(safe.includes("write-staging-version.mjs"));
  assert.ok(safe.includes("verify-staging-release.mjs"));
  assert.ok(safe.includes("npm test"));
  assert.ok(safe.includes("hosting:channel:deploy staging") || safe.includes("deploy-staging.sh"));
  assert.equal(safe.includes("wrangler deploy --env staging") || deploy.includes("wrangler deploy --env staging"), true);
  assert.equal(safe.includes("firebase deploy --only hosting"), false);
  assert.equal(deploy.includes("firebase deploy --only hosting"), false);
  assert.equal(safe.includes("--project aqar-b5d76"), false);
  assert.equal(deploy.includes("--project aqar-b5d76"), false);
});

test("version UI renders a valid SHA and stays silent when version.json is missing", async () => {
  const html = `<!doctype html><html><body><div class="app"></div></body></html>`;
  const specifier = new URL(pathToFileURL(path.join(root, "public/js/release-version-ui.js")));
  specifier.searchParams.set("ui", "1");
  const mod = await import(specifier.href);

  const missing = new JSDOM(html, { url: "https://example.test/" });
  await mod.bootReleaseVersionUi({
    document: missing.window.document,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    navigator: {},
    sessionStorage: missing.window.sessionStorage,
    location: { reload() {} }
  });
  assert.equal(missing.window.document.getElementById("releaseVersion"), null);
  missing.window.close();

  const present = new JSDOM(html, { url: "https://example.test/" });
  await mod.bootReleaseVersionUi({
    document: present.window.document,
    fetch: async () => ({
      ok: true,
      json: async () => ({ shortSha: "d154a2d", fullSha: "d".repeat(40), channel: "staging" })
    }),
    navigator: {},
    sessionStorage: present.window.sessionStorage,
    location: { reload() {} }
  });
  const label = present.window.document.getElementById("releaseVersion");
  assert.ok(label);
  assert.equal(label.textContent, "نسخة: d154a2d");
  assert.equal(label.hidden, false);
  present.window.close();
});

test("published version must match the local commit SHA", () => {
  const full = "c".repeat(40);
  const published = buildVersionPayload({
    fullSha: full,
    shortSha: full.slice(0, 7),
    branch: REQUIRED_STAGING_BRANCH,
    deployedAt: "2026-08-16T22:00:00.000Z"
  });
  assert.equal(assertReleaseMatch(published, full), true);
  assert.throws(() => assertReleaseMatch(published, "d".repeat(40)), /does not match/);
});
