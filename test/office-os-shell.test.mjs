import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

test("public/index.html is the new Office OS shell, not the legacy app", () => {
  const html = read("public/index.html");
  assert.match(html, /<script type="module" src="\/os\/app\.js"><\/script>/);
  assert.match(html, /\/js\/runtime-config\.js/);
  assert.match(html, /\/__\/firebase\/init\.js/);
  assert.ok(!html.includes("access-gate.js") && !html.includes("workflow-office.js"), "legacy scripts are not loaded by the new shell");
  assert.ok(!/iaqar/i.test(html.replace(/iaqar-[a-z0-9-]+\.png|iaqar\.officeId/gi, "")), "no iAqar branding text in the new shell");
  for (const key of ["cv2Party", "adminApplications", "openCooperation", "openDeal", "shared"]) assert.ok(html.includes(`"${key}"`), `legacy link key ${key} forwards to legacy.html`);
  assert.ok(read("public/legacy.html").includes("access-gate.js"), "old shell preserved as legacy.html");
});

test("reply page loads only runtime config and the reply module (no Firebase, no account)", () => {
  const html = read("public/r.html");
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.match(html, /\/os\/reply\.js/);
  assert.ok(!html.includes("firebase"), "reply page needs no Firebase SDK or sign-in");
});

function runtimeFor(hostname) {
  const window = { location: { hostname, search: "" }, addEventListener() {}, dispatchEvent() {} };
  const context = { window, URLSearchParams, URL, CustomEvent: class { constructor(n, o) { this.detail = o?.detail; } } };
  vm.runInNewContext(read("public/js/runtime-config.js"), context);
  return { env: window.IAQAR.deploymentEnvironment, worker: window.IAQAR.workerBase, resolved: window.IAQAR.resolveWorkerBase(), project: window.IAQAR.firebaseProjectId };
}

test("preview channel routes to the preview Worker; staging and production are unchanged", () => {
  const preview = runtimeFor("iaqar-ai-staging--office-os-preview-abc123.web.app");
  assert.deepEqual(preview, { env: "staging", worker: "https://iaqar-intake-os-preview.iaqar-ai.workers.dev", resolved: "https://iaqar-intake-os-preview.iaqar-ai.workers.dev", project: "iaqar-ai-staging" });
  const staging = runtimeFor("iaqar-ai-staging--staging-9c4b0k7h.web.app");
  assert.equal(staging.worker, "https://iaqar-intake-staging.iaqar-ai.workers.dev");
  const production = runtimeFor("iaqar.ai");
  assert.equal(production.worker, "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev");
  assert.equal(production.project, "aqar-b5d76");
});

test("preview deploy is fenced to the preview channel and preview Worker", () => {
  const script = read("scripts/deploy-office-os-preview.sh").split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
  assert.match(script, /CHANNEL="office-os-preview"/);
  assert.match(script, /wrangler deploy --env preview/);
  assert.ok(!/--env staging|--env production|channel:deploy staging|aqar-b5d76|firebase deploy/.test(script), "never touches staging channel/Worker or production");
  const toml = read("worker/wrangler.toml");
  assert.match(toml, /\[env\.preview\]\nname = "iaqar-intake-os-preview"/);
  assert.match(toml, /\[env\.preview\.triggers\]\ncrons = \[\]/);
});
