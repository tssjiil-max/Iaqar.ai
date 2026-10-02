import test from "node:test";
import assert from "node:assert/strict";
import { buildChannelStatuses } from "../worker/src/office-channels-service.js";
import { channelViews, automationLabel } from "../public/os/domain/channels-domain.js";

const SECRETS = { TELEGRAM_WEBHOOK_SECRET: "tg-secret-value", WHATSAPP_APP_SECRET: "wa-secret-value", FIREBASE_PRIVATE_KEY: "pk" };

test("nothing configured → both channels disconnected, outbound off, ASSISTED", () => {
  const r = buildChannelStatuses({ officeId: "o1", env: {} });
  assert.deepEqual(r.channels.map((c) => c.status), ["disconnected", "disconnected"]);
  assert.equal(r.outboundEnabled, false);
  assert.equal(r.automationMode, "ASSISTED");
});

test("whatsapp connected shows only the last 4 digits and today's count", () => {
  const r = buildChannelStatuses({ officeId: "o1", whatsappIntegration: { status: "connected", displayPhoneNumber: "+966501234567", accessToken: "LEAK" }, whatsappUsage: { inboundMessages: 7 }, env: SECRETS });
  const wa = r.channels.find((c) => c.id === "whatsapp");
  assert.equal(wa.status, "connected");
  assert.ok(wa.displayPhoneNumber.endsWith("4567") && !wa.displayPhoneNumber.includes("501234"));
  assert.equal(wa.inboundMessagesToday, 7);
  assert.equal(wa.inboundOnly, true);
});

test("a started-but-unfinished whatsapp signup is «setup»", () => {
  const r = buildChannelStatuses({ officeId: "o1", whatsappIntegration: { status: "pending" } });
  assert.equal(r.channels[0].status, "setup");
});

test("telegram is connected only for the office it is scoped to (tenant isolation)", () => {
  const own = buildChannelStatuses({ officeId: "o1", env: { ...SECRETS, TELEGRAM_OFFICE_ID: "o1" } });
  const other = buildChannelStatuses({ officeId: "o2", env: { ...SECRETS, TELEGRAM_OFFICE_ID: "o1" } });
  assert.equal(own.channels[1].status, "connected");
  assert.equal(other.channels[1].status, "disconnected");
});

test("the response never contains secrets or tokens", () => {
  const json = JSON.stringify(buildChannelStatuses({ officeId: "o1", whatsappIntegration: { status: "connected", displayPhoneNumber: "0501234567", accessToken: "LEAK" }, env: { ...SECRETS, TELEGRAM_OFFICE_ID: "o1" } }));
  for (const needle of ["tg-secret-value", "wa-secret-value", "LEAK", "pk\"", "0501234567"]) assert.ok(!json.includes(needle), needle);
});

test("UI views carry Arabic labels and ignore unknown channels", () => {
  const views = channelViews({ channels: [{ id: "whatsapp", status: "connected", displayPhoneNumber: "••••4567", inboundMessagesToday: 2 }, { id: "telegram", status: "weird" }, { id: "baileys", status: "connected" }] });
  assert.equal(views.length, 2);
  assert.equal(views[0].statusLabel, "متصل");
  assert.equal(views[1].status, "disconnected");
  assert.match(automationLabel({}), /يقترح/);
});
