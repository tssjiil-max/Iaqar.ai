/**
 * Phase 9A — full-functional staging kit for project iaqar-ai-staging.
 * Does not perform a live deploy.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { JSDOM } from "jsdom";

const root = path.resolve(import.meta.dirname, "..");

function read(...parts) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

function loadRuntimeConfig({ hostname, search = "" }) {
  const runtime = read("public", "js", "runtime-config.js");
  const query = !search ? "" : search.startsWith("?") ? search : `?${search}`;
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: `https://${hostname}/${query}`,
    runScripts: "dangerously"
  });
  const script = dom.window.document.createElement("script");
  script.textContent = runtime;
  dom.window.document.body.appendChild(script);
  return dom.window.IAQAR;
}

test("Phase 9A runtime-config: staging channel uses staging Worker + Firebase project", () => {
  const cfg = loadRuntimeConfig({
    hostname: "iaqar-ai-staging--staging-abc123.web.app"
  });
  assert.equal(cfg.deploymentEnvironment, "staging");
  assert.equal(cfg.workerBase, "https://iaqar-intake-staging.iaqar-ai.workers.dev");
  assert.equal(cfg.firebaseProjectId, "iaqar-ai-staging");
  assert.equal(typeof cfg.resolveWorkerBase, "function");
  assert.equal(cfg.resolveWorkerBase(), cfg.workerBase);
});

test("Phase 9A runtime-config: ?env=staging override works on any host", () => {
  const cfg = loadRuntimeConfig({
    hostname: "localhost",
    search: "?env=staging"
  });
  assert.equal(cfg.deploymentEnvironment, "staging");
  assert.ok(cfg.workerBase.includes("iaqar-intake-staging"));
  assert.equal(cfg.firebaseProjectId, "iaqar-ai-staging");
});

test("Phase 9A runtime-config: production hosts keep production Worker + project", () => {
  for (const hostname of ["aqar-b5d76.web.app", "iaqar.ai", "www.iaqar.ai"]) {
    const cfg = loadRuntimeConfig({ hostname });
    assert.equal(cfg.deploymentEnvironment, "production", hostname);
    assert.equal(
      cfg.workerBase,
      "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev",
      hostname
    );
    assert.equal(cfg.firebaseProjectId, "aqar-b5d76", hostname);
  }
});

test("Phase 9A runtime-config: staging never falls back to production Worker", () => {
  const cfg = loadRuntimeConfig({
    hostname: "iaqar-ai-staging--staging-abc123.web.app"
  });
  delete cfg.workerBase;
  assert.equal(cfg.resolveWorkerBase(), "https://iaqar-intake-staging.iaqar-ai.workers.dev");
});

test("Phase 9A wrangler staging uses iaqar-ai-staging and no cron", () => {
  const toml = read("worker", "wrangler.toml");
  assert.ok(toml.includes("[env.staging]"));
  assert.ok(toml.includes('name = "iaqar-intake-staging"'));
  assert.ok(toml.includes('FIREBASE_PROJECT_ID = "iaqar-ai-staging"'));
  assert.ok(toml.includes('DEPLOYMENT_ENV = "staging"'));
  assert.ok(toml.includes('name = "iaqar-macrodroid-intake"'));
  assert.ok(toml.includes('FIREBASE_PROJECT_ID = "aqar-b5d76"'));
  const stagingBlock = toml.split("[env.staging]")[1] || "";
  assert.equal(stagingBlock.includes('name = "iaqar-macrodroid-intake"'), false);
  assert.ok(stagingBlock.includes('FIREBASE_PROJECT_ID = "iaqar-ai-staging"'));
  assert.equal(stagingBlock.includes('FIREBASE_PROJECT_ID = "aqar-b5d76"'), false);
  assert.ok(/crons\s*=\s*\[\s*\]/.test(stagingBlock) || stagingBlock.includes("crons = []"));

  const rc = JSON.parse(read(".firebaserc"));
  assert.equal(rc.projects.default, "aqar-b5d76");
  assert.equal(rc.projects.staging, "iaqar-ai-staging");
});

test("Phase 9A deploy script uses SA GAC, not FIREBASE_TOKEN", () => {
  const script = read("scripts", "deploy-staging.sh");
  assert.ok(script.includes("wrangler deploy --env staging"));
  assert.ok(script.includes("hosting:channel:deploy staging"));
  assert.ok(script.includes("iaqar-ai-staging"));
  assert.ok(script.includes("FIREBASE_CLIENT_EMAIL"));
  assert.ok(script.includes("FIREBASE_PRIVATE_KEY"));
  assert.ok(script.includes("FIREBASE_PRIVATE_KEY_ID"));
  assert.ok(script.includes("GOOGLE_APPLICATION_CREDENTIALS"));
  assert.ok(script.includes("staging-gac.mjs"));
  assert.ok(script.includes("backendReady"));
  assert.ok(script.includes("smoke-staging.mjs"));
  assert.ok(script.includes("cannot deploy production") || script.includes("Refusing"));
  // Must not require FIREBASE_TOKEN or pass it to firebase-tools (ignore-note is OK).
  assert.equal(/FIREBASE_TOKEN is required/.test(script), false);
  assert.equal(/die "FIREBASE_TOKEN/.test(script), false);
  assert.equal(/--token\s+"?\$\{?FIREBASE_TOKEN/.test(script), false);
  assert.equal(/firebase deploy --only hosting/.test(script), false);
  assert.equal(/^\s*(?:\.\/)?deploy-all/m.test(script), false);

  const ps1 = read("scripts", "deploy-staging.ps1");
  assert.ok(ps1.includes("FIREBASE_CLIENT_EMAIL"));
  assert.ok(ps1.includes("GOOGLE_APPLICATION_CREDENTIALS"));
  assert.equal(ps1.includes("--token $env:FIREBASE_TOKEN"), false);
  assert.ok(ps1.includes("iaqar-ai-staging"));

  assert.ok(existsSync(path.join(root, "scripts", "staging-gac.mjs")));
  assert.ok(existsSync(path.join(root, "docs", "STAGING-DEPLOY.md")));
});

test("Phase 9A staging-gac writes temp credentials then caller can delete", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "iaqar-gac-"));
  const out = path.join(dir, "sa.json");
  const fakeKey = "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n";
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "staging-gac.mjs"), out], {
    env: {
      ...process.env,
      FIREBASE_CLIENT_EMAIL: "sa@iaqar-ai-staging.iam.gserviceaccount.com",
      FIREBASE_PRIVATE_KEY: fakeKey,
      FIREBASE_PRIVATE_KEY_ID: "test-key-id-12345678",
      FIREBASE_STAGING_PROJECT_ID: "iaqar-ai-staging"
    },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.includes("BEGIN PRIVATE KEY"), false);
  assert.equal(result.stdout.includes("test-key-id"), false);
  assert.equal(result.stdout.includes("sa@"), false);
  const parsed = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(parsed.type, "service_account");
  assert.equal(parsed.project_id, "iaqar-ai-staging");
  assert.equal(parsed.client_email, "sa@iaqar-ai-staging.iam.gserviceaccount.com");
  assert.equal(parsed.private_key_id, "test-key-id-12345678");
  assert.ok(parsed.private_key.includes("BEGIN PRIVATE KEY"));
  unlinkSync(out);
  rmSync(dir, { recursive: true, force: true });
});

test("Phase 9A shell uses channel-local Firebase init; no deals nav", () => {
  const shell = read("public", "index.html");
  const runtimeIdx = shell.indexOf('src="js/runtime-config.js"');
  const accessIdx = shell.indexOf('src="js/access-gate.js"');
  const workflowIdx = shell.indexOf('src="js/workflow-office.js"');
  assert.ok(runtimeIdx > 0);
  assert.ok(accessIdx > runtimeIdx);
  assert.ok(workflowIdx > accessIdx);
  assert.ok(shell.includes('src="/__/firebase/init.js"'));
  assert.equal(shell.includes("aqar-b5d76.web.app/__/firebase/init.js"), false);
  assert.equal(shell.includes('data-main="deals"'), false);

  const office = read("public", "js", "firebase-office.js");
  assert.ok(office.includes("firebaseProjectId") || office.includes("resolveFirebaseProjectId"));
});

test("Phase 9A clients fail closed to staging Worker on staging hosts", () => {
  for (const rel of [
    "public/js/workflow-office.js",
    "public/js/access-gate.js",
    "public/js/office-settings.js",
    "public/js/whatsapp-office.js"
  ]) {
    const src = read(...rel.split("/"));
    assert.ok(src.includes("IAQAR.resolveWorkerBase"), rel);
    assert.ok(src.includes("iaqar-intake-staging"), rel);
  }
});

test("Phase 9A package scripts expose deploy:staging and smoke:staging", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["deploy:staging"], "bash scripts/deploy-staging.sh");
  assert.equal(pkg.scripts["smoke:staging"], "node scripts/smoke-staging.mjs");
  assert.ok(pkg.scripts["test:phase9a"]);
});
