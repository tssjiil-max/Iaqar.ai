import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CHANNEL,
  CHANNEL_CAPABILITY,
  CHANNEL_BUSINESS_OWNER,
  channelCapabilityAllowed,
  channelBusinessMutationGuard,
  providerEvidenceGuard,
  channelCleanupBoundaryGuarantees
} from "../worker/src/channel-boundary-domain.js";
import {
  verifyTelegramWebhookSecret,
  resolveTelegramOfficeId,
  handleTelegramCanonicalWebhook,
  telegramWebhookRuntimeContract
} from "../worker/src/telegram-intake-service.js";
import {
  normalizeTelegramInbound,
  telegramIntakeBoundaryGuarantees
} from "../worker/src/telegram-intake-domain.js";
import {
  telegramWebhookValidationFixture,
  whatsappAdapterContract
} from "../worker/src/messaging-domain.js";

function fh() {
  return {
    firestoreString: (v) => ({ stringValue: String(v ?? "") }),
    firestoreOptionalString: (v) => String(v ?? "") ? ({ stringValue: String(v) }) : null,
    firestoreInteger: (v) => ({ integerValue: String(Number(v) || 0) }),
    firestoreBoolean: (v) => ({ booleanValue: Boolean(v) }),
    firestoreTimestamp: (v) => ({ timestampValue: new Date(v).toISOString() }),
    compactFields: (fields) => Object.fromEntries(Object.entries(fields).filter(([, value]) => value != null))
  };
}

test("channels are transport-only and cannot mutate canonical business state", () => {
  for (const channel of [CHANNEL.WHATSAPP, CHANNEL.TELEGRAM]) {
    assert.equal(channelCapabilityAllowed({ channel, capability: CHANNEL_CAPABILITY.INTAKE }).ok, true);
    assert.equal(channelCapabilityAllowed({ channel, capability: CHANNEL_CAPABILITY.HANDOFF }).ok, true);
    const mutation = channelBusinessMutationGuard({
      channel,
      targetOwner: CHANNEL_BUSINESS_OWNER.NEGOTIATION,
      action: "ACCEPT_PRICE"
    });
    assert.equal(mutation.ok, false);
    assert.equal(mutation.reason, "channel_cannot_mutate_business_state");
  }
  const g = channelCleanupBoundaryGuarantees();
  assert.equal(g.inboundUsesCanonicalIntake, true);
  assert.equal(g.channelsOwnMatching, false);
  assert.equal(g.channelsOwnNegotiation, false);
  assert.equal(g.channelsOwnViewing, false);
  assert.equal(g.channelsOwnDeals, false);
  assert.equal(g.channelsOwnCooperation, false);
});

test("provider evidence is mandatory before SENT / DELIVERED claims", () => {
  assert.equal(providerEvidenceGuard({ sendState: "SENT", providerConfirmedSend: false }).ok, false);
  assert.equal(providerEvidenceGuard({
    sendState: "SENT",
    deliveryState: "DELIVERED",
    providerConfirmedSend: true,
    providerConfirmedDelivery: false
  }).ok, false);
  assert.equal(providerEvidenceGuard({
    sendState: "SENT",
    deliveryState: "DELIVERED",
    providerConfirmedSend: true,
    providerConfirmedDelivery: true
  }).ok, true);
});

test("Telegram webhook requires the Telegram secret header and office scope", () => {
  const good = new Request("https://example.test/telegram/webhook/office-a", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": "secret-123" }
  });
  assert.equal(verifyTelegramWebhookSecret(good, "secret-123").ok, true);
  assert.equal(verifyTelegramWebhookSecret(good, "other-secret").status, 401);
  assert.equal(verifyTelegramWebhookSecret(good, "").status, 503);

  const office = resolveTelegramOfficeId({
    requestUrl: good.url,
    env: { TELEGRAM_OFFICE_ID: "office-a" },
    firestoreOfficeId: (v) => String(v || "").trim().toLowerCase()
  });
  assert.deepEqual(office, { ok: true, officeId: "office-a" });
  const mismatch = resolveTelegramOfficeId({
    requestUrl: "https://example.test/telegram/webhook/office-b",
    env: { TELEGRAM_OFFICE_ID: "office-a" },
    firestoreOfficeId: (v) => String(v || "").trim().toLowerCase()
  });
  assert.equal(mismatch.status, 403);
});

test("Telegram text update is normalized then sent to Canonical Intake exactly once", async () => {
  const writes = [];
  const ingested = [];
  const helpers = {
    projectId: "demo",
    accessToken: "token",
    bucket: null,
    firestoreOfficeId: (v) => String(v || "").trim().toLowerCase(),
    getFirestoreDocument: async () => null,
    setFirestoreDocument: async (args) => { writes.push(args); },
    firestoreFieldsToJs: () => ({}),
    ...fh(),
    ingestCanonical: async (body) => {
      ingested.push(body);
      return {
        ok: true,
        duplicate: false,
        opportunityId: "opp_tg_1",
        importJobId: "imp_tg_1",
        analysisStatus: "analysis_complete"
      };
    }
  };
  const request = new Request("https://example.test/telegram/webhook/office-a", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "secret-123" },
    body: JSON.stringify({
      update_id: 771,
      message: {
        message_id: 19,
        date: 1788790000,
        from: { id: 99, first_name: "سلطان" },
        chat: { id: 99 },
        text: "مطلوب شقة شراء في العزيزية بميزانية 700 ألف"
      }
    })
  });
  const result = await handleTelegramCanonicalWebhook({
    request,
    env: { TELEGRAM_WEBHOOK_SECRET: "secret-123", TELEGRAM_OFFICE_ID: "office-a" },
    requestId: "req-1",
    helpers
  });
  assert.equal(result.ok, true);
  assert.equal(result.opportunityId, "opp_tg_1");
  assert.equal(ingested.length, 1);
  assert.equal(ingested[0].sourceChannel, "telegram");
  assert.equal(ingested[0].idempotencyKey, "telegram:office-a:771");
  assert.deepEqual(ingested[0].parts, [{ contentType: "text", text: "مطلوب شقة شراء في العزيزية بميزانية 700 ألف" }]);
  assert.ok(writes.length >= 2);
});

