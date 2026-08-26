import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PILOT_REGISTRATION_MESSAGE,
  PILOT_ACCESS_DENIED,
  evaluatePilotOfficeAccess,
  evaluatePilotRegistration,
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
