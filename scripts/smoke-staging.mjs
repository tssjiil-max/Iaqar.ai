#!/usr/bin/env node
/**
 * Phase 9A — post-deploy smoke checks for staging Worker (+ optional Hosting URL).
 * Usage:
 *   node scripts/smoke-staging.mjs
 *   STAGING_HOSTING_URL=https://…--staging-….web.app node scripts/smoke-staging.mjs
 */

const STAGING_WORKER = process.env.STAGING_WORKER_URL
  || "https://iaqar-intake-staging.iaqar-ai.workers.dev";
const STAGING_HOSTING = process.env.STAGING_HOSTING_URL || "";

async function mustOk(url, assertFn) {
  const response = await fetch(url, { redirect: "follow" });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* html ok */ }
  if (!response.ok) {
    throw new Error(`${url} → HTTP ${response.status}`);
  }
  if (assertFn) assertFn({ response, text, json, url });
  console.log(`OK ${url}`);
}

async function main() {
  await mustOk(`${STAGING_WORKER}/health`, ({ json }) => {
    if (!json || json.ok !== true) throw new Error("health.ok != true");
    if (json.deploymentEnvironment !== "staging") {
      throw new Error(`expected deploymentEnvironment=staging, got ${json.deploymentEnvironment}`);
    }
    if (json.outboundMessaging === true) throw new Error("outboundMessaging must be false");
  });

  await mustOk(`${STAGING_WORKER}/messages/adapters`, ({ json }) => {
    if (!json || json.ok !== true) throw new Error("adapters.ok != true");
    if (json.boundaries?.sendsWhatsApp === true) throw new Error("sendsWhatsApp must be false");
  });

  // Outbound Cloud API must stay blocked on staging too.
  const blocked = await fetch(`${STAGING_WORKER}/meta/messages`, { method: "POST" });
  if (blocked.status !== 403) {
    throw new Error(`/meta/messages expected 403, got ${blocked.status}`);
  }
  console.log(`OK ${STAGING_WORKER}/meta/messages → 403`);

  if (STAGING_HOSTING) {
    if (!STAGING_HOSTING.includes("--staging") && !/staging/i.test(STAGING_HOSTING)) {
      throw new Error("STAGING_HOSTING_URL does not look like a staging channel URL");
    }
    await mustOk(STAGING_HOSTING, ({ text }) => {
      if (!text.includes("runtime-config.js")) {
        throw new Error("staging hosting shell missing runtime-config.js");
      }
      if (text.includes('data-main="deals"')) {
        throw new Error("staging shell must not include deals navigation");
      }
    });
  } else {
    console.log("SKIP hosting smoke (set STAGING_HOSTING_URL to enable)");
  }

  console.log("Phase 9A staging smoke passed");
}

main().catch((error) => {
  console.error("Phase 9A staging smoke FAILED:", error.message || error);
  process.exit(1);
});
