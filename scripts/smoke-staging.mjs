#!/usr/bin/env node
/**
 * Phase 9A — post-deploy smoke checks for full-functional staging.
 * Usage:
 *   node scripts/smoke-staging.mjs
 *   STAGING_HOSTING_URL=https://…--staging-….web.app node scripts/smoke-staging.mjs
 */

const STAGING_WORKER = process.env.STAGING_WORKER_URL
  || "https://iaqar-intake-staging.iaqar-ai.workers.dev";
const STAGING_HOSTING = process.env.STAGING_HOSTING_URL || "";
const REQUIRE_BACKEND = process.env.STAGING_REQUIRE_BACKEND !== "0";

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
    if (json.cronEnabled === true) throw new Error("cronEnabled must be false on staging");
    if (REQUIRE_BACKEND) {
      if (json.firebaseConfigured !== true) {
        throw new Error("firebaseConfigured must be true for full-functional staging");
      }
      if (json.backendReady !== true) {
        throw new Error("backendReady must be true for full-functional staging");
      }
    }
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
      if (text.includes("aqar-b5d76.web.app/__/firebase/init.js")) {
        throw new Error("staging shell must use channel-local /__/firebase/init.js");
      }
      if (!text.includes("/__/firebase/init.js")) {
        throw new Error("staging shell missing /__/firebase/init.js");
      }
      if (text.includes('data-main="deals"')) {
        throw new Error("staging shell must not include deals navigation");
      }
    });

    const runtimeUrl = new URL("/js/runtime-config.js", STAGING_HOSTING).toString();
    await mustOk(runtimeUrl, ({ text }) => {
      if (!text.includes("iaqar-intake-staging")) {
        throw new Error("runtime-config.js must reference iaqar-intake-staging");
      }
      if (!text.includes("resolveWorkerBase")) {
        throw new Error("runtime-config.js must export resolveWorkerBase");
      }
    });
  } else {
    console.log("SKIP hosting smoke (set STAGING_HOSTING_URL to enable)");
  }

  console.log("Phase 9A full-functional staging smoke passed");
}

main().catch((error) => {
  console.error("Phase 9A staging smoke FAILED:", error.message || error);
  process.exit(1);
});
