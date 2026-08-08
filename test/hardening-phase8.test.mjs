/**
 * Phase 8 — Hardening: rate limits, PWA/a11y smoke, catch-all tightening, dead-code cleanup.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  evaluatePublicRateLimit,
  consumePublicRateLimit,
  publicRateLimitKey,
  resetPublicRateLimitStoreForTests,
  PUBLIC_RATE_LIMITS
} from "../worker/src/public-rate-limit.js";
import worker, {
  evaluatePublicRateLimit as exportedEvaluate,
  resetPublicRateLimitStoreForTests as resetFromWorker
} from "../worker/src/index.js";
import { firebaseStub, loadShell, readRepositoryFile } from "./helpers/shell.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("Phase 8 rate-limit evaluator opens a new window and blocks after limit", () => {
  const now = 1_700_000_000_000;
  let state = {};
  for (let i = 1; i <= 30; i += 1) {
    const result = evaluatePublicRateLimit(state, {
      now,
      limit: PUBLIC_RATE_LIMITS.PUBLIC_INTAKE.limit,
      windowMs: PUBLIC_RATE_LIMITS.PUBLIC_INTAKE.windowMs
    });
    assert.equal(result.ok, true, `attempt ${i}`);
    state = result.nextState;
  }
  const blocked = evaluatePublicRateLimit(state, {
    now,
    limit: PUBLIC_RATE_LIMITS.PUBLIC_INTAKE.limit,
    windowMs: PUBLIC_RATE_LIMITS.PUBLIC_INTAKE.windowMs
  });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSec >= 1);

  const rolled = evaluatePublicRateLimit(state, {
    now: now + PUBLIC_RATE_LIMITS.PUBLIC_INTAKE.windowMs + 1,
    limit: PUBLIC_RATE_LIMITS.PUBLIC_INTAKE.limit,
    windowMs: PUBLIC_RATE_LIMITS.PUBLIC_INTAKE.windowMs
  });
  assert.equal(rolled.ok, true);
  assert.equal(exportedEvaluate({}, { now, limit: 1, windowMs: 1000 }).ok, true);
});

test("Phase 8 in-memory consumePublicRateLimit keys by route/ip/office", () => {
  resetPublicRateLimitStoreForTests();
  resetFromWorker();
  const key = publicRateLimitKey({ route: "pipeline/public-intake", ip: "1.2.3.4", officeId: "office-a" });
  for (let i = 0; i < PUBLIC_RATE_LIMITS.PUBLIC_INTAKE.limit; i += 1) {
    assert.equal(consumePublicRateLimit(key, { ...PUBLIC_RATE_LIMITS.PUBLIC_INTAKE }).ok, true);
  }
  assert.equal(consumePublicRateLimit(key, { ...PUBLIC_RATE_LIMITS.PUBLIC_INTAKE }).ok, false);
  // Different office keeps its own budget.
  const other = publicRateLimitKey({ route: "pipeline/public-intake", ip: "1.2.3.4", officeId: "office-b" });
  assert.equal(consumePublicRateLimit(other, { ...PUBLIC_RATE_LIMITS.PUBLIC_INTAKE }).ok, true);
});

test("Phase 8 public intake route returns 429 when rate-limited", async () => {
  resetFromWorker();
  const env = { FIREBASE_PROJECT_ID: "aqar-b5d76" };
  const headers = {
    "Content-Type": "application/json",
    "CF-Connecting-IP": "203.0.113.99"
  };
  const body = JSON.stringify({ officeId: "office-rate", intakeId: "intake12345" });
  for (let i = 0; i < PUBLIC_RATE_LIMITS.PUBLIC_INTAKE.limit; i += 1) {
    const response = await worker.fetch(new Request("https://example.test/pipeline/public-intake", {
      method: "POST",
      headers,
      body
    }), env);
    // Until the bucket is full these fail for missing secrets, not rate limit.
    assert.notEqual(response.status, 429, `pre-limit attempt ${i + 1}`);
  }
  const blocked = await worker.fetch(new Request("https://example.test/pipeline/public-intake", {
    method: "POST",
    headers,
    body
  }), env);
  assert.equal(blocked.status, 429);
  const payload = await blocked.json();
  assert.equal(payload.error, "rate_limited");
  assert.ok(String(payload.message || "").includes("حد الطلبات") || String(payload.message || "").length > 0);
});

test("Phase 8 PWA: manifest has no deals shortcut; icons and SW cache are current", () => {
  const manifest = JSON.parse(readRepositoryFile("public", "manifest.webmanifest"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.dir, "rtl");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
  for (const icon of manifest.icons) {
    assert.ok(existsSync(path.join(root, "public", icon.src.replace(/^\//, ""))), icon.src);
  }
  const shortcutText = JSON.stringify(manifest.shortcuts || []);
  assert.equal(shortcutText.includes("الصفقات"), false);
  assert.equal(shortcutText.includes("open=deals"), false);
  assert.ok(shortcutText.includes("open=operations") || shortcutText.includes("open=add-opportunity"));

  const sw = readRepositoryFile("public", "firebase-messaging-sw.js");
  assert.ok(sw.includes("iaqar-shell-phase9a-v2"));
  assert.ok(sw.includes("runtime-config.js"));
  assert.ok(sw.includes("/js/operations-domain-bridge.js"));
  assert.ok(sw.includes("/js/messaging-domain-bridge.js"));
  assert.ok(sw.includes("/js/add-opportunity.js"));
  assert.ok(sw.includes("/icons/default-office.png"));
  assert.ok(existsSync(path.join(root, "public/icons/default-office.png")));
});

test("Phase 8 shell: logos are file assets, not duplicated base64; public-intake dead code gone", () => {
  const shell = readRepositoryFile("public", "index.html");
  assert.equal(shell.includes("data:image/png;base64,"), false);
  assert.ok(shell.includes('/icons/default-office.png'));
  assert.equal(existsSync(path.join(root, "public/js/public-intake.js")), false);
  assert.ok(shell.includes('rel="manifest"') || shell.includes("manifest.webmanifest"));

  const workflow = readRepositoryFile("public", "js", "workflow-office.js");
  assert.equal(workflow.includes("function localMatchScore"), false);
  assert.equal(workflow.includes("function readinessFromLocalScore"), false);
  assert.ok(workflow.includes('update_deal_fields'));
});

test("Phase 8 a11y smoke: Office Card and dialogs keep accessible names", async () => {
  const shell = await loadShell({ firebase: firebaseStub(), officeRuntime: { officeId: "office-a" } });
  try {
    const { document } = shell;
    const logoBtn = document.getElementById("officeSettingsBtn");
    assert.ok(logoBtn, "office logo control exists");
    assert.match(logoBtn.getAttribute("aria-label") || "", /إعدادات المكتب/);

    const coverWrap = document.getElementById("officeCardCoverWrap");
    assert.ok(coverWrap, "cover banner region exists");

    const settingsDialog = document.querySelector(".settings-sheet[role='dialog'][aria-modal='true']");
    assert.ok(settingsDialog, "settings dialog is modal");

    const live = document.getElementById("addOpportunityStatus");
    assert.ok(live);
    assert.equal(live.getAttribute("aria-live"), "polite");

    // No bottom nav / deals page regressions.
    assert.equal(document.querySelector("[data-main='deals']"), null);
    assert.equal(/bottom-nav|bottom_nav|bottomNav/.test(document.documentElement.innerHTML), false);
  } finally {
    shell.close();
  }
});

test("Phase 8 Worker wires rate-limit module and deal field updates", () => {
  const workerSrc = readRepositoryFile("worker", "src", "index.js");
  assert.ok(workerSrc.includes('from "./public-rate-limit.js"'));
  assert.ok(workerSrc.includes("enforcePublicRouteRateLimit"));
  assert.ok(workerSrc.includes('action==="update_deal_fields"'));
  assert.ok(workerSrc.includes("rate_limited"));
});
