import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPilotFeatureEnabled,
  invalidatePilotAccessCache,
  pilotConfigFromFirestoreFields
} from "../src/pilot-access-service.js";
import { PILOT_FEATURE_DISABLED } from "../../public/js/pilot-access-domain.js";

function jsToFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((item) => jsToFirestoreValue(item)) } };
  }
  return { stringValue: String(value) };
}

function firestoreValueToJs(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map(firestoreValueToJs);
  return null;
}

function firestoreFieldsToJs(fields) {
  const output = {};
  for (const [key, value] of Object.entries(fields || {})) output[key] = firestoreValueToJs(value);
  return output;
}

function pilotDeps(configFields) {
  return {
    projectId: "aqar-b5d76",
    accessToken: "token",
    firestoreFieldsToJs,
    async getFirestoreDocument() {
      return { fields: configFields };
    }
  };
}

function enabledPilotFlags(overrides = {}) {
  return {
    enabled: jsToFirestoreValue(true),
    maxOffices: jsToFirestoreValue(5),
    authorizedOfficeIds: jsToFirestoreValue(["office-a"]),
    featureFlagsJson: jsToFirestoreValue(JSON.stringify({
      matching: true,
      publicOpportunityRouting: true,
      pushNotifications: true,
      crossOfficeCollaboration: true,
      ...overrides
    }))
  };
}

const FEATURE_KEYS = [
  "matching",
  "publicOpportunityRouting",
  "pushNotifications",
  "crossOfficeCollaboration"
];

for (const featureKey of FEATURE_KEYS) {
  test(`${featureKey} kill switch blocks new execution when pilot enabled and flag=false`, async () => {
    invalidatePilotAccessCache();
    const overrides = Object.fromEntries(FEATURE_KEYS.map((key) => [key, true]));
    overrides[featureKey] = false;
    await assert.rejects(
      () => assertPilotFeatureEnabled(pilotDeps(enabledPilotFlags(overrides)), featureKey),
      (error) => error.code === PILOT_FEATURE_DISABLED && error.featureKey === featureKey
    );
  });

  test(`${featureKey} kill switch passes when pilot enabled and flag=true`, async () => {
    invalidatePilotAccessCache();
    const result = await assertPilotFeatureEnabled(
      pilotDeps(enabledPilotFlags({ [featureKey]: true })),
      featureKey
    );
    assert.equal(result.enabled, true);
    assert.equal(result.featureKey, featureKey);
  });
}

test("kill switches stay open when pilot access is disabled", async () => {
  invalidatePilotAccessCache();
  const deps = pilotDeps({
    enabled: jsToFirestoreValue(false),
    featureFlagsJson: jsToFirestoreValue(JSON.stringify({
      matching: false,
      publicOpportunityRouting: false,
      pushNotifications: false,
      crossOfficeCollaboration: false
    }))
  });
  for (const featureKey of FEATURE_KEYS) {
    const result = await assertPilotFeatureEnabled(deps, featureKey);
    assert.equal(result.enabled, true);
  }
});

test("pilotConfigFromFirestoreFields parses feature flag JSON", () => {
  const config = pilotConfigFromFirestoreFields({
    enabled: true,
    maxOffices: 5,
    authorizedOfficeIds: ["office-a", "office-b"],
    featureFlagsJson: JSON.stringify({ matching: false })
  });
  assert.equal(config.enabled, true);
  assert.deepEqual(config.authorizedOfficeIds, ["office-a", "office-b"]);
  assert.equal(config.featureFlags.matching, false);
  assert.equal(config.featureFlags.pushNotifications, true);
});
