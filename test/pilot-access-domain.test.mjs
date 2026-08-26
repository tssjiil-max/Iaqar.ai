import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PILOT_REGISTRATION_MESSAGE,
  PILOT_ACCESS_DENIED,
  PILOT_FEATURE_DISABLED,
  evaluatePilotOfficeAccess,
  evaluatePilotRegistration,
  isPilotFeatureEnabled,
  normalizePilotAccessConfig
} from "../public/js/pilot-access-domain.js";

const baseConfig = {
  enabled: true,
  maxOffices: 5,
  authorizedOfficeIds: ["office-a", "office-b", "office-c", "office-d", "office-e"]
};

test("pilot gate allows only configured offices when enabled", () => {
  assert.equal(evaluatePilotOfficeAccess(baseConfig, "office-a").allowed, true);
  assert.equal(evaluatePilotOfficeAccess(baseConfig, "office-a").code, "PILOT_AUTHORIZED");
  assert.equal(evaluatePilotOfficeAccess(baseConfig, "office-f").allowed, false);
  assert.equal(evaluatePilotOfficeAccess(baseConfig, "office-f").code, PILOT_ACCESS_DENIED);
});

test("platform admin bypasses pilot gate", () => {
  assert.equal(
    evaluatePilotOfficeAccess(baseConfig, "office-f", { isPlatformAdmin: true }).allowed,
    true
  );
});

test("registration closes after max offices", () => {
  const open = evaluatePilotRegistration(baseConfig, { activeOfficeCount: 4 });
  assert.equal(open.allowed, true);
  const closed = evaluatePilotRegistration(baseConfig, { activeOfficeCount: 5 });
  assert.equal(closed.allowed, false);
  assert.equal(closed.message, DEFAULT_PILOT_REGISTRATION_MESSAGE);
});

test("pilot disabled allows all offices", () => {
  const cfg = normalizePilotAccessConfig({ enabled: false });
  assert.equal(evaluatePilotOfficeAccess(cfg, "any-office").allowed, true);
});

test("office #6 denial when only five offices are authorized", () => {
  const offices = ["office-1", "office-2", "office-3", "office-4", "office-5"];
  const cfg = normalizePilotAccessConfig({
    enabled: true,
    maxOffices: 5,
    authorizedOfficeIds: offices
  });
  for (const officeId of offices) {
    const decision = evaluatePilotOfficeAccess(cfg, officeId);
    assert.equal(decision.allowed, true, `${officeId} should be allowed`);
    assert.equal(decision.code, "PILOT_AUTHORIZED");
  }
  const sixth = evaluatePilotOfficeAccess(cfg, "office-6");
  assert.equal(sixth.allowed, false);
  assert.equal(sixth.code, PILOT_ACCESS_DENIED);
});

const FEATURE_KEYS = [
  "matching",
  "publicOpportunityRouting",
  "pushNotifications",
  "crossOfficeCollaboration"
];

for (const featureKey of FEATURE_KEYS) {
  test(`${featureKey} feature flag disables only that feature when pilot enabled`, () => {
    const cfg = normalizePilotAccessConfig({
      enabled: true,
      featureFlags: Object.fromEntries(FEATURE_KEYS.map((key) => [key, key !== featureKey]))
    });
    assert.equal(isPilotFeatureEnabled(cfg, featureKey), false);
    for (const otherKey of FEATURE_KEYS.filter((key) => key !== featureKey)) {
      assert.equal(isPilotFeatureEnabled(cfg, otherKey), true, `${otherKey} should stay enabled`);
    }
  });
}

test("feature flags remain open when pilot access is disabled", () => {
  const cfg = normalizePilotAccessConfig({
    enabled: false,
    featureFlags: {
      matching: false,
      publicOpportunityRouting: false,
      pushNotifications: false,
      crossOfficeCollaboration: false
    }
  });
  for (const featureKey of FEATURE_KEYS) {
    assert.equal(isPilotFeatureEnabled(cfg, featureKey), true);
  }
});
