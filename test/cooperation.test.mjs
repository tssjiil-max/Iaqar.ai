// Phase 1 cooperation setting only. Directive §7.7 and §19: three modes, default
// "approval required", and automatic cooperation must never expose contact information.
// Cooperation records themselves are Phase 6 and are deliberately not asserted here.

import test from "node:test";
import assert from "node:assert/strict";
import {
  COOPERATION_MODES,
  COOPERATION_MODE_VALUES,
  COOPERATION_STATUS_LABELS,
  DEFAULT_COOPERATION_MODE,
  cooperationSettingsPayload,
  cooperationStatusLabel,
  normalizeCooperationMode
} from "../public/js/office-domain.js";
import { readRepositoryFile } from "./helpers/shell.mjs";

test("exactly the three approved cooperation modes exist", () => {
  assert.deepEqual([...COOPERATION_MODE_VALUES], ["DISABLED", "APPROVAL_REQUIRED", "SMART_AUTOMATIC"]);
  assert.equal(COOPERATION_MODES.length, 3);
  for (const mode of COOPERATION_MODES) {
    assert.ok(mode.label && mode.label.trim(), mode.value);
    assert.ok(mode.help && mode.help.trim(), `${mode.value} needs an explanation for the broker`);
  }
});

test("the default mode is approval required", () => {
  assert.equal(DEFAULT_COOPERATION_MODE, "APPROVAL_REQUIRED");
});

test("unknown, empty and malformed modes fall back to approval required", () => {
  for (const value of ["", null, undefined, "OPEN", "smart", "auto", 7, {}, []]) {
    assert.equal(normalizeCooperationMode(value), "APPROVAL_REQUIRED", JSON.stringify(value));
  }
});

test("mode normalization is case-insensitive and whitespace-tolerant", () => {
  assert.equal(normalizeCooperationMode("disabled"), "DISABLED");
  assert.equal(normalizeCooperationMode("  smart_automatic  "), "SMART_AUTOMATIC");
  assert.equal(normalizeCooperationMode("Approval_Required"), "APPROVAL_REQUIRED");
});

test("automatic cooperation can never be configured to expose contact information", () => {
  for (const mode of COOPERATION_MODE_VALUES) {
    const payload = cooperationSettingsPayload(mode);
    assert.equal(payload.mode, mode);
    assert.equal(payload.exposeContactAutomatically, false, mode);
  }
  // Even if a caller tries to force it on, the payload must not carry it.
  assert.equal(cooperationSettingsPayload("SMART_AUTOMATIC").exposeContactAutomatically, false);
});

test("the payload carries only the two approved fields", () => {
  assert.deepEqual(
    Object.keys(cooperationSettingsPayload("DISABLED")).sort(),
    ["exposeContactAutomatically", "mode"]
  );
});

test("the five approved Arabic cooperation statuses are available verbatim", () => {
  assert.deepEqual(Object.values(COOPERATION_STATUS_LABELS), [
    "لم تُشارك",
    "بانتظار الموافقة",
    "تعاون نشط",
    "رُفض الطلب",
    "انتهى التعاون"
  ]);
});

test("an unknown cooperation status reads as not shared rather than inventing a label", () => {
  assert.equal(cooperationStatusLabel(undefined), "لم تُشارك");
  assert.equal(cooperationStatusLabel("WHATEVER"), "لم تُشارك");
  assert.equal(cooperationStatusLabel("active"), "تعاون نشط");
  assert.equal(cooperationStatusLabel("ENDED"), "انتهى التعاون");
});

test("the settings sheet offers the approved heading and exactly three radio choices", () => {
  const shell = readRepositoryFile("public", "index.html");
  assert.ok(shell.includes("التعاون بين المكاتب"), "the approved Arabic heading must be present");
  const values = [...shell.matchAll(/name="cooperationMode"\s+value="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(values, ["DISABLED", "APPROVAL_REQUIRED", "SMART_AUTOMATIC"]);
});

test("approval required is the pre-selected choice in the shell", () => {
  const shell = readRepositoryFile("public", "index.html");
  const checked = [...shell.matchAll(/name="cooperationMode"\s+value="([^"]+)"\s+checked/g)].map(m => m[1]);
  assert.deepEqual(checked, ["APPROVAL_REQUIRED"]);
});

test("Phase 1 does not claim any cooperation capability beyond the setting", () => {
  // Sharing, requests, approval and revocation are Phase 6. Nothing may pretend otherwise.
  const settings = readRepositoryFile("public", "js", "office-settings.js");
  for (const name of ["cooperationRequests", "acceptCooperation", "revokeCooperation"]) {
    assert.equal(settings.includes(name), false, `${name} belongs to Phase 6`);
  }
});
