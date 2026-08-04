// ACCEPTANCE TEST 10 (partial) — notifications follow the broker's preferences.
// Directive §7.5 and §17. The Worker keeps a duplicate of the push-type table because it
// cannot import from public/ without adding a build step, so this file also asserts the
// two copies agree.

import test from "node:test";
import assert from "node:assert/strict";
import {
  ALWAYS_ALLOWED_PUSH_TYPES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_KEYS,
  PUSH_TYPE_CATEGORIES,
  defaultNotificationPreferences,
  isNotificationAllowed,
  notificationCategoryForPushType,
  resolveNotificationPreferences,
  sanitizeNotificationPreferences
} from "../public/js/office-domain.js";
import {
  ALWAYS_ALLOWED_PUSH_TYPES as WORKER_ALWAYS_ALLOWED,
  PUSH_TYPE_NOTIFICATION_CATEGORIES as WORKER_PUSH_TYPES,
  notificationCategoryAllowed as workerCategoryAllowed,
  notificationCategoryForPushType as workerCategoryForPushType
} from "../worker/src/index.js";
import { readRepositoryFile } from "./helpers/shell.mjs";

const DIRECTIVE_CATEGORIES = [
  "matchNotifications",
  "ownerCustomerNotifications",
  "cooperationNotifications",
  "messageNotifications",
  "appointmentNotifications",
  "systemNotifications"
];

test("the six approved notification categories exist, and only those", () => {
  assert.deepEqual([...NOTIFICATION_CATEGORY_KEYS], DIRECTIVE_CATEGORIES);
  assert.equal(NOTIFICATION_CATEGORIES.length, 6);
  for (const category of NOTIFICATION_CATEGORIES) {
    assert.ok(category.label && category.label.trim().length > 0, category.key);
  }
});

test("every category is enabled by default, so existing offices keep their behaviour", () => {
  const defaults = defaultNotificationPreferences();
  assert.deepEqual(Object.keys(defaults).sort(), [...DIRECTIVE_CATEGORIES].sort());
  for (const key of DIRECTIVE_CATEGORIES) assert.equal(defaults[key], true, key);
});

test("sanitising keeps known booleans and drops everything else", () => {
  const sanitized = sanitizeNotificationPreferences({
    matchNotifications: false,
    messageNotifications: true,
    systemNotifications: "yes",
    appointmentNotifications: 1,
    unknownKey: true,
    officeId: "office-alqiq",
    updatedBy: "uid-1"
  });
  assert.deepEqual(sanitized, { matchNotifications: false, messageNotifications: true });
});

test("sanitising tolerates junk input", () => {
  for (const value of [null, undefined, "text", 42, [], () => {}]) {
    assert.deepEqual(sanitizeNotificationPreferences(value), {});
  }
});

test("a broker override wins over the office default, which wins over the built-in", () => {
  const resolved = resolveNotificationPreferences({
    officeDefaults: { matchNotifications: false, messageNotifications: false },
    brokerOverrides: { messageNotifications: true }
  });
  assert.equal(resolved.matchNotifications, false, "office default applies where the broker is silent");
  assert.equal(resolved.messageNotifications, true, "the broker override wins");
  assert.equal(resolved.cooperationNotifications, true, "untouched categories fall back to enabled");
});

test("resolving with nothing stored yields all categories enabled", () => {
  assert.deepEqual(resolveNotificationPreferences(), defaultNotificationPreferences());
  assert.deepEqual(
    resolveNotificationPreferences({ officeDefaults: null, brokerOverrides: null }),
    defaultNotificationPreferences()
  );
});

test("every push type maps to one of the six categories", () => {
  for (const [type, category] of Object.entries(PUSH_TYPE_CATEGORIES)) {
    assert.ok(DIRECTIVE_CATEGORIES.includes(category), `${type} -> ${category}`);
  }
});

