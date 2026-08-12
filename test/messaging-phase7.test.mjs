/**
 * Phase 7 — Smart message drafts + adapter contracts (Acceptance Test 13).
 * Drafts persist with honest send/delivery state. Never auto-send. Never fake delivery.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  MESSAGE_CHANNELS,
  MESSAGE_SEND_STATE,
  MESSAGE_DELIVERY_STATE,
  TEMPLATE_CODES,
  ADAPTER_STATUS,
  phase7BoundaryGuarantees,
  buildArabicMessageBody,
  buildMessageDraft,
  applyExternalHandoff,
  applyProviderSendResult,
  buildWhatsAppHandoffUrl,
  buildTelegramHandoffUrl,
  resolveTemplateCode,
  whatsappDigits,
  whatsappAdapterContract,
  telegramWebhookValidationFixture
} from "../worker/src/messaging-domain.js";
import {
  phase7BoundaryGuarantees as clientBoundaries,
  MESSAGE_CHANNELS as clientChannels,
  MESSAGE_SEND_STATE as clientSend,
  MESSAGE_DELIVERY_STATE as clientDelivery,
  TEMPLATE_CODES as clientTemplates,
  buildArabicMessageBody as clientBody,
  resolveTemplateCode as clientResolve,
  requestCreateMessageDraft,
  requestMessageHandoff,
  MESSAGES_DRAFT_PATH,
  MESSAGES_HANDOFF_PATH,
  sendStateLabelAr,
  deliveryStateLabelAr
} from "../public/js/messaging-domain.js";
import { projectOperationToUiItem } from "../public/js/operations-domain.js";
import { readRepositoryFile } from "./helpers/shell.mjs";
import worker, {
  phase7BoundaryGuarantees as workerExportBoundaries
} from "../worker/src/index.js";

test("Phase 7 boundaries: drafts yes, send/delivery/claims no", () => {
  const g = phase7BoundaryGuarantees();
  assert.equal(g.createsSmartMessageDraft, true);
  assert.equal(g.persistsMessageDraft, true);
  assert.equal(g.sendsWhatsApp, false);
  assert.equal(g.sendsTelegram, false);
  assert.equal(g.autoSendsMessages, false);
  assert.equal(g.claimsFakeDelivery, false);
  assert.equal(g.cloudApiOutboundEnabled, false);
  assert.equal(g.whatsappAdapterStatus, ADAPTER_STATUS.WHATSAPP_ADAPTER_READY);
  assert.equal(g.telegramAdapterStatus, ADAPTER_STATUS.TELEGRAM_ADAPTER_SIMULATED);
  assert.equal(g.addsDealsPage, false);
  assert.equal(g.addsBottomNavigation, false);
  assert.deepEqual(clientBoundaries(), g);
  assert.deepEqual(workerExportBoundaries(), g);
});

test("Test 13: Arabic templates cover match, viewing, follow-up, media, deal stages", () => {
  const matchOwner = buildArabicMessageBody({
    templateCode: TEMPLATE_CODES.MATCH_OWNER,
    role: "owner",
    officeName: "مكتب النخبة",
    contactName: "أحمد",
    propertyType: "شقة",
    district: "النرجس"
  });
  assert.match(matchOwner, /مرحبًا أحمد/);
  assert.match(matchOwner, /عميل مهتم/);
  assert.match(matchOwner, /شقة في النرجس/);
  assert.match(matchOwner, /مكتب النخبة/);

  const matchClient = buildArabicMessageBody({
    templateCode: TEMPLATE_CODES.MATCH_CLIENT,
    role: "client",
    officeName: "مكتب النخبة",
    propertyType: "فيلا",
    district: "الملقا"
  });
  assert.match(matchClient, /عرضًا مناسبًا/);

  const viewing = buildArabicMessageBody({
    templateCode: TEMPLATE_CODES.VIEWING_CLIENT,
    appointmentLabel: "الأحد 5 مساءً"
  });
  assert.match(viewing, /الأحد 5 مساءً/);

  const media = buildArabicMessageBody({
    templateCode: TEMPLATE_CODES.MEDIA_REQUEST,
    requestedItems: ["photos", "location"],
    requestNote: "يفضل صور النهار"
  });
  assert.match(media, /صور العقار/);
  assert.match(media, /موقع العقار/);
  assert.match(media, /يفضل صور النهار/);

  assert.equal(resolveTemplateCode({ stage: "negotiation" }), TEMPLATE_CODES.NEGOTIATION);
  assert.equal(resolveTemplateCode({ stage: "active", role: "owner" }), TEMPLATE_CODES.MATCH_OWNER);
  assert.equal(clientResolve({ stage: "viewing", role: "client" }), clientTemplates.VIEWING_CLIENT);
  assert.equal(clientBody({ templateCode: "FOLLOWUP", propertyType: "أرض" }).includes("نتابع"), true);
});

test("Test 13: WhatsApp adapter_ready + Telegram simulated contracts", () => {
  const wa = whatsappAdapterContract();
  assert.equal(wa.adapterStatus, "adapter_ready");
  assert.equal(wa.outboundCloudApi, false);
  assert.equal(wa.brokerHandoff, "wa.me");
  assert.equal(wa.neverAutoSend, true);
  assert.equal(wa.neverFakeDelivery, true);

  const tg = telegramWebhookValidationFixture();
  assert.equal(tg.adapterStatus, "simulated");
  assert.equal(tg.outboundEnabled, false);
  assert.equal(tg.inboundEnabled, false);
  assert.equal(tg.requiresSecretTokenHeader, true);
  assert.equal(tg.headerName, "X-Telegram-Bot-Api-Secret-Token");
});

test("Test 13: draft starts DRAFT / NOT_APPLICABLE and handoff is not SENT", async () => {
  const built = await buildMessageDraft({
    officeId: "office-a",
    channel: MESSAGE_CHANNELS.WHATSAPP,
    templateCode: TEMPLATE_CODES.MATCH_CLIENT,
    body: "مرحبًا، مسودة اختبار",
    recipientRole: "client",
    recipientName: "سارة",
    recipientPhone: "0551234567",
    operationId: "op_1",
    matchId: "mat_1",
    opportunityId: "opp_1"
  });
  assert.equal(built.ok, true);
  assert.match(built.draft.id, /^msg_/);
  assert.equal(built.draft.sendState, MESSAGE_SEND_STATE.DRAFT);
  assert.equal(built.draft.deliveryState, MESSAGE_DELIVERY_STATE.NOT_APPLICABLE);
  assert.equal(built.draft.providerConfirmedSend, false);
  assert.equal(built.draft.providerConfirmedDelivery, false);
  assert.equal(built.draft.autoSend, false);
  assert.equal(built.draft.channel, "whatsapp");
  assert.equal(built.draft.recipientPhone, "966551234567");
  assert.ok(built.draft.handoffUrl.startsWith("https://wa.me/966551234567"));
  assert.equal(built.draft.operationId, "op_1");
  assert.equal(built.draft.matchId, "mat_1");
  assert.ok(built.draft.createdAt);

  const handed = applyExternalHandoff(built.draft);
  assert.equal(handed.ok, true);
  assert.equal(handed.patch.sendState, MESSAGE_SEND_STATE.OPENED_EXTERNAL);
  assert.equal(handed.patch.deliveryState, MESSAGE_DELIVERY_STATE.NOT_APPLICABLE);
  assert.equal(handed.patch.providerConfirmedSend, false);
  assert.equal(handed.patch.providerConfirmedDelivery, false);
  assert.notEqual(handed.patch.sendState, MESSAGE_SEND_STATE.SENT);
  assert.notEqual(handed.patch.deliveryState, MESSAGE_DELIVERY_STATE.DELIVERED);
});

test("Test 13: Telegram handoff is simulated share URL, not Bot API send", async () => {
  const url = buildTelegramHandoffUrl({ body: "نص عربي" });
  assert.equal(url.ok, true);
  assert.equal(url.impliesSent, false);
  assert.equal(url.impliesDelivered, false);
  assert.equal(url.adapterStatus, "simulated");
  assert.match(url.url, /^https:\/\/t\.me\/share\/url\?/);

  const built = await buildMessageDraft({
    officeId: "office-a",
    channel: MESSAGE_CHANNELS.TELEGRAM,
    body: "مسودة تيليجرام",
    recipientRole: "owner"
  });
  assert.equal(built.ok, true);
  assert.equal(built.draft.adapterStatus, ADAPTER_STATUS.TELEGRAM_ADAPTER_SIMULATED);
  assert.equal(built.draft.sendState, MESSAGE_SEND_STATE.DRAFT);
});

test("WhatsApp handoff URL never implies provider send", () => {
  const built = buildWhatsAppHandoffUrl({ phone: "0512345678", body: "مرحبا" });
  assert.equal(built.ok, true);
  assert.equal(built.impliesSent, false);
  assert.equal(built.impliesDelivered, false);
  assert.equal(whatsappDigits("0512345678"), "966512345678");
  assert.equal(whatsappDigits("123"), "");
});

test("provider send path is reserved and still does not claim delivery", () => {
  const confirmed = applyProviderSendResult({ sendState: "READY" }, { confirmed: true });
  assert.equal(confirmed.patch.sendState, MESSAGE_SEND_STATE.SENT);
  assert.equal(confirmed.patch.providerConfirmedSend, true);
  assert.equal(confirmed.patch.deliveryState, MESSAGE_DELIVERY_STATE.UNKNOWN);
  assert.equal(confirmed.patch.providerConfirmedDelivery, false);

  const failed = applyProviderSendResult({ sendState: "READY" }, { confirmed: false });
  assert.equal(failed.patch.sendState, MESSAGE_SEND_STATE.FAILED);
  assert.equal(failed.patch.providerConfirmedDelivery, false);
});

test("honest Arabic labels never claim unconfirmed delivery", () => {
  assert.match(sendStateLabelAr(clientSend.OPENED_EXTERNAL), /لم يُؤكد الإرسال/);
  assert.match(deliveryStateLabelAr(clientDelivery.NOT_APPLICABLE), /غير منطبق/);
  assert.equal(deliveryStateLabelAr(clientDelivery.UNKNOWN).includes("غير مؤكد"), true);
  assert.equal(deliveryStateLabelAr("DELIVERED").includes("مؤكد من المزود"), true);
});

test("MATCH_REVIEW Operations offer draft actions without send claims", () => {
  const ui = projectOperationToUiItem({
    id: "op_match",
    type: "MATCH_REVIEW",
    titleText: "مطابقة جديدة تحتاج مراجعتك",
    summaryText: "ملخص",
    recommendedActionText: "مراجعة",
    priority: "HIGH",
    status: "OPEN",
    matchId: "mat_1",
    createdAt: new Date().toISOString()
  });
  assert.equal(ui.whatsappOwner, true);
  assert.equal(ui.whatsappClient, true);
  assert.equal(ui.telegramOwner, true);
  assert.equal(ui.telegramClient, true);
  assert.equal(ui.createsSmartMessageDraft, true);
  assert.equal(ui.sendsWhatsApp, false);
  assert.equal(ui.sendsTelegram, false);
  assert.match(ui.whatsappOwnerLabel, /إرسال واتساب للمالك/);
  assert.match(ui.telegramOwnerLabel, /إرسال تليجرام للمالك/);

  const missing = projectOperationToUiItem({
    id: "op_missing",
    type: "MISSING_DATA",
    titleText: "بيانات ناقصة",
    status: "OPEN",
    createdAt: new Date().toISOString()
  });
  assert.equal(missing.whatsappOwner, false);
  assert.equal(missing.telegramClient, false);
});

test("client draft/handoff helpers post to Worker paths", async () => {
  const calls = [];
  const draft = await requestCreateMessageDraft({
    workerBase: "https://example.test",
    idToken: "token",
    officeId: "office-a",
    channel: clientChannels.WHATSAPP,
    role: "client",
    contactPhone: "0551111111",
    body: "نص",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({
          ok: true,
          messageId: "msg_1",
          draft: { id: "msg_1", sendState: "DRAFT", deliveryState: "NOT_APPLICABLE" }
        })
      };
    }
  });
  assert.equal(draft.ok, true);
  assert.equal(calls[0].url, `https://example.test${MESSAGES_DRAFT_PATH}`);
  assert.equal(JSON.parse(calls[0].init.body).officeId, "office-a");

  const handoff = await requestMessageHandoff({
    workerBase: "https://example.test",
    idToken: "token",
    officeId: "office-a",
    messageId: "msg_1",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({
          ok: true,
          sendState: "OPENED_EXTERNAL",
          providerConfirmedSend: false,
          providerConfirmedDelivery: false
        })
      };
    }
  });
  assert.equal(handoff.ok, true);
  assert.equal(calls[1].url, `https://example.test${MESSAGES_HANDOFF_PATH}`);
  assert.equal(JSON.parse(calls[1].init.body).messageId, "msg_1");
});

test("Worker message routes require auth; outbound Cloud API still blocked", async () => {
  for (const path of ["/messages/draft", "/messages/handoff"]) {
    const response = await worker.fetch(new Request(`https://example.test${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ officeId: "office-a", messageId: "msg_1", channel: "whatsapp" })
    }), { FIREBASE_PROJECT_ID: "aqar-b5d76" });
    assert.notEqual(response.status, 200, path);
    const body = await response.json();
    assert.notEqual(body.error, "outbound_disabled", path);
  }

  const adapters = await worker.fetch(
    new Request("https://example.test/messages/adapters"),
    { FIREBASE_PROJECT_ID: "aqar-b5d76" }
  );
  assert.equal(adapters.status, 200);
  const adapterBody = await adapters.json();
  assert.equal(adapterBody.whatsapp.adapterStatus, "adapter_ready");
  assert.equal(adapterBody.telegram.adapterStatus, "simulated");
  assert.equal(adapterBody.boundaries.sendsWhatsApp, false);

  for (const path of ["/meta/messages", "/meta/phone/send"]) {
    const response = await worker.fetch(
      new Request(`https://example.test${path}`, { method: "POST" }),
      { FIREBASE_PROJECT_ID: "aqar-b5d76" }
    );
    assert.equal(response.status, 403, path);
    assert.equal((await response.json()).error, "outbound_disabled", path);
  }
});

test("Phase 7 wiring: shell loads messaging bridge; workflow persists drafts", () => {
  const shell = readRepositoryFile("public", "index.html");
  assert.ok(shell.includes("js/messaging-domain-bridge.js"));
  assert.ok(shell.includes('data-action="telegram-owner"'));
  assert.ok(shell.includes("إرسال واتساب"));
  assert.equal(shell.includes("مسودة واتساب"), false);

  const workflow = readRepositoryFile("public", "js", "workflow-office.js");
  assert.ok(workflow.includes("persistAndOpenMessageDraft"));
  assert.ok(workflow.includes("requestCreateMessageDraft"));
  assert.ok(workflow.includes("requestMessageHandoff"));
  assert.ok(workflow.includes("OPENED_EXTERNAL"));
  assert.ok(!workflow.includes("providerConfirmedDelivery: true"));

  const workerSrc = readRepositoryFile("worker", "src", "index.js");
  assert.ok(workerSrc.includes("/messages/draft"));
  assert.ok(workerSrc.includes("/messages/handoff"));
  assert.ok(workerSrc.includes("messageDraftToFirestoreFields"));
});
