/**
 * Runtime deployment config for staging vs production Worker routing.
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
    if (env === "staging") return "staging";
    if (env === "production" || env === "prod") return "production";
    if (host.includes("--staging-") || host.includes("iaqar-ai-staging")) return "staging";
    return "production";
  }

  const environment = detectEnvironment();
  window.IAQAR_RUNTIME = Object.freeze({
    environment,
    workerBase: environment === "staging" ? STAGING_WORKER : PRODUCTION_WORKER
  });
})();