test("the directive's category list is fully reachable from real push types", () => {
  const mapped = new Set(Object.values(PUSH_TYPE_CATEGORIES));
  for (const category of DIRECTIVE_CATEGORIES) {
    if (category === "systemNotifications") continue; // reached through the fallback
    assert.ok(mapped.has(category), `no push type routes to ${category}`);
  }
});

test("unknown push types fall back to the system category rather than being dropped", () => {
  for (const type of ["", null, undefined, "something_new", "platform_alert"]) {
    assert.equal(notificationCategoryForPushType(type), "systemNotifications", String(type));
  }
});

test("push type lookup ignores case and surrounding whitespace", () => {
  assert.equal(notificationCategoryForPushType("  MATCH "), "matchNotifications");
  assert.equal(notificationCategoryForPushType("Deal"), "matchNotifications");
});

test("a disabled category blocks its push types and nothing else", () => {
  const preferences = { matchNotifications: false };
  assert.equal(isNotificationAllowed("match", preferences), false);
  assert.equal(isNotificationAllowed("deal", preferences), false);
  assert.equal(isNotificationAllowed("cooperation", preferences), true);
  assert.equal(isNotificationAllowed("appointment", preferences), true);
  assert.equal(isNotificationAllowed("anything_else", preferences), true);
});

test("a missing preference document means every category is allowed", () => {
  for (const preferences of [undefined, null, {}, { officeId: "office-alqiq" }]) {
    assert.equal(isNotificationAllowed("match", preferences), true);
    assert.equal(isNotificationAllowed("cooperation", preferences), true);
  }
});

test("the broker's own test notification is never swallowed by a preference", () => {
  const everythingOff = Object.fromEntries(DIRECTIVE_CATEGORIES.map(key => [key, false]));
  assert.deepEqual([...ALWAYS_ALLOWED_PUSH_TYPES], ["notification_test"]);
  assert.equal(isNotificationAllowed("notification_test", everythingOff), true);
  assert.equal(isNotificationAllowed("match", everythingOff), false);
});

test("the worker and the browser agree on the push-type table", () => {
  assert.deepEqual(WORKER_PUSH_TYPES, PUSH_TYPE_CATEGORIES);
  assert.deepEqual([...WORKER_ALWAYS_ALLOWED], [...ALWAYS_ALLOWED_PUSH_TYPES]);
});

test("the worker and the browser agree on the gate decision for every type", () => {
  const types = [...Object.keys(PUSH_TYPE_CATEGORIES), "notification_test", "unknown_type", ""];
  const preferenceSets = [
    {},
    { matchNotifications: false },
    { ownerCustomerNotifications: false, systemNotifications: false },
    Object.fromEntries(DIRECTIVE_CATEGORIES.map(key => [key, false]))
  ];
  for (const preferences of preferenceSets) {
    for (const type of types) {
      assert.equal(
        workerCategoryAllowed(type, preferences),
        isNotificationAllowed(type, preferences),
        `type=${type} preferences=${JSON.stringify(preferences)}`
      );
      assert.equal(workerCategoryForPushType(type), notificationCategoryForPushType(type), type);
    }
  }
});

test("the worker consults the preference document before it lists devices", () => {
  const worker = readRepositoryFile("worker", "src", "index.js");
  const push = worker.slice(worker.indexOf("async function sendOfficePush("));
  const gateIndex = push.indexOf("notificationCategoryAllowed");
  const devicesIndex = push.indexOf("listCollectionDocuments");
  assert.ok(gateIndex > -1, "sendOfficePush must apply the gate");
  assert.ok(devicesIndex > -1);
  assert.ok(gateIndex < devicesIndex, "the gate must run before any device is read");
  assert.ok(
    push.includes('reason:"notifications_disabled"'),
    "a skipped send must say why instead of reporting a fake success"
  );
});

test("the shell exposes a control for each category and nothing extra", () => {
  const shell = readRepositoryFile("public", "index.html");
  const values = [...shell.matchAll(/name="notificationPreference"\s+value="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(values.sort(), [...DIRECTIVE_CATEGORIES].sort());
});
