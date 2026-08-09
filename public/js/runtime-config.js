/**
 * Phase 9A — runtime deployment config.
 * Staging Firebase Hosting channels (`--staging`) talk to the staging Worker only.
 * Production hosts keep the production Worker. Never invent a second Firebase project here.
 *
 * Full-functional staging also requires Worker Firebase secrets
 * (FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY / FIREBASE_PRIVATE_KEY_ID on --env staging).
 * Without those secrets the shell can render but backend APIs return firebase_not_configured.
 */
(function () {
  "use strict";

  const PRODUCTION_WORKER = "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
  const STAGING_WORKER = "https://iaqar-intake-staging.iaqar-ai.workers.dev";
  const PRODUCTION_FIREBASE_PROJECT = "aqar-b5d76";
  const STAGING_FIREBASE_PROJECT = "iaqar-ai-staging";

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
    // Firebase default site for project iaqar-ai-staging (not only preview channels).
    if (host.includes("iaqar-ai-staging")) return "staging";
    // Firebase Hosting preview channels: {project}--{channel}-{hash}.web.app
    if (host.includes("--staging")) return "staging";
    if (host.startsWith("staging.") || host.startsWith("staging-")) return "staging";
    return "production";
  }

  function resolveWorkerBase() {
    const env = window.IAQAR && window.IAQAR.deploymentEnvironment
      ? window.IAQAR.deploymentEnvironment
      : detectEnvironment();
    if (window.IAQAR && window.IAQAR.workerBase) {
      return String(window.IAQAR.workerBase).replace(/\/$/, "");
    }
    // Fail closed: staging hosts never fall back to the production Worker.
    if (env === "staging") return STAGING_WORKER;
    return PRODUCTION_WORKER;
  }

  const deploymentEnvironment = detectEnvironment();
  const workerBase = deploymentEnvironment === "staging" ? STAGING_WORKER : PRODUCTION_WORKER;
  const firebaseProjectId = deploymentEnvironment === "staging"
    ? STAGING_FIREBASE_PROJECT
    : PRODUCTION_FIREBASE_PROJECT;

  window.IAQAR = window.IAQAR || {};
  window.IAQAR.deploymentEnvironment = deploymentEnvironment;
  window.IAQAR.workerBase = workerBase;
  window.IAQAR.firebaseProjectId = firebaseProjectId;
  window.IAQAR.PRODUCTION_WORKER = PRODUCTION_WORKER;
  window.IAQAR.STAGING_WORKER = STAGING_WORKER;
  window.IAQAR.PRODUCTION_FIREBASE_PROJECT = PRODUCTION_FIREBASE_PROJECT;
  window.IAQAR.STAGING_FIREBASE_PROJECT = STAGING_FIREBASE_PROJECT;
  window.IAQAR.resolveWorkerBase = resolveWorkerBase;
  window.IAQAR.detectEnvironment = detectEnvironment;

  window.dispatchEvent(new CustomEvent("iaqar:runtime-config-ready", {
    detail: { deploymentEnvironment, workerBase, firebaseProjectId }
  }));
})();
