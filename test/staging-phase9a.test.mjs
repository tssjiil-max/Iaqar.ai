/**
 * Phase 9A — staging deployment kit: runtime routing, wrangler staging env,
 * deploy script guards, shell wiring. Does not perform a live deploy.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const root = path.resolve(import.meta.dirname, "..");

function read(...parts) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

function loadRuntimeConfig({ hostname, search = "" }) {
  const runtime = read("public", "js", "runtime-config.js");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: `https://${hostname}/${search}`,
    runScripts: "outside-only"
  });
  const sandbox = {
    window: dom.window,
    CustomEvent: dom.window.CustomEvent
  };
  sandbox.window.IAQAR = {};
  vm.runInNewContext(runtime, sandbox);
  return sandbox.window.IAQAR;
}

test("Phase 9A runtime-config: staging channel host uses staging Worker", () => {
  const cfg = loadRuntimeConfig({
    hostname: "aqar-b5d76--staging-abc123.web.app"
  });
  assert.equal(cfg.deploymentEnvironment, "staging");
  assert.equal(cfg.workerBase, "https://iaqar-intake-staging.iaqar-ai.workers.dev");
});

test("Phase 9A runtime-config: ?env=staging override works on any host", () => {
  const cfg = loadRuntimeConfig({
    hostname: "localhost",
    search: "?env=staging"
  });
  assert.equal(cfg.deploymentEnvironment, "staging");
  assert.ok(cfg.workerBase.includes("iaqar-intake-staging"));
});

test("Phase 9A runtime-config: production hosts keep production Worker", () => {
  for (const hostname of ["aqar-b5d76.web.app", "iaqar.ai", "www.iaqar.ai"]) {
    const cfg = loadRuntimeConfig({ hostname });
    assert.equal(cfg.deploymentEnvironment, "production", hostname);
    assert.equal(
      cfg.workerBase,
      "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev",
      hostname
    );
  }
});

test("Phase 9A wrangler.toml defines staging Worker name and DEPLOYMENT_ENV", () => {
  const toml = read("worker", "wrangler.toml");
  assert.ok(toml.includes("[env.staging]"));
  assert.ok(toml.includes('name = "iaqar-intake-staging"'));
  assert.ok(toml.includes('DEPLOYMENT_ENV = "staging"'));
  assert.ok(toml.includes('DEPLOYMENT_ENV = "production"'));
  assert.ok(toml.includes('name = "iaqar-macrodroid-intake"'));
  // Staging must not redefine production name.
  const stagingBlock = toml.split("[env.staging]")[1] || "";
  assert.equal(stagingBlock.includes('name = "iaqar-macrodroid-intake"'), false);
});

test("Phase 9A deploy script refuses production and uses staging-only targets", () => {
  const script = read("scripts", "deploy-staging.sh");
  assert.ok(script.includes("wrangler deploy --env staging"));
  assert.ok(script.includes("hosting:channel:deploy staging"));
  assert.ok(script.includes('IAQAR_DEPLOY_TARGET'));
  assert.ok(script.includes("cannot deploy production") || script.includes("Refusing"));
  assert.equal(script.includes("wrangler deploy\n") && !script.includes("--env staging"), false);
  // Must not call bare production hosting deploy.
  assert.equal(/firebase deploy --only hosting/.test(script), false);
  assert.equal(/deploy-all/.test(script.split("\n").filter((l) => !l.trimStart().startsWith("#") && !l.includes("Do NOT")).join("\n")), false);
  assert.ok(existsSync(path.join(root, "scripts", "smoke-staging.mjs")));
  assert.ok(existsSync(path.join(root, "docs", "STAGING-DEPLOY.md")));
});

test("Phase 9A shell loads runtime-config before app scripts; no deals nav", () => {
  const shell = read("public", "index.html");
  const runtimeIdx = shell.indexOf('src="js/runtime-config.js"');
  const accessIdx = shell.indexOf('src="js/access-gate.js"');
  const workflowIdx = shell.indexOf('src="js/workflow-office.js"');
  assert.ok(runtimeIdx > 0);
  assert.ok(accessIdx > runtimeIdx);
  assert.ok(workflowIdx > accessIdx);
  assert.equal(shell.includes('data-main="deals"'), false);
  assert.equal(/bottom-nav|nav-bottom|bottom_nav/i.test(shell), false);

  const sw = read("public", "firebase-messaging-sw.js");
  assert.ok(sw.includes("iaqar-shell-phase9a-v1"));
  assert.ok(sw.includes("/js/runtime-config.js"));
});

test("Phase 9A clients resolve worker base from window.IAQAR.workerBase", () => {
  for (const rel of [
    "public/js/workflow-office.js",
    "public/js/access-gate.js",
    "public/js/office-settings.js",
    "public/js/whatsapp-office.js"
  ]) {
    const src = read(...rel.split("/"));
    assert.ok(src.includes("function resolveWorkerBase"), rel);
    assert.ok(src.includes("window.IAQAR.workerBase") || src.includes("window.IAQAR && window.IAQAR.workerBase"), rel);
    assert.ok(src.includes("resolveWorkerBase()"), rel);
    assert.equal(src.includes("${WORKER_BASE}"), false, rel);
  }
  const addOpp = read("public", "js", "add-opportunity.js");
  assert.ok(addOpp.includes("function workerBase"));
  assert.ok(addOpp.includes("window.IAQAR?.workerBase"));
  const bank = read("public", "js", "opportunity-bank.js");
  assert.ok(bank.includes("window.IAQAR?.workerBase"));
});

test("Phase 9A package scripts expose deploy:staging and smoke:staging", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["deploy:staging"], "bash scripts/deploy-staging.sh");
  assert.equal(pkg.scripts["smoke:staging"], "node scripts/smoke-staging.mjs");
  assert.ok(pkg.scripts["test:phase9a"]);
  const workerPkg = JSON.parse(read("worker", "package.json"));
  assert.ok(workerPkg.scripts["deploy:staging"].includes("--env staging"));
});
