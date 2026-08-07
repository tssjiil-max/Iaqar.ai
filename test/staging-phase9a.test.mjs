/**
 * Phase 9A — full-functional staging kit for project iaqar-ai-staging.
 * Does not perform a live deploy.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { JSDOM } from "jsdom";
import {
  createServiceAccountJwt,
  parseFirebaseServiceAccountJson
} from "../scripts/staging-credentials.mjs";
import { deployStagingFirestoreRules } from "../scripts/deploy-firestore-rules-staging.mjs";

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
  assert.ok(stagingBlock.includes("[env.staging.ai]"));
  assert.ok(stagingBlock.includes('binding = "AI"'));
  assert.equal(toml.slice(0, toml.indexOf("[env.staging]")).includes("[ai]"), false);
  assert.ok(/crons\s*=\s*\[\s*\]/.test(stagingBlock) || stagingBlock.includes("crons = []"));

  const rc = JSON.parse(read(".firebaserc"));
  assert.equal(rc.projects.default, "aqar-b5d76");
  assert.equal(rc.projects.staging, "iaqar-ai-staging");
});

test("Phase 9A deploy script uses SA GAC, not FIREBASE_TOKEN", () => {
  const script = read("scripts", "deploy-staging.sh");
  assert.ok(script.includes("wrangler deploy --env staging"));
  assert.ok(script.includes("deploy-firestore-rules-staging.mjs"));
  assert.ok(script.includes("hosting:channel:deploy staging"));
  assert.ok(script.includes("iaqar-ai-staging"));
  assert.ok(script.includes("FIREBASE_SERVICE_ACCOUNT_JSON"));
  assert.equal(script.includes('die "FIREBASE_CLIENT_EMAIL'), false); // pragma: allowlist secret
  assert.equal(script.includes('die "FIREBASE_PRIVATE_KEY'), false); // pragma: allowlist secret
  assert.ok(script.includes("GOOGLE_APPLICATION_CREDENTIALS"));
  assert.ok(script.includes("staging-gac.mjs"));
  assert.ok(script.includes("preflight-staging.mjs"));
  assert.ok(script.includes("npm run test:phase9a"));
  assert.ok(script.includes("backendReady"));
  assert.ok(script.includes("opportunityExtractionReady"));
  assert.ok(script.includes("smoke-staging.mjs"));
  assert.ok(script.includes("cannot deploy production") || script.includes("Refusing"));
  // Must not require FIREBASE_TOKEN or pass it to firebase-tools (ignore-note is OK).
  assert.equal(/FIREBASE_TOKEN is required/.test(script), false);
  assert.equal(/die "FIREBASE_TOKEN/.test(script), false);
  assert.equal(/--token\s+"?\$\{?FIREBASE_TOKEN/.test(script), false);
  assert.equal(/firebase deploy --only hosting/.test(script), false);
  assert.equal(/^\s*(?:\.\/)?deploy-all/m.test(script), false);

  const ps1 = read("scripts", "deploy-staging.ps1");
  assert.ok(ps1.includes("FIREBASE_SERVICE_ACCOUNT_JSON"));
  assert.equal(ps1.includes('Die "FIREBASE_CLIENT_EMAIL'), false); // pragma: allowlist secret
  assert.equal(ps1.includes('Die "FIREBASE_PRIVATE_KEY'), false); // pragma: allowlist secret
  assert.ok(ps1.includes("GOOGLE_APPLICATION_CREDENTIALS"));
  assert.ok(ps1.includes("preflight-staging.mjs"));
  assert.ok(ps1.includes("npm run test:phase9a"));
  assert.ok(ps1.includes("opportunityExtractionReady"));
  assert.ok(ps1.includes("deploy-firestore-rules-staging.mjs"));
  assert.equal(ps1.includes("--token $env:FIREBASE_TOKEN"), false);
  assert.ok(ps1.includes("iaqar-ai-staging"));

  assert.ok(existsSync(path.join(root, "scripts", "staging-gac.mjs")));
  assert.ok(existsSync(path.join(root, "scripts", "staging-credentials.mjs")));
  assert.ok(existsSync(path.join(root, "scripts", "preflight-staging.mjs")));
  assert.ok(existsSync(path.join(root, "scripts", "deploy-firestore-rules-staging.mjs")));
  assert.ok(existsSync(path.join(root, "docs", "STAGING-DEPLOY.md")));
});

test("Phase 9A deploys and verifies Firestore rules through the staging-only Rules API", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "iaqar-rules-deploy-"));
  const gacPath = path.join(dir, "sa.json");
  const rulesPath = path.join(dir, "firestore.rules");
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });
  writeFileSync(gacPath, JSON.stringify({
    type: "service_account",
    project_id: "iaqar-ai-staging",
    private_key_id: "0123456789abcdef0123456789abcdef01234567", // pragma: allowlist secret
    private_key: privateKey, // pragma: allowlist secret
    client_email: "rules@iaqar-ai-staging.iam.gserviceaccount.com" // pragma: allowlist secret
  }));
  writeFileSync(rulesPath, "rules_version = '2';");

  const calls = [];
  const rulesetName = "projects/iaqar-ai-staging/rulesets/ruleset-test";
  const releaseName = "projects/iaqar-ai-staging/releases/cloud.firestore";
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body });
    if (calls.length === 1) return Response.json({ access_token: "test-access-token" }); // pragma: allowlist secret
    if (calls.length === 2) return Response.json({ name: rulesetName });
    return Response.json({ name: releaseName, rulesetName });
  };

  try {
    const result = await deployStagingFirestoreRules({ gacPath, rulesPath, fetchImpl });
    assert.equal(result.projectId, "iaqar-ai-staging");
    assert.equal(result.rulesetName, rulesetName);
    assert.deepEqual(calls.map(call => call.method), ["POST", "POST", "PATCH", "GET"]);
    assert.ok(calls.every(call => !call.url.includes("aqar-b5d76")));
    const source = JSON.parse(calls[1].body).source.files[0];
    assert.deepEqual(source, { name: "firestore.rules", content: "rules_version = '2';" });
    const update = JSON.parse(calls[2].body);
    assert.equal(update.release.rulesetName, rulesetName);
    assert.equal(update.updateMask, "rulesetName");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Phase 9A staging-gac parses a complete JSON secret and writes private temp credentials", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "iaqar-gac-"));
  const out = path.join(dir, "sa.json");
  const secretDir = path.join(dir, "normalized");
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });
  const keyId = "0123456789abcdef0123456789abcdef01234567";
  const serviceAccount = {
    type: "service_account",
    project_id: "iaqar-ai-staging",
    private_key_id: keyId, // pragma: allowlist secret
    private_key: privateKey.replace(/\n/g, "\\n"), // pragma: allowlist secret
    client_email: "sa@iaqar-ai-staging.iam.gserviceaccount.com", // pragma: allowlist secret
    token_uri: "https://oauth2.googleapis.com/token"
  };
  const mkdir = spawnSync(process.execPath, ["-e", `require("fs").mkdirSync(${JSON.stringify(secretDir)})`]);
  assert.equal(mkdir.status, 0);

  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts", "staging-gac.mjs"), out, secretDir],
    {
      env: {
        ...process.env,
        FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(JSON.stringify(serviceAccount)),
        FIREBASE_STAGING_PROJECT_ID: "iaqar-ai-staging"
      },
      encoding: "utf8"
    }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.includes("BEGIN PRIVATE KEY"), false);
  assert.equal(result.stdout.includes(keyId), false);
  assert.equal(result.stdout.includes("sa@"), false);

  const parsed = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(parsed.type, "service_account");
  assert.equal(parsed.project_id, "iaqar-ai-staging");
  assert.equal(parsed.client_email, "sa@iaqar-ai-staging.iam.gserviceaccount.com"); // pragma: allowlist secret
  assert.equal(parsed.private_key_id, keyId); // pragma: allowlist secret
  assert.ok(parsed.private_key.startsWith("-----BEGIN PRIVATE KEY-----")); // pragma: allowlist secret
  assert.ok(parsed.private_key.includes("\n")); // pragma: allowlist secret
  assert.equal(readFileSync(path.join(secretDir, "FIREBASE_CLIENT_EMAIL"), "utf8"), parsed.client_email); // pragma: allowlist secret
  assert.equal(readFileSync(path.join(secretDir, "FIREBASE_PRIVATE_KEY_ID"), "utf8"), parsed.private_key_id); // pragma: allowlist secret
  assert.equal(readFileSync(path.join(secretDir, "FIREBASE_PRIVATE_KEY"), "utf8"), parsed.private_key); // pragma: allowlist secret
  unlinkSync(out);
  rmSync(dir, { recursive: true, force: true });
});

test("Phase 9A complete JSON secret normalization preserves a valid PKCS8 PEM", () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });
  const keyId = "abcdef0123456789abcdef0123456789abcdef01";
  const raw = JSON.stringify({
    type: "service_account",
    project_id: "iaqar-ai-staging",
    private_key_id: keyId, // pragma: allowlist secret
    private_key: privateKey.replace(/\n/g, "\\n"), // pragma: allowlist secret
    client_email: "firebase-admin@iaqar-ai-staging.iam.gserviceaccount.com" // pragma: allowlist secret
  });
  const { serviceAccount, invalidFields } = parseFirebaseServiceAccountJson(raw, "iaqar-ai-staging");

  assert.deepEqual(invalidFields, []);
  assert.ok(serviceAccount.private_key.startsWith("-----BEGIN PRIVATE KEY-----")); // pragma: allowlist secret
  assert.ok(serviceAccount.private_key.endsWith("-----END PRIVATE KEY-----\n")); // pragma: allowlist secret
  assert.equal(serviceAccount.private_key.includes("\\n"), false); // pragma: allowlist secret

  const jwt = createServiceAccountJwt(serviceAccount, 1_700_000_000);
  assert.equal(jwt.split(".").length, 3);
});

test("Phase 9A invalid JSON fields are named without printing their values", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "iaqar-invalid-gac-"));
  const out = path.join(dir, "sa.json");
  const invalidServiceAccount = {
    type: "wrong-type-sensitive",
    project_id: "wrong-project-sensitive",
    private_key_id: "not-a-key-id-sensitive", // pragma: allowlist secret
    private_key: "not-a-private-key-sensitive", // pragma: allowlist secret
    client_email: "not-an-email-sensitive" // pragma: allowlist secret
  };
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "staging-gac.mjs"), out], {
    env: {
      ...process.env,
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(invalidServiceAccount),
      FIREBASE_STAGING_PROJECT_ID: "iaqar-ai-staging"
    },
    encoding: "utf8"
  });

  assert.equal(result.status, 1);
  for (const field of ["type", "project_id", "client_email", "private_key_id", "private_key"]) { // pragma: allowlist secret
    assert.ok(result.stderr.includes(`FIREBASE_SERVICE_ACCOUNT_JSON.${field}`), field);
  }
  for (const value of Object.values(invalidServiceAccount)) {
    assert.equal(result.stderr.includes(value), false);
  }
  assert.equal(existsSync(out), false);
  rmSync(dir, { recursive: true, force: true });
});

test("Phase 9A Cloudflare preflight uses account APIs and disposable permission probes", () => {
  const preflight = read("scripts", "preflight-staging.mjs");
  assert.equal(preflight.includes("/user/tokens/verify"), false);
  assert.ok(preflight.includes("/workers/scripts/"));
  assert.ok(preflight.includes("/r2/buckets"));
  assert.ok(preflight.includes('method: "PUT"'));
  assert.ok(preflight.includes('method: "POST"'));
  assert.ok(preflight.includes('method: "DELETE"'));
  assert.ok(preflight.includes("iaqar-media"));
  assert.ok(preflight.includes("firebasehosting.googleapis.com"));
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
  assert.ok(read("scripts", "smoke-staging.mjs").includes("opportunityExtractionReady"));
});
