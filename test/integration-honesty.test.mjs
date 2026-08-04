// ACCEPTANCE TEST 15 — production honesty.
// Directive §10: without credentials an integration is "adapter ready" or "simulated",
// never "production connected", and fake delivery success is never stored or shown.

import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.js";
import { readRepositoryFile } from "./helpers/shell.mjs";

const shellSource = readRepositoryFile("public", "index.html");
const workerSource = readRepositoryFile("worker", "src", "index.js");
const wranglerSource = readRepositoryFile("worker", "wrangler.toml");
const whatsappClient = readRepositoryFile("public", "js", "whatsapp-office.js");

const env = { FIREBASE_PROJECT_ID: "aqar-b5d76", META_TRIAL_OFFICE_ID: "office-alqiq" };

test("Meta credentials ship empty, so the integration reports itself disabled", async () => {
  assert.match(wranglerSource, /^META_APP_ID = ""$/m);
  assert.match(wranglerSource, /^META_CONFIG_ID = ""$/m);

  const response = await worker.fetch(
    new Request("https://example.test/meta/config?officeId=office-alqiq"),
    env
  );
  const body = await response.json();
  assert.equal(body.enabled, false, "no credentials means not enabled");
});

test("the worker reports itself as inbound-only with outbound messaging off", async () => {
  const response = await worker.fetch(new Request("https://example.test/health"), env);
  const body = await response.json();
  assert.equal(body.mode, "inbound-only");
  assert.equal(body.outboundMessaging, false);
});

test("outbound WhatsApp routes are refused at the edge, not silently accepted", async () => {
  for (const path of ["/meta/messages", "/meta/phone/send", "/meta/send"]) {
    const response = await worker.fetch(new Request(`https://example.test${path}`, { method: "POST" }), env);
    assert.equal(response.status, 403, path);
    const body = await response.json();
    assert.equal(body.error, "outbound_disabled", path);
  }
});

test("the connect button starts disabled and only enables when Meta is configured", () => {
  assert.match(shellSource, /id="whatsappConnectBtn"[^>]*\bdisabled\b/);
  // The client enables it in exactly one place: the branch where config.enabled is true.
  assert.ok(whatsappClient.includes("} else if (config.enabled) {"));
  const enableStatements = [...whatsappClient.matchAll(/elements\.connectBtn\.disabled = false/g)];
  assert.equal(enableStatements.length, 2, "enable on configured, and re-enable after a failed link only");
});

test("the WhatsApp status copy is always one of the honest states", () => {
  const states = [...whatsappClient.matchAll(/setStatus\("([^"]+)"/g)].map(match => match[1]);
  const allowed = new Set([
    "جارٍ التحقق",
    "مربوط",
    "غير مربوط",
    "يحتاج إعداد Meta",
    "بانتظار إعداد Meta",
    "يتطلب تسجيل الدخول",
    "جارٍ إكمال الربط",
    "فشل الربط"
  ]);
  for (const state of states) assert.ok(allowed.has(state), `unexpected status copy: ${state}`);
  assert.ok(states.includes("جارٍ التحقق"), "the initial state must be a checking state, not a connected one");
});

test("the shell's default connection status is not a fabricated 'connected'", () => {
  const match = shellSource.match(/id="whatsappConnectionStatus"[^>]*>([^<]*)</);
  assert.ok(match, "the status element must exist");
  assert.equal(match[1].trim(), "جارٍ التحقق");
});

test("the shell states plainly that no automatic WhatsApp message is sent", () => {
  assert.ok(shellSource.includes("لا يرسل أي رسالة واتساب تلقائية"));
  assert.ok(shellSource.includes("متوقف برمجيًا"));
});

test("only a real Meta signup response may report a linked account", () => {
  // "مربوط" is set from status.connected (server truth) or from the signup completion
  // response — never from a local default or an optimistic guess.
  const connectedAssignments = [...whatsappClient.matchAll(/setStatus\("مربوط", true\)/g)];
  assert.equal(connectedAssignments.length, 2);
  assert.ok(whatsappClient.includes("if (status.connected) {"));
  assert.ok(whatsappClient.includes('const result = await fetchJson("/meta/signup/complete"'));
});

test("no shipped file claims a delivered or read WhatsApp/Telegram message", () => {
  const files = {
    "public/index.html": shellSource,
    "public/js/whatsapp-office.js": whatsappClient,
    "public/js/workflow-office.js": readRepositoryFile("public", "js", "workflow-office.js"),
    "public/js/office-settings.js": readRepositoryFile("public", "js", "office-settings.js"),
    "public/js/messaging-domain.js": readRepositoryFile("public", "js", "messaging-domain.js"),
    "worker/src/index.js": workerSource,
    "worker/src/messaging-domain.js": readRepositoryFile("worker", "src", "messaging-domain.js")
  };
  for (const [name, source] of Object.entries(files)) {
    for (const claim of [
      "تم تسليم الرسالة",
      "تم توصيل الرسالة",
      "تمت القراءة",
      "delivered: true",
      "deliveryState: \"delivered\"",
      "providerConfirmedDelivery: true"
    ]) {
      assert.equal(source.includes(claim), false, `${name} claims delivery: ${claim}`);
    }
  }
});

test("Telegram adapter is simulated, never production-connected or auto-sending", () => {
  // Directive §10 / Phase 7: Telegram may exist as adapter-ready/simulated structure only.
  const messaging = readRepositoryFile("worker", "src", "messaging-domain.js");
  assert.ok(messaging.includes('TELEGRAM_ADAPTER_SIMULATED: "simulated"'));
  assert.ok(messaging.includes("outboundEnabled: false"));
  assert.ok(messaging.includes("inboundEnabled: false"));
  assert.equal(messaging.includes("production connected"), false);
  assert.equal(messaging.includes("production_connected"), false);

  const boundaries = messaging.slice(messaging.indexOf("export function phase7BoundaryGuarantees"));
  assert.ok(boundaries.includes("sendsTelegram: false"));
  assert.ok(boundaries.includes("autoSendsMessages: false"));
  assert.ok(boundaries.includes("claimsFakeDelivery: false"));

  // External handoff must not mark provider SENT/DELIVERED.
  assert.ok(messaging.includes("OPENED_EXTERNAL"));
  assert.ok(messaging.includes("Never set in Phase 7 handoff")
    || messaging.includes("never set in Phase 7 handoff")
    || messaging.includes("must not mark SENT or DELIVERED"));
});

test("the notification preference gate reports a skip instead of a fake success", () => {
  const push = workerSource.slice(workerSource.indexOf("async function sendOfficePush("));
  const gate = push.slice(0, push.indexOf("const devices="));
  assert.ok(gate.includes("skipped:true"), "a blocked send must be reported as skipped");
  assert.ok(gate.includes("sent:0"), "a blocked send must never report a sent count");
});

test("the media upload response does not pretend an unremovable image was removed", async () => {
  assert.ok(
    workerSource.includes('throw appError("image_not_removable"'),
    "deleting the cover must fail loudly rather than report success"
  );
});
