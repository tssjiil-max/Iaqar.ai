/**
 * Phase 9A — runtime deployment config.
 * Staging Firebase Hosting channels (`--staging`) talk to the staging Worker only.
 * Production hosts keep the production Worker. Never invent a second Firebase project here.
 */
(function () {
  "use strict";

  const PRODUCTION_WORKER = "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
  const STAGING_WORKER = "https://iaqar-intake-staging.iaqar-ai.workers.dev";

  function hostname() {
    try {
      return String(window.location && window.location.hostname || "").toLowerCase();
    } catch (_) {
      return "";
    }
  }

  function queryEnv() {
    try {
      return String(new URLSearchParams(window.location.search).get("env") || "").toLowerCase();
    } catch (_) {
      return "";
    }
  }

  function detectEnvironment() {
    const host = hostname();
    const env = queryEnv();
    // Explicit override for local smoke of staging wiring.
    if (env === "staging") return "staging";
    if (env === "production" || env === "prod") return "production";
    // Firebase Hosting preview channels: {project}--{channel}-{hash}.web.app
    if (host.includes("--staging")) return "staging";
    if (host.startsWith("staging.") || host.startsWith("staging-")) return "staging";
    return "production";
  }

  const deploymentEnvironment = detectEnvironment();
  const workerBase = deploymentEnvironment === "staging" ? STAGING_WORKER : PRODUCTION_WORKER;

  window.IAQAR = window.IAQAR || {};
  window.IAQAR.deploymentEnvironment = deploymentEnvironment;
  window.IAQAR.workerBase = workerBase;
  window.IAQAR.PRODUCTION_WORKER = PRODUCTION_WORKER;
  window.IAQAR.STAGING_WORKER = STAGING_WORKER;

  window.dispatchEvent(new CustomEvent("iaqar:runtime-config-ready", {
    detail: { deploymentEnvironment, workerBase }
  }));
})();
