import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { NOTIFICATION_CATEGORIES, resolveNotificationPreferences } from "../public/js/office-domain.js";

const view = fs.readFileSync(new URL("../public/os/views/notification-settings.js", import.meta.url), "utf8");
const core = fs.readFileSync(new URL("../public/os/core/notification-prefs.js", import.meta.url), "utf8");

test("the new screen lists every category the server knows, from the shared domain", () => {
  assert.equal(NOTIFICATION_CATEGORIES.length, 6);
  assert.match(view, /NOTIFICATION_CATEGORIES/);
});

test("storage is unchanged: office default (managers only) + the person's own override", () => {
  assert.match(core, /officeSettings"\)\.doc\("notifications"\)/);
  assert.match(core, /brokerSettings"\)\.doc\(session\.user\.uid\)/);
  assert.match(core, /if \(session\.isManager\)/);
});

test("broker override wins over the office default, which wins over on", () => {
  const r = resolveNotificationPreferences({ officeDefaults: { matchNotifications: false, messageNotifications: false }, brokerOverrides: { messageNotifications: true } });
  assert.equal(r.matchNotifications, false);
  assert.equal(r.messageNotifications, true);
  assert.equal(r.systemNotifications, true);
});
