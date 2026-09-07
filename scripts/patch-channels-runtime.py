from pathlib import Path

index = Path('worker/src/index.js')
s = index.read_text()

anchor = 'import {\n  PUBLIC_RATE_LIMITS,'
imports = '''import {
  handleTelegramCanonicalWebhook,
  telegramWebhookRuntimeContract
} from "./telegram-intake-service.js";
import { channelCleanupBoundaryGuarantees } from "./channel-boundary-domain.js";
'''
if 'from "./telegram-intake-service.js"' not in s:
    if anchor not in s:
        raise SystemExit('index import anchor missing')
    s = s.replace(anchor, imports + anchor, 1)

route_anchor = '''      if (request.method === "POST" && url.pathname === "/meta/webhook") {
        return receiveMetaWebhook(request, env, requestId);
      }
'''
route_block = route_anchor + '''
      if (request.method === "POST" && /^\\/telegram\\/webhook\\/[^/]+$/.test(url.pathname)) {
        return await handleTelegramWebhookRoute(request, env, requestId);
      }
'''
if 'return await handleTelegramWebhookRoute(request, env, requestId);' not in s:
    if route_anchor not in s:
        raise SystemExit('telegram route anchor missing')
    s = s.replace(route_anchor, route_block, 1)

adapters_old = '''          whatsapp: whatsappAdapterContract(),
          telegram: telegramWebhookValidationFixture(),
          boundaries: phase7BoundaryGuarantees(),'''
adapters_new = '''          whatsapp: whatsappAdapterContract(),
          telegram: { ...telegramWebhookValidationFixture(), ...telegramWebhookRuntimeContract() },
          boundaries: { ...phase7BoundaryGuarantees(), ...channelCleanupBoundaryGuarantees() },'''
if adapters_old in s:
    s = s.replace(adapters_old, adapters_new, 1)

fn_start = s.find('async function processInboundMessage({')
fn_end = s.find('\nfunction parseRealEstateMessage(', fn_start)
if fn_start < 0 or fn_end < 0:
    raise SystemExit('processInboundMessage block missing')
new_fn = r'''async function processInboundMessage({ projectId, officeId, inboxDocumentId, messageText, senderName, senderPhone, receivedAt, source = "whatsapp_cloud_api", accessToken, env = null }) {
  const parsed = parseRealEstateMessage(messageText, senderPhone, senderName);
  const sourceChannel = /whatsapp/i.test(String(source || "")) ? "whatsapp"
    : /telegram/i.test(String(source || "")) ? "telegram"
      : "web";
  const canonicalText = [
    cleanText(messageText, 12000),
    senderName ? `اسم المرسل: ${cleanText(senderName, 200)}` : "",
    senderPhone ? `رقم التواصل: ${cleanText(senderPhone, 60)}` : ""
  ].filter(Boolean).join("\n");
  const safeEnv = env || {};
  const channelRequest = {
    url: `${resolveAppOrigin(safeEnv)}/channels/${sourceChannel}/canonical-intake`,
    headers: new Headers()
  };
  const ctx = buildCanonicalIntakeCtx({
    env: safeEnv,
    request: channelRequest,
    identity: null,
    projectId,
    accessToken,
    bucket: safeEnv.IAQAR_MEDIA || null
  });
  const result = await startCanonicalIntake({
    officeId,
    brokerId: `channel_${sourceChannel}_${officeId}`.slice(0, 120),
    contentType: "text",
    text: canonicalText,
    idempotencyKey: `${source}:${officeId}:${inboxDocumentId}`,
    sourceChannel,
    externalEventId: inboxDocumentId,
    senderName: cleanText(senderName, 200),
    senderPhone: cleanText(senderPhone, 60)
  }, ctx);

  const now = new Date();
  await setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "inbox", inboxDocumentId],
    accessToken,
    fields: {
      processingState: firestoreString(result.analysisStatus === "analysis_complete" ? "processed" : "processing"),
      status: firestoreString(result.analysisStatus === "analysis_complete" ? "processed" : "processing"),
      isProcessed: firestoreBoolean(result.analysisStatus === "analysis_complete"),
      classifiedAs: firestoreOptionalString(parsed.kind),
      opportunityId: firestoreOptionalString(result.opportunityId || ""),
      importJobId: firestoreOptionalString(result.importJobId || ""),
      canonicalIntake: firestoreBoolean(true),
      sourceChannel: firestoreString(sourceChannel),
      matchCount: firestoreInteger(0),
      processedAt: result.analysisStatus === "analysis_complete" ? firestoreTimestamp(now) : null,
      updatedAt: firestoreTimestamp(now)
    }
  });

  return {
    kind: parsed.kind,
    matches: 0,
    duplicateOpportunity: Boolean(result.duplicate),
    opportunityId: result.opportunityId || "",
    importJobId: result.importJobId || "",
    analysisStatus: result.analysisStatus || "",
    canonicalIntake: true
  };
}
'''
s = s[:fn_start] + new_fn + s[fn_end:]