test("Telegram duplicate update is idempotent and never re-ingests", async () => {
  let ingested = 0;
  const helpers = {
    projectId: "demo",
    accessToken: "token",
    bucket: null,
    firestoreOfficeId: (v) => String(v || "").trim().toLowerCase(),
    getFirestoreDocument: async () => ({ fields: { opportunityId: { stringValue: "opp_existing" } } }),
    setFirestoreDocument: async () => {},
    firestoreFieldsToJs: () => ({ opportunityId: "opp_existing" }),
    ...fh(),
    ingestCanonical: async () => { ingested += 1; return {}; }
  };
  const request = new Request("https://example.test/telegram/webhook/office-a", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "secret-123" },
    body: JSON.stringify({ update_id: 771, message: { message_id: 19, date: 1788790000, text: "test" } })
  });
  const result = await handleTelegramCanonicalWebhook({
    request,
    env: { TELEGRAM_WEBHOOK_SECRET: "secret-123", TELEGRAM_OFFICE_ID: "office-a" },
    helpers
  });
  assert.equal(result.duplicate, true);
  assert.equal(result.opportunityId, "opp_existing");
  assert.equal(ingested, 0);
});

test("Telegram media without runtime adapter is retained for review, not falsely processed", async () => {
  const writes = [];
  const helpers = {
    projectId: "demo",
    accessToken: "token",
    bucket: null,
    firestoreOfficeId: (v) => String(v || "").trim().toLowerCase(),
    getFirestoreDocument: async () => null,
    setFirestoreDocument: async (args) => { writes.push(args); },
    firestoreFieldsToJs: () => ({}),
    ...fh(),
    ingestCanonical: async () => { throw new Error("must not ingest missing media"); }
  };
  const request = new Request("https://example.test/telegram/webhook/office-a", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "secret-123" },
    body: JSON.stringify({ update_id: 800, message: { message_id: 20, date: 1788790000, photo: [{ file_id: "p1" }] } })
  });
  const result = await handleTelegramCanonicalWebhook({
    request,
    env: { TELEGRAM_WEBHOOK_SECRET: "secret-123", TELEGRAM_OFFICE_ID: "office-a" },
    helpers
  });
  assert.equal(result.ok, true);
  assert.equal(result.deferred, true);
  assert.equal(result.reason, "telegram_media_adapter_not_configured");
  assert.ok(writes.length >= 2);
});

test("Telegram and WhatsApp adapter contracts are honest", () => {
  const tg = telegramWebhookValidationFixture();
  assert.equal(tg.inboundEnabled, true);
  assert.equal(tg.outboundEnabled, false);
  assert.equal(tg.canonicalIntakeOnly, true);
  assert.equal(tg.requiresSecretTokenHeader, true);
  const runtime = telegramWebhookRuntimeContract();
  assert.equal(runtime.canonicalIntakeOnly, true);
  assert.equal(runtime.directBusinessStateMutation, false);
  assert.equal(runtime.outboundBotApiEnabled, false);

  const wa = whatsappAdapterContract();
  assert.equal(wa.inboundCloudApi, true);
  assert.equal(wa.outboundCloudApi, false);
  assert.equal(wa.neverAutoSend, true);
  assert.equal(wa.neverFakeDelivery, true);
  assert.equal(telegramIntakeBoundaryGuarantees().negotiatesInTelegram, false);
});

test("runtime static boundary: legacy inbound channel no longer creates records or matches directly", async () => {
  const source = await readFile(new URL("../worker/src/index.js", import.meta.url), "utf8");
  assert.match(source, /\/telegram\\\/webhook\\\/\[\^\/\]\+\$|handleTelegramWebhookRoute/);
  const start = source.indexOf("async function processInboundMessage({");
  const end = source.indexOf("\nfunction parseRealEstateMessage(", start);
  assert.ok(start >= 0 && end > start);
  const inbound = source.slice(start, end);
  assert.match(inbound, /startCanonicalIntake/);
  assert.match(inbound, /canonicalIntake: firestoreBoolean\(true\)/);
  assert.doesNotMatch(inbound, /runCanonicalMatchingAfterOpportunityPersist/);
  assert.doesNotMatch(inbound, /targetCollection/);
  assert.doesNotMatch(inbound, /\["owners"\]|\["clients"\]/);

  const canonical = await readFile(new URL("../worker/src/canonical-intake-service.js", import.meta.url), "utf8");
  assert.match(canonical, /sourceChannel: ctx\.firestoreOptionalString\(sourceChannel\)/);
  assert.match(canonical, /externalEventId: ctx\.firestoreOptionalString\(externalEventId\)/);
});

test("Telegram normalization itself contains no transaction-state permissions", () => {
  const envelope = normalizeTelegramInbound({
    update_id: 1,
    message: { message_id: 2, date: 1788790000, text: "عرض فيلا للبيع" }
  }, { officeId: "office-a" });
  assert.equal(envelope.source, "telegram");
  assert.equal(envelope.createCanonicalOpportunityDirectly, false);
  assert.equal(envelope.negotiationAllowed, false);
  assert.equal(envelope.autoSendAllowed, false);
});
