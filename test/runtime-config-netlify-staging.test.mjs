import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/js/runtime-config.js", import.meta.url), "utf8");

function runRuntimeConfig(hostname, search = "") {
  const events = [];
  const window = {
    location: { hostname, search },
    IAQAR: {},
    dispatchEvent(event) { events.push(event); }
  };
  class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  vm.runInNewContext(source, { window, URLSearchParams, CustomEvent });
  return { window, events };
}

function assertStagingRuntime(hostname) {
  const { window } = runRuntimeConfig(hostname);
  assert.equal(window.IAQAR.deploymentEnvironment, "staging");
  assert.equal(window.IAQAR.workerBase, "https://iaqar-intake-staging.iaqar-ai.workers.dev");
  assert.equal(window.IAQAR.firebaseProjectId, "iaqar-ai-staging");
}

test("Netlify iaqar-one staging hostname is fail-closed to staging services", () => {
  assertStagingRuntime("iaqar-one-staging.netlify.app");
});

test("Netlify deploy previews for iaqar-one staging stay on staging services", () => {
  assertStagingRuntime("deploy-preview-42--iaqar-one-staging.netlify.app");
  assertStagingRuntime("feature-match-review--iaqar-one-staging.netlify.app");
});

test("production hostname remains production", () => {
  const { window } = runRuntimeConfig("iaqar.ai");
  assert.equal(window.IAQAR.deploymentEnvironment, "production");
  assert.equal(window.IAQAR.firebaseProjectId, "aqar-b5d76");
});
