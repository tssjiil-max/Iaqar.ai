import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { normalizeOwnerBundle } from "../public/js/coordination-bundle-domain.js";

const rootDir = path.resolve(import.meta.dirname, "..");

test("decision-package submit resolves party from the form shell, not the outer mount root", () => {
  const source = readFileSync(path.join(rootDir, "public", "js", "party-entry.js"), "utf8");
  const start = source.indexOf("function bindDecisionPackage");
  const end = source.indexOf("function bindCoordinationForm", start);
  assert.ok(start >= 0 && end > start, "bindDecisionPackage must exist");
  const binding = source.slice(start, end);

  assert.match(binding, /const party = form\.closest\("\[data-party-shell\]"\)\?\.getAttribute\("data-party"\) \|\| "client";/);
  assert.doesNotMatch(binding, /const party = root\.closest\("\[data-party-shell\]"\)/);
});

test("owner decision form is inside the owner shell while partyRoot is outside it", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="partyRoot">
      <main data-party-shell data-party="owner">
        <div data-party-decision-package data-workflow-step="owner_viewing"></div>
      </main>
    </div>
  </body>`);
  const mountRoot = dom.window.document.getElementById("partyRoot");
  const form = dom.window.document.querySelector("[data-party-decision-package]");

  assert.equal(mountRoot.closest("[data-party-shell]"), null);
  assert.equal(form.closest("[data-party-shell]").getAttribute("data-party"), "owner");
});

test("owner viewing bundle requires owner availability semantics and then normalizes", () => {
  assert.equal(normalizeOwnerBundle({
    viewingAllowed: "yes",
    viewingDays: ["tomorrow"],
    viewingPeriods: ["morning"]
  }), null);

  const normalized = normalizeOwnerBundle({
    propertyAvailability: "available",
    viewingAllowed: "yes",
    viewingDays: ["tomorrow"],
    viewingPeriods: ["morning"]
  });

  assert.ok(normalized);
  assert.equal(normalized.propertyAvailability, "available");
  assert.equal(normalized.viewingAllowed, "yes");
  assert.deepEqual(normalized.viewingDays, ["tomorrow"]);
  assert.deepEqual(normalized.viewingPeriods, ["morning"]);
});