shared_anchor = '\nasync function handleSharedIntake(request, env, requestId) {'
handler = r'''
async function handleTelegramWebhookRoute(request, env, requestId) {
  assertFirebaseSecrets(env);
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const bucket = env.IAQAR_MEDIA || null;
  const result = await handleTelegramCanonicalWebhook({
    request,
    env,
    requestId,
    helpers: {
      projectId,
      accessToken,
      bucket,
      fetchImpl: fetch,
      firestoreOfficeId,
      getFirestoreDocument,
      setFirestoreDocument,
      firestoreFieldsToJs,
      compactFields,
      firestoreString,
      firestoreOptionalString,
      firestoreInteger,
      firestoreBoolean,
      firestoreTimestamp,
      ingestCanonical: (body) => startCanonicalIntake(body, buildCanonicalIntakeCtx({
        env,
        request: { url: request.url, headers: request.headers },
        identity: null,
        projectId,
        accessToken,
        bucket
      }))
    }
  });
  return jsonResponse({ ...result, requestId }, Number(result.status || 200));
}
'''
if 'async function handleTelegramWebhookRoute(' not in s:
    if shared_anchor not in s:
        raise SystemExit('telegram handler anchor missing')
    s = s.replace(shared_anchor, handler + shared_anchor, 1)
index.write_text(s)

canonical = Path('worker/src/canonical-intake-service.js')
c = canonical.read_text()
now_anchor = '  const now = new Date();\n\n  const existingJob = await ctx.getFirestoreDocument({'
meta_block = '''  const now = new Date();
  const sourceChannel = ctx.cleanText(body.sourceChannel || body.channel || "", 40).toLowerCase();
  const externalEventId = ctx.cleanText(body.externalEventId || "", 180);
  const externalMessageId = ctx.cleanText(body.externalMessageId || "", 180);
  const senderExternalId = ctx.cleanText(body.senderExternalId || "", 180);

  const existingJob = await ctx.getFirestoreDocument({'''
if 'const sourceChannel = ctx.cleanText(body.sourceChannel' not in c:
    if now_anchor not in c:
        raise SystemExit('canonical metadata anchor missing')
    c = c.replace(now_anchor, meta_block, 1)

opp_anchor = '    sourceType: ctx.firestoreString(parts[0]?.contentType || "text"),\n    sourceReference: ctx.firestoreString(sourceId),'
opp_new = '    sourceType: ctx.firestoreString(parts[0]?.contentType || "text"),\n    sourceChannel: ctx.firestoreOptionalString(sourceChannel),\n    externalEventId: ctx.firestoreOptionalString(externalEventId),\n    externalMessageId: ctx.firestoreOptionalString(externalMessageId),\n    senderExternalId: ctx.firestoreOptionalString(senderExternalId),\n    sourceReference: ctx.firestoreString(sourceId),'
if c.count('sourceChannel: ctx.firestoreOptionalString(sourceChannel)') < 1:
    if opp_anchor not in c:
        raise SystemExit('canonical opportunity anchor missing')
    c = c.replace(opp_anchor, opp_new, 1)

source_anchor = '    sourceType: ctx.firestoreString(parts[0]?.contentType || "text"),\n    deduplicationFingerprint: ctx.firestoreString(fingerprint),'
source_new = '    sourceType: ctx.firestoreString(parts[0]?.contentType || "text"),\n    sourceChannel: ctx.firestoreOptionalString(sourceChannel),\n    externalEventId: ctx.firestoreOptionalString(externalEventId),\n    externalMessageId: ctx.firestoreOptionalString(externalMessageId),\n    senderExternalId: ctx.firestoreOptionalString(senderExternalId),\n    deduplicationFingerprint: ctx.firestoreString(fingerprint),'
if c.count('sourceChannel: ctx.firestoreOptionalString(sourceChannel)') < 2:
    if source_anchor not in c:
        raise SystemExit('canonical source anchor missing')
    c = c.replace(source_anchor, source_new, 1)

job_anchor = '    sourceId: ctx.firestoreString(sourceId),\n    idempotencyKey: ctx.firestoreString(idempotencyKey),'
job_new = '    sourceId: ctx.firestoreString(sourceId),\n    sourceChannel: ctx.firestoreOptionalString(sourceChannel),\n    externalEventId: ctx.firestoreOptionalString(externalEventId),\n    externalMessageId: ctx.firestoreOptionalString(externalMessageId),\n    idempotencyKey: ctx.firestoreString(idempotencyKey),'
if c.count('sourceChannel: ctx.firestoreOptionalString(sourceChannel)') < 3:
    if job_anchor not in c:
        raise SystemExit('canonical job anchor missing')
    c = c.replace(job_anchor, job_new, 1)
canonical.write_text(c)

messaging = Path('worker/src/messaging-domain.js')
m = messaging.read_text()
old = '''export function telegramWebhookValidationFixture() {
  return {
    adapterStatus: ADAPTER_STATUS.TELEGRAM_ADAPTER_SIMULATED,
    requiresSecretTokenHeader: true,
    headerName: "X-Telegram-Bot-Api-Secret-Token",
    outboundEnabled: false,
    inboundEnabled: false,
    note: "Structure only — no production Telegram bot credentials in Phase 7."
  };
}'''
new = '''export function telegramWebhookValidationFixture() {
  return {
    adapterStatus: ADAPTER_STATUS.WHATSAPP_ADAPTER_READY,
    outboundAdapterStatus: ADAPTER_STATUS.TELEGRAM_ADAPTER_SIMULATED,
    requiresSecretTokenHeader: true,
    headerName: "X-Telegram-Bot-Api-Secret-Token",
    route: "/telegram/webhook/:officeId",
    outboundEnabled: false,
    inboundEnabled: true,
    requiresRuntimeConfiguration: true,
    canonicalIntakeOnly: true,
    note: "Inbound runtime is implemented; bot token/webhook secret/office scope must be configured before live use."
  };
}'''
if old in m:
    m = m.replace(old, new, 1)
elif 'inboundEnabled: false' in m and 'telegramWebhookValidationFixture' in m:
    raise SystemExit('telegram fixture shape changed unexpectedly')
messaging.write_text(m)
