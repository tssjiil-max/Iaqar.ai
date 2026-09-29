import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import worker, { findAndSaveMatchesForOpportunity } from "../worker/src/index.js";
import { projectOperationToUiItem } from "../public/js/operations-domain.js";
import { buildOpportunityActionIndex, projectOpportunityAction } from "../public/js/opportunity-action-projection-domain.js";
import { mapOperationsItemsToDailyTasks } from "../src/v2/content/daily-tasks/domain.js";
import { buildDailyTaskCardHtml } from "../src/v2/content/daily-tasks/card.js";

// Real Worker + in-memory Firestore REST double: the Match workspace flow on one
// exact matchId, in an office with more than one page of operations.

const PROJECT = "demo-iaqar";
const OFFICE = "office-negotiation";
const UID = "broker-negotiation";
const REQUEST_ID = "opp_request_negotiation";
const OFFER_ID = "opp_offer_negotiation";

function toValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { integerValue: String(value) };
  return { stringValue: String(value) };
}
function fromValue(v = {}) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromValue(x)]));
  return null;
}
const b64url = (value) => Buffer.from(value).toString("base64url");

// One signing key for the file: the Worker caches the JWKS it fetched.
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "neg-kid", alg: "RS256", use: "sig" };

function setup() {
  const docs = new Map();
  const fcmCalls = [];
  const fcmAttempts = [];
  // One-shot injected failures: { host, method, pathIncludes, maskIncludes }.
  const failures = [];
  let clock = 0;
  const base = `/v1/projects/${PROJECT}/databases/(default)/documents/`;
  const write = (p, fields, mask) => {
    const merged = mask && mask.length ? { ...(docs.get(p)?.fields || {}) } : {};
    for (const key of mask && mask.length ? mask : Object.keys(fields)) {
      if (key in fields) merged[key] = fields[key]; else delete merged[key];
    }
    docs.set(p, { fields: merged, updateTime: new Date(Date.UTC(2026, 8, 29, 9) + (++clock) * 1000).toISOString() });
  };
  const listPaths = (collection) => [...docs.keys()]
    .filter((p) => p.startsWith(`${collection}/`) && !p.slice(collection.length + 1).includes("/")).sort();
  const docJson = (p) => ({ name: `projects/${PROJECT}/databases/(default)/documents/${p}`, fields: docs.get(p).fields, updateTime: docs.get(p).updateTime });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || "GET").toUpperCase();
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "neg-access", expires_in: 3600 });
    if (url.hostname === "www.googleapis.com") return Response.json({ keys: [jwk] });
    const failureIndex = failures.findIndex((f) => url.hostname.startsWith(f.host)
      && (!f.method || f.method === method)
      && (!f.pathIncludes || decodeURIComponent(url.pathname).includes(f.pathIncludes))
      && (!f.maskIncludes || url.searchParams.getAll("updateMask.fieldPaths").includes(f.maskIncludes)));
    if (url.hostname === "fcm.googleapis.com") fcmAttempts.push(Date.now());
    if (failureIndex >= 0) {
      failures.splice(failureIndex, 1);
      return Response.json({ error: { status: "UNAVAILABLE", message: "injected failure" } }, { status: 503 });
    }
    if (url.hostname === "fcm.googleapis.com") { fcmCalls.push(JSON.parse(init.body || "{}")); return Response.json({ name: `projects/x/messages/${fcmCalls.length}` }); }
    if (url.hostname !== "firestore.googleapis.com") return Response.json({ ok: true });
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith(":commit")) {
      for (const w of JSON.parse(init.body || "{}").writes || []) if (w.update) write(w.update.name.split("/documents/")[1], w.update.fields || {}, w.updateMask?.fieldPaths);
      return Response.json({ writeResults: [] });
    }
    if (pathname.includes(":")) return Response.json([]);
    const p = pathname.slice(base.length);
    if (method === "GET" && p.split("/").length % 2 === 1) {
      // Real list paging: only the first `pageSize` documents by id.
      return Response.json({ documents: listPaths(p).slice(0, Number(url.searchParams.get("pageSize") || 20)).map(docJson) });
    }
    if (method === "GET") return docs.has(p) ? Response.json(docJson(p)) : new Response("{}", { status: 404 });
    if (method === "PATCH") {
      // Firestore preconditions: create-only and optimistic updateTime.
      if (url.searchParams.get("currentDocument.exists") === "false" && docs.has(p)) return Response.json({ error: { status: "ALREADY_EXISTS" } }, { status: 409 });
      const expected = url.searchParams.get("currentDocument.updateTime");
      if (expected && docs.get(p)?.updateTime !== expected) return Response.json({ error: { status: "FAILED_PRECONDITION" } }, { status: 400 });
      write(p, JSON.parse(init.body || "{}").fields || {}, url.searchParams.getAll("updateMask.fieldPaths"));
      return Response.json(docJson(p));
    }
    return new Response("unsupported", { status: 500 });
  };
  const seed = (p, obj) => write(p, Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toValue(v)])), null);
  const get = (p) => (docs.has(p) ? { id: p.split("/").pop(), ...Object.fromEntries(Object.entries(docs.get(p).fields).map(([k, v]) => [k, fromValue(v)])) } : null);
  const list = (c) => listPaths(c).map((p) => get(p));
  const token = () => {
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: "RS256", kid: "neg-kid", typ: "JWT" }));
    const claims = b64url(JSON.stringify({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: UID, iat: now, exp: now + 3600 }));
    return `${head}.${claims}.${b64url(crypto.sign("RSA-SHA256", Buffer.from(`${head}.${claims}`), privateKey))}`;
  };
  const sa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const env = { FIREBASE_PROJECT_ID: PROJECT, FIREBASE_CLIENT_EMAIL: "neg@demo.iam.gserviceaccount.com", FIREBASE_PRIVATE_KEY: sa.privateKey, FIREBASE_PRIVATE_KEY_ID: "0123456789abcdef0123456789abcdef01234567", DEPLOYMENT_ENV: "staging" };

  seed(`offices/${OFFICE}`, { officeName: "مكتب التفاوض", ownerUid: UID, active: true });
  seed(`offices/${OFFICE}/members/${UID}`, { uid: UID, role: "owner", active: true });
  const listing = { officeId: OFFICE, city: "الرياض", district: "النرجس", propertyType: "شقة", lifecycleStatus: "ACTIVE", version: 1 };
  seed(`offices/${OFFICE}/opportunities/${REQUEST_ID}`, { ...listing, opportunityKind: "REQUEST", purpose: "PURCHASE", advertiserRole: "CLIENT", budget: 900000, priceOrBudget: 900000, contactPhone: "0551110001", brokerId: UID });
  seed(`offices/${OFFICE}/opportunities/${OFFER_ID}`, { ...listing, opportunityKind: "OFFER", purpose: "SALE", advertiserRole: "OWNER", salePrice: 880000, priceOrBudget: 880000, contactPhone: "0552220002", brokerId: UID });
  seed(`offices/${OFFICE}/devices/device-broker`, { fcmRegistrationId: "fid-broker-1", registrationType: "fid", userUid: UID, enabled: true });
  // More than one page of operations, sorted ahead of the real MATCH_REVIEW id.
  for (let i = 0; i < 150; i += 1) seed(`offices/${OFFICE}/operations/op_00000${String(i).padStart(5, "0")}`, { officeId: OFFICE, type: "OPPORTUNITY_REVIEW", status: "COMPLETED", opportunityId: `filler_${i}` });

  const call = async (pathname, body) => {
    const response = await worker.fetch(new Request(`https://worker.test${pathname}`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token()}` }, body: JSON.stringify(body)
    }), env, { waitUntil() {} });
    return { status: response.status, body: await response.json() };
  };
  const party = async (method, pathname, body) => {
    const response = await worker.fetch(new Request(`https://worker.test${pathname}`, {
      method, headers: { "content-type": "application/json", "CF-Connecting-IP": `10.0.0.${Math.floor(Math.random() * 250)}` },
      body: method === "GET" ? undefined : JSON.stringify(body || {})
    }), env, { waitUntil() {} });
    return { status: response.status, body: await response.json() };
  };
  return { env, get, list, call, party, fcmCalls, fcmAttempts, failNext: (failure) => failures.push(failure), restore() { globalThis.fetch = originalFetch; } };
}

async function withMatch(fn) {
  const h = setup();
  try {
    await findAndSaveMatchesForOpportunity({ projectId: PROJECT, officeId: OFFICE, opportunityId: REQUEST_ID, accessToken: "neg-access", notify: false, env: h.env });
    const match = h.list(`offices/${OFFICE}/matches`)[0];
    const operation = h.list(`offices/${OFFICE}/operations`).find((op) => op.type === "MATCH_REVIEW");
    assert.ok(match && operation, "real match and MATCH_REVIEW operation");
    assert.ok(h.list(`offices/${OFFICE}/operations`).findIndex((op) => op.id === operation.id) >= 100, "operation is beyond the first list page");
    const record = (input) => h.call("/workflow/action", { officeId: OFFICE, recordId: match.id, action: "record_negotiation_activity", ...input });
    await fn({ ...h, match, operation, record, op: () => h.get(`offices/${OFFICE}/operations/${operation.id}`), matchDoc: () => h.get(`offices/${OFFICE}/matches/${match.id}`) });
  } finally {
    h.restore();
  }
}

const activityOf = (doc) => JSON.parse(doc.negotiationActivityJson || "[]");
const stateOf = (doc) => JSON.parse(doc.matchStateJson || "{}");

async function mintLinks(h, match) {
  const tokens = {};
  for (const side of ["client", "owner"]) {
    const minted = await h.call("/party/sessions", { officeId: OFFICE, matchId: match.id, party: side, offerId: OFFER_ID, requestId: REQUEST_ID });
    assert.equal(minted.status, 200, JSON.stringify(minted.body));
    tokens[side] = minted.body.token;
  }
  return tokens;
}

test("party session handoff stamps the MATCH_REVIEW operation even beyond the first page", async () => {
  await withMatch(async ({ call, match, op, matchDoc }) => {
    const minted = await call("/party/sessions", { officeId: OFFICE, matchId: match.id, party: "client", offerId: OFFER_ID, requestId: REQUEST_ID });
    assert.equal(minted.status, 200, JSON.stringify(minted.body));
    assert.equal(matchDoc().livingStage, "WAITING_CLIENT");
    assert.equal(op().livingStage, "WAITING_CLIENT", "operation must follow the match, not stay on تطابق جديد");
  });
});

test("repeated client and owner sends are events on the exact match and never lock", async () => {
  await withMatch(async ({ record, op, matchDoc, match }) => {
    for (const party of ["client", "client", "owner", "owner"]) {
      const result = await record({ kind: "party_send", party });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.matchId, match.id);
      assert.equal(result.body.entry.eventType, "WHATSAPP_OPENED");
      assert.equal(result.body.entry.matchId, match.id);
    }
    const summary = (await record({ kind: "party_send", party: "client" })).body.summary;
    assert.equal(summary.clientSendCount, 3);
    assert.equal(summary.ownerSendCount, 2);
    assert.equal(activityOf(op()).length, 5);
    assert.equal(activityOf(matchDoc()).length, 5);
  });
});

test("broker messages reach the chosen party link; the internal note never does", async () => {
  await withMatch(async ({ record, get, match, op, list }) => {
    for (const [party, message] of [["client", "أولى"], ["client", "ثانية"], ["owner", "للمالك"], ["both", "للطرفين"]]) {
      const result = await record({ kind: "broker_message", party, message });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.entry.eventType, "BROKER_MESSAGE");
      assert.equal(result.body.entry.recipient, party);
    }
    const note = await record({ kind: "internal_note", party: "client", message: "ملاحظة سرية" });
    assert.equal(note.body.entry.eventType, "BROKER_INTERNAL_NOTE");
    assert.equal(note.body.entry.recipient, "internal");
    const session = JSON.parse(get(`offices/${OFFICE}/coordinationSessions/${match.id}`).coordinationJson);
    assert.deepEqual(session.brokerNotes.map((n) => `${n.audience}:${n.message}`), ["client:أولى", "client:ثانية", "owner:للمالك", "both:للطرفين"]);
    assert.equal(JSON.stringify(session).includes("ملاحظة سرية"), false);
    const log = activityOf(op());
    assert.equal(log.filter((e) => e.eventType === "BROKER_MESSAGE").length, 4);
    assert.equal(log.filter((e) => e.eventType === "BROKER_INTERNAL_NOTE").length, 1);
    // WhatsApp payloads: client ×2 + owner ×1 + both (client+owner) = 5, one per message/recipient.
    const whatsapp = list(`offices/${OFFICE}/notificationDispatches`).filter((d) => d.channel === "whatsapp");
    assert.equal(whatsapp.length, 5);
    assert.ok(whatsapp.every((d) => ["PENDING_BROKER_HANDOFF", "MISSING_PHONE"].includes(d.status)));
    assert.ok(!whatsapp.some((d) => /SENT|DELIVERED|READ/.test(d.status)));
    assert.equal((await record({ kind: "broker_message", party: "client", message: "  " })).status, 400);
  });
});

test("party events come from each party's own link; history kept, latest is current", async () => {
  await withMatch(async (h) => {
    const tokens = await mintLinks(h, h.match);
    const clientPath = `/party/sessions/${encodeURIComponent(tokens.client)}`;
    const ownerPath = `/party/sessions/${encodeURIComponent(tokens.owner)}`;
    assert.equal((await h.party("POST", `${clientPath}/opened`, { openId: "tab-1" })).status, 200);
    assert.equal((await h.party("POST", `${clientPath}/opened`, { openId: "tab-1" })).body.duplicate, true, "refresh of the same tab is not a new LINK_OPENED");
    for (const choiceId of ["interested", "needs_time", "preliminary_agreement"]) {
      const result = await h.party("POST", `${clientPath}/event`, { choiceId, clientEventId: `c-${choiceId}` });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.event.actorType, "client");
      assert.equal(result.body.event.source, "party_link");
      assert.equal(result.body.event.matchId, h.match.id);
    }
    await h.party("POST", `${ownerPath}/opened`, { openId: "owner-tab" });
    await h.party("POST", `${ownerPath}/event`, { choiceId: "interested", clientEventId: "o-1" });
    const needsTime = await h.party("POST", `${ownerPath}/event`, { choiceId: "needs_time", clientEventId: "o-2" });
    assert.equal(needsTime.body.event.eventType, "OWNER_NEEDS_TIME");
    assert.equal((await h.party("POST", `${ownerPath}/event`, { choiceId: "drop_table" })).status, 400);

    const events = activityOf(h.op());
    assert.deepEqual(events.filter((e) => e.actorType === "client" && e.eventType !== "LINK_OPENED").map((e) => e.eventType),
      ["CLIENT_INTERESTED", "CLIENT_NEEDS_TIME", "CLIENT_PRELIMINARY_AGREEMENT"]);
    assert.equal(events.filter((e) => e.eventType === "LINK_OPENED").length, 2);
    for (const e of events) {
      for (const key of ["eventId", "matchId", "officeId", "actorType", "eventType", "payload", "createdAt", "source"]) assert.ok(key in e, `${key} missing`);
      assert.equal(e.matchId, h.match.id);
      assert.ok(!/^op_/.test(e.matchId));
    }
    const state = stateOf(h.matchDoc());
    assert.equal(state.client.choiceId, "preliminary_agreement");
    assert.equal(state.owner.choiceId, "needs_time");
    assert.equal(h.list(`offices/${OFFICE}/matches/${h.match.id}/events`).length, events.length, "every event is a persisted document");

    // Party page view after a "refresh": current choice and ACTIVE link.
    const view = (await h.party("GET", clientPath)).body.view;
    assert.equal(view.negotiation.current.choiceId, "preliminary_agreement");
    assert.equal(view.negotiation.readOnly, false);
    assert.equal(view.negotiation.lifecycle, "ACTIVE");
    assert.ok(view.negotiation.events.some((e) => e.label === "المالك طلب وقتًا للرد"), "client sees the owner's update");
    assert.ok(!view.negotiation.events.some((e) => e.eventType === "BROKER_INTERNAL_NOTE"));
    const ownerView = (await h.party("GET", ownerPath)).body.view;
    assert.equal(ownerView.negotiation.current.choiceId, "needs_time");
    const polled = (await h.party("GET", `${clientPath}/state`)).body;
    assert.ok(polled.stateVersion.endsWith("|ACTIVE"));
  });
});

test("FCM to the broker and WhatsApp payload to the other party are created exactly once per event", async () => {
  await withMatch(async (h) => {
    const tokens = await mintLinks(h, h.match);
    const clientPath = `/party/sessions/${encodeURIComponent(tokens.client)}`;
    const first = await h.party("POST", `${clientPath}/event`, { choiceId: "interested", clientEventId: "retry-me" });
    assert.equal(first.status, 200);
    // Retry / reconnect / double tap: the same clientEventId is the same event.
    const retry = await h.party("POST", `${clientPath}/event`, { choiceId: "interested", clientEventId: "retry-me" });
    assert.equal(retry.body.duplicate, true);
    assert.equal(retry.body.event.eventId, first.body.event.eventId);
    const dispatches = h.list(`offices/${OFFICE}/notificationDispatches`).filter((d) => d.eventId === first.body.event.eventId);
    assert.deepEqual(dispatches.map((d) => `${d.recipient}:${d.channel}`).sort(), ["broker:fcm", "owner:whatsapp"]);
    assert.equal(h.fcmCalls.length, 1, "one FCM send for one event");
    assert.equal(dispatches.find((d) => d.channel === "fcm").status, "DISPATCHED");
    const whatsapp = dispatches.find((d) => d.channel === "whatsapp");
    assert.equal(whatsapp.status, "PENDING_BROKER_HANDOFF");
    assert.equal(whatsapp.phone, "966552220002");
    assert.match(whatsapp.text, /مهتم/);
    assert.equal(JSON.parse(h.op().whatsappOutboxJson).length, 1);
    // Broker opens the handoff: WHATSAPP_OPENED only (never sent/delivered/read), once.
    const opened = await h.call("/workflow/action", { officeId: OFFICE, recordId: h.match.id, action: "whatsapp_handoff_opened", dispatchId: whatsapp.id });
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.equal(opened.body.entry.eventType, "WHATSAPP_OPENED");
    assert.equal(h.get(`offices/${OFFICE}/notificationDispatches/${whatsapp.id}`).status, "WHATSAPP_OPENED");
    assert.equal(JSON.parse(h.op().whatsappOutboxJson).length, 0);
    await h.call("/workflow/action", { officeId: OFFICE, recordId: h.match.id, action: "whatsapp_handoff_opened", dispatchId: whatsapp.id });
    assert.equal(activityOf(h.op()).filter((e) => e.eventType === "WHATSAPP_OPENED").length, 1);
    // LINK_OPENED is recorded but never pushes FCM.
    await h.party("POST", `${clientPath}/opened`, { openId: "x" });
    assert.equal(h.fcmCalls.length, 1);
  });
});

test("unread counts party events after the broker last looked; mark seen clears this match only", async () => {
  await withMatch(async (h) => {
    const tokens = await mintLinks(h, h.match);
    const clientPath = `/party/sessions/${encodeURIComponent(tokens.client)}`;
    await h.party("POST", `${clientPath}/event`, { choiceId: "interested", clientEventId: "u1" });
    await h.party("POST", `${clientPath}/event`, { choiceId: "needs_time", clientEventId: "u2" });
    const { brokerUnreadCount } = await import("../public/js/match-event-domain.js");
    assert.equal(brokerUnreadCount(h.op().negotiationActivityJson, h.op().brokerSeenAt), 2);
    const seen = await h.call("/workflow/action", { officeId: OFFICE, recordId: h.match.id, action: "mark_match_seen" });
    assert.equal(seen.status, 200);
    assert.equal(brokerUnreadCount(h.op().negotiationActivityJson, h.op().brokerSeenAt), 0);
    assert.equal(activityOf(h.op()).filter((e) => e.actorType === "client").length, 2, "events are kept");
    await h.party("POST", `${clientPath}/event`, { choiceId: "viewing", clientEventId: "u3" });
    assert.equal(brokerUnreadCount(h.op().negotiationActivityJson, h.op().brokerSeenAt), 1);
  });
});

test("agreement updates keep current state and history", async () => {
  await withMatch(async (h) => {
    const tokens = await mintLinks(h, h.match);
    await h.record({ kind: "agreement_update", field: "price", value: "860,000 ريال" });
    await h.party("POST", `/party/sessions/${encodeURIComponent(tokens.owner)}/event`, { agreement: { field: "price", value: "870,000 ريال" }, clientEventId: "a1" });
    await h.record({ kind: "agreement_update", field: "paymentMethod", value: "تمويل بنكي" });
    const state = stateOf(h.matchDoc());
    assert.equal(state.agreement.price.value, "870,000 ريال");
    assert.equal(state.agreement.paymentMethod.value, "تمويل بنكي");
    assert.equal(activityOf(h.op()).filter((e) => e.eventType === "AGREEMENT_UPDATED").length, 3);
    assert.equal((await h.record({ kind: "agreement_update", field: "color", value: "x" })).status, 400);
  });
});

test("closed without agreement and agreed are read-only for both parties; history kept", async () => {
  await withMatch(async (h) => {
    const tokens = await mintLinks(h, h.match);
    const clientPath = `/party/sessions/${encodeURIComponent(tokens.client)}`;
    await h.party("POST", `${clientPath}/event`, { choiceId: "interested", clientEventId: "r1" });
    const closed = await h.call("/workflow/action", { officeId: OFFICE, recordId: h.match.id, action: "close_match", note: "لا اتفاق" });
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    for (const side of ["client", "owner"]) {
      const view = (await h.party("GET", `/party/sessions/${encodeURIComponent(tokens[side])}`)).body.view;
      assert.equal(view.negotiation.readOnly, true);
      assert.equal(view.negotiation.lifecycle, "CLOSED_NO_AGREEMENT");
      assert.deepEqual(view.actions, []);
    }
    const blocked = await h.party("POST", `${clientPath}/event`, { choiceId: "needs_time", clientEventId: "r2" });
    assert.equal(blocked.status, 409);
    const blockedBroker = await h.record({ kind: "broker_message", party: "client", message: "بعد الإغلاق" });
    assert.equal(blockedBroker.status, 409);
    const events = activityOf(h.op());
    assert.ok(events.some((e) => e.eventType === "CLIENT_INTERESTED"), "history is kept");
    assert.equal(events.at(-1).eventType, "MATCH_CLOSED_NO_AGREEMENT");
  });
});

test("an operation id is never accepted as the matchId", async () => {
  await withMatch(async ({ call, operation }) => {
    const result = await call("/workflow/action", { officeId: OFFICE, recordId: operation.id, action: "record_negotiation_activity", kind: "party_send", party: "client" });
    assert.equal(result.status, 404);
  });
});

test("a worked match projects to متابعة, never back to تطابق جديد, and renders stable workspace data", async () => {
  await withMatch(async (h) => {
    const { record, op, match, list } = h;
    const untouched = projectOpportunityAction(projectOperationToUiItem(op()));
    assert.equal(untouched.badge, "تطابق جديد");
    const tokens = await mintLinks(h, match);
    await record({ kind: "party_send", party: "client" });
    await record({ kind: "party_send", party: "owner" });
    await h.party("POST", `/party/sessions/${encodeURIComponent(tokens.client)}/event`, { choiceId: "interested", clientEventId: "w1" });
    await record({ kind: "broker_message", party: "both", message: "موعد المعاينة الخميس" });
    await record({ kind: "internal_note", message: "العميل مستعجل" });
    const item = projectOperationToUiItem(op());
    const action = projectOpportunityAction(item);
    assert.notEqual(action.badge, "تطابق جديد");
    const index = buildOpportunityActionIndex([item], { officeId: OFFICE });
    const onRequest = index.get(REQUEST_ID);
    assert.ok(onRequest.filterMemberships.includes("follow_up"));
    assert.equal(onRequest.matchId, match.id);

    const opportunities = list(`offices/${OFFICE}/opportunities`).map((o) => ({ ...o, recordId: o.id, opportunityId: o.id, recordType: "opportunity" }));
    const [task] = mapOperationsItemsToDailyTasks([item, ...opportunities], new Date(), { officeId: OFFICE });
    assert.equal(task.matchId, match.id);
    const html = buildDailyTaskCardHtml(task, { open: true });
    assert.match(html, /data-party-send="client"[^>]*>إعادة الإرسال للعميل</);
    assert.match(html, /data-party-send="owner"[^>]*>إعادة الإرسال للمالك</);
    assert.doesNotMatch(html, /data-party-send="(client|owner)"[^>]*disabled/);
    assert.match(html, /حالة العميل الحالية: <strong>مهتم<\/strong> <small>\(من رابط العميل\)/);
    assert.match(html, /data-last-update><strong>آخر تحديث:<\/strong>/);
    assert.match(html, /العميل اختار: مهتم/);
    assert.match(html, /رسالة الوسيط إلى الطرفان/);
    assert.match(html, /data-log-recipient>المستلم: داخلي/);
    assert.match(html, /data-whatsapp-handoff=/);
    assert.match(html, new RegExp(`data-match-id="${match.id}"`));
    assert.doesNotMatch(html, /undefined|غير محدد/);
    const collapsed = buildDailyTaskCardHtml(task, { open: false });
    assert.match(collapsed, /data-unread-updates="1">1 تحديث جديد/);
  });
});

test("an engaged match outranks an untouched sibling candidate on the same card", () => {
  const base = { officeId: OFFICE, status: "OPEN", operationType: "MATCH_REVIEW", opportunityId: REQUEST_ID, clientRequestId: REQUEST_ID };
  const untouched = { ...base, id: "op_b", matchId: "mat_b", createdAt: "2026-09-29T10:00:00Z", updatedAt: "2026-09-29T10:00:00Z" };
  const engaged = { ...base, id: "op_a", matchId: "mat_a", createdAt: "2026-09-28T10:00:00Z", updatedAt: "2026-09-28T10:00:00Z",
    negotiationActivityJson: JSON.stringify([{ eventId: "ev_1", matchId: "mat_a", officeId: OFFICE, actorType: "broker", eventType: "WHATSAPP_OPENED", recipient: "client", payload: { handoff: "link" }, createdAt: "2026-09-29T09:00:00Z", source: "broker_workspace" }]) };
  for (const order of [[untouched, engaged], [engaged, untouched]]) {
    const action = buildOpportunityActionIndex(order, { officeId: OFFICE }).get(REQUEST_ID);
    assert.equal(action.matchId, "mat_a");
    assert.notEqual(action.badge, "تطابق جديد");
  }
});

test("broker-recorded party options persist, can change, and are marked as recorded by the broker", async () => {
  await withMatch(async ({ record, op }) => {
    await record({ kind: "party_choice", party: "client", choiceId: "interested" });
    await record({ kind: "party_choice", party: "client", choiceId: "not_interested" });
    const owner = await record({ kind: "party_choice", party: "owner", choiceId: "equipment" });
    assert.equal(owner.body.summary.client.choiceId, "not_interested");
    assert.equal(owner.body.summary.owner.label, "التجهيزات");
    assert.equal(owner.body.entry.actorType, "broker");
    assert.equal(owner.body.entry.eventType, "OWNER_CONDITION_CHANGED");
    assert.equal((await record({ kind: "party_choice", party: "owner", choiceId: "drop_table" })).status, 400);
    const choices = activityOf(op()).filter((entry) => /^(CLIENT|OWNER)_/.test(entry.eventType));
    assert.deepEqual(choices.map((entry) => entry.payload.choiceId), ["interested", "not_interested", "equipment"]);
  });
});

test("event created + projection fails once + retry → projection completes exactly once, then notifications", async () => {
  await withMatch(async (h) => {
    const tokens = await mintLinks(h, h.match);
    const eventPath = `/party/sessions/${encodeURIComponent(tokens.client)}/event`;
    // 1) The Match projection write fails once, after the event document is stored.
    h.failNext({ host: "firestore", method: "PATCH", pathIncludes: `/matches/${h.match.id}`, maskIncludes: "negotiationActivityJson" });
    const failed = await h.party("POST", eventPath, { choiceId: "interested", clientEventId: "proj-1" });
    assert.ok(failed.status >= 500, `first attempt must fail: ${failed.status}`);
    const stored = h.list(`offices/${OFFICE}/matches/${h.match.id}/events`).filter((e) => e.eventType === "CLIENT_INTERESTED");
    assert.equal(stored.length, 1, "event document is stored");
    assert.equal(activityOf(h.matchDoc()).some((e) => e.eventType === "CLIENT_INTERESTED"), false, "projection not applied yet");
    assert.equal(h.list(`offices/${OFFICE}/notificationDispatches`).length, 0, "no notification before the projection");
    assert.equal(h.fcmCalls.length, 0);
    // 2) Retry with the same client event id completes the projection once.
    const retry = await h.party("POST", eventPath, { choiceId: "interested", clientEventId: "proj-1" });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.duplicate, true);
    assert.equal(retry.body.event.eventId, stored[0].eventId);
    for (const doc of [h.matchDoc(), h.op()]) {
      assert.equal(activityOf(doc).filter((e) => e.eventId === stored[0].eventId).length, 1);
      assert.equal(stateOf(doc).client.choiceId, "interested");
    }
    assert.equal(h.fcmCalls.length, 1, "notification sent once, after the projection");
    // 3) Replaying again changes nothing and sends nothing.
    const before = h.matchDoc().negotiationActivityJson;
    await h.party("POST", eventPath, { choiceId: "interested", clientEventId: "proj-1" });
    assert.equal(h.matchDoc().negotiationActivityJson, before);
    assert.equal(h.fcmCalls.length, 1);
    assert.equal(stateOf(h.matchDoc()).eventCount, activityOf(h.matchDoc()).length, "state applied the event exactly once");

    // Same recovery when the MATCH_REVIEW operation mirror write fails.
    h.failNext({ host: "firestore", method: "PATCH", pathIncludes: `/operations/${h.operation.id}`, maskIncludes: "negotiationActivityJson" });
    const opFail = await h.party("POST", eventPath, { choiceId: "needs_time", clientEventId: "proj-2" });
    assert.ok(opFail.status >= 500);
    assert.equal(stateOf(h.op()).client.choiceId, "interested", "operation still stale");
    assert.equal((await h.party("POST", eventPath, { choiceId: "needs_time", clientEventId: "proj-2" })).status, 200);
    assert.equal(stateOf(h.op()).client.choiceId, "needs_time");
    assert.equal(activityOf(h.op()).filter((e) => e.eventType === "CLIENT_NEEDS_TIME").length, 1);
    assert.equal(stateOf(h.matchDoc()).eventCount, activityOf(h.matchDoc()).length);
  });
});

test("FCM fails once + retry → one successful delivery, never two", async () => {
  await withMatch(async (h) => {
    const tokens = await mintLinks(h, h.match);
    const eventPath = `/party/sessions/${encodeURIComponent(tokens.client)}/event`;
    h.failNext({ host: "fcm" });
    const first = await h.party("POST", eventPath, { choiceId: "interested", clientEventId: "fcm-1" });
    assert.equal(first.status, 200, "the event itself succeeds");
    const fcmRecord = () => h.list(`offices/${OFFICE}/notificationDispatches`).find((d) => d.channel === "fcm" && d.eventId === first.body.event.eventId);
    assert.equal(fcmRecord().status, "FAILED");
    assert.equal(fcmRecord().attempts, "1");
    assert.equal(h.fcmCalls.length, 0);
    // Retry the same event: FAILED is retried once and succeeds.
    await h.party("POST", eventPath, { choiceId: "interested", clientEventId: "fcm-1" });
    assert.equal(fcmRecord().status, "DISPATCHED");
    assert.equal(fcmRecord().attempts, "2");
    assert.equal(h.fcmCalls.length, 1);
    // Further retries never send again.
    await h.party("POST", eventPath, { choiceId: "interested", clientEventId: "fcm-1" });
    assert.equal(h.fcmCalls.length, 1);
    assert.equal(h.fcmAttempts.length, 2);
    // Two concurrent retries of a FAILED dispatch: one claim, one send.
    h.failNext({ host: "fcm" });
    const second = await h.party("POST", eventPath, { choiceId: "needs_time", clientEventId: "fcm-2" });
    const secondRecord = () => h.list(`offices/${OFFICE}/notificationDispatches`).find((d) => d.channel === "fcm" && d.eventId === second.body.event.eventId);
    assert.equal(secondRecord().status, "FAILED");
    await Promise.all([
      h.party("POST", eventPath, { choiceId: "needs_time", clientEventId: "fcm-2" }),
      h.party("POST", eventPath, { choiceId: "needs_time", clientEventId: "fcm-2" })
    ]);
    assert.equal(secondRecord().status, "DISPATCHED");
    assert.equal(h.fcmCalls.length, 2, "one success per event");
    // The WhatsApp handoff stays as it was: created once, pending the broker.
    const whatsapp = h.list(`offices/${OFFICE}/notificationDispatches`).filter((d) => d.channel === "whatsapp" && d.eventId === first.body.event.eventId);
    assert.equal(whatsapp.length, 1);
    assert.equal(whatsapp[0].status, "PENDING_BROKER_HANDOFF");
  });
});

test("replyable broker message: viewing message → client contextual replies → linked response, broker FCM once", async () => {
  await withMatch(async (h) => {
    const tokens = await mintLinks(h, h.match);
    const clientPath = `/party/sessions/${encodeURIComponent(tokens.client)}`;
    const ownerPath = `/party/sessions/${encodeURIComponent(tokens.owner)}`;
    const sent = await h.record({ kind: "broker_message", party: "client", message: "المعاينة غدًا بعد العشاء", messageKind: "viewing", requiresReply: true, clientEventId: "m-1" });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const messageEventId = sent.body.entry.eventId;
    assert.equal(sent.body.entry.payload.messageKind, "viewing");
    assert.equal(sent.body.entry.payload.requiresReply, true);
    assert.deepEqual(sent.body.entry.payload.replyOptions.map((o) => o.id), ["accept", "time_not_suitable", "propose_other_time", "will_whatsapp"]);

    // Client sees the contextual replies under that exact message.
    const clientView = (await h.party("GET", clientPath)).body.view.negotiation;
    const thread = clientView.messages.find((m) => m.eventId === messageEventId);
    assert.ok(thread, "message on the client link");
    assert.equal(thread.canReply, true);
    assert.deepEqual(thread.replyOptions.map((o) => o.label), ["موافق", "الوقت غير مناسب", "اقترح موعدًا آخر", "سأتواصل واتساب"]);
    // Owner does not see a client-only message and cannot reply to it.
    const ownerView = (await h.party("GET", ownerPath)).body.view.negotiation;
    assert.equal(ownerView.messages.some((m) => m.eventId === messageEventId), false);
    const ownerReply = await h.party("POST", `${ownerPath}/event`, { replyToEventId: messageEventId, responseId: "accept", clientEventId: "o-r1" });
    assert.equal(ownerReply.status, 403);

    // Client replies "موافق".
    const fcmBefore = h.fcmCalls.length;
    const reply = await h.party("POST", `${clientPath}/event`, { replyToEventId: messageEventId, responseId: "accept", clientEventId: "c-r1" });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    const response = reply.body.event;
    assert.equal(response.eventType, "CLIENT_MESSAGE_RESPONSE");
    assert.equal(response.actorType, "client");
    assert.deepEqual([response.payload.replyToEventId, response.payload.responseId, response.payload.responseLabel], [messageEventId, "accept", "موافق"]);
    // Broker side: the response is on the operation (live feed) and linked to the message.
    const onOp = activityOf(h.op()).filter((e) => e.eventType === "CLIENT_MESSAGE_RESPONSE");
    assert.equal(onOp.length, 1);
    assert.equal(onOp[0].payload.replyToEventId, messageEventId);
    const fcm = h.list(`offices/${OFFICE}/notificationDispatches`).filter((d) => d.channel === "fcm" && d.eventId === response.eventId);
    assert.equal(fcm.length, 1);
    assert.equal(fcm[0].status, "DISPATCHED");
    assert.equal(h.fcmCalls.length, fcmBefore + 1);
    assert.equal(h.list(`offices/${OFFICE}/notificationDispatches`).filter((d) => d.channel === "whatsapp" && d.eventId === response.eventId).length, 0, "no automatic WhatsApp for a reply");
    // Not a match-level choice: global state untouched.
    assert.equal(stateOf(h.matchDoc()).client, null);

    // Retry (same clientEventId) and refresh: no duplicate.
    const retry = await h.party("POST", `${clientPath}/event`, { replyToEventId: messageEventId, responseId: "accept", clientEventId: "c-r1" });
    assert.equal(retry.body.duplicate, true);
    assert.equal(retry.body.event.eventId, response.eventId);
    for (let i = 0; i < 2; i += 1) {
      const refreshed = (await h.party("GET", clientPath)).body.view.negotiation.messages.find((m) => m.eventId === messageEventId);
      assert.equal(refreshed.myResponse.responseId, "accept");
    }
    assert.equal(activityOf(h.op()).filter((e) => e.eventType === "CLIENT_MESSAGE_RESPONSE").length, 1);
    assert.equal(h.fcmCalls.length, fcmBefore + 1);

    // Invalid replies are rejected.
    assert.equal((await h.party("POST", `${clientPath}/event`, { replyToEventId: messageEventId, responseId: "have_other_offer" })).status, 400, "price reply on a viewing message");
    assert.equal((await h.party("POST", `${clientPath}/event`, { replyToEventId: "ev_missing", responseId: "accept" })).status, 400);
  });
});

test("replies stay attached to their own message; both-party messages show each side's reply", async () => {
  await withMatch(async (h) => {
    const tokens = await mintLinks(h, h.match);
    const clientPath = `/party/sessions/${encodeURIComponent(tokens.client)}`;
    const ownerPath = `/party/sessions/${encodeURIComponent(tokens.owner)}`;
    const price = (await h.record({ kind: "broker_message", party: "both", message: "السعر النهائي 860 ألف", messageKind: "price", requiresReply: true })).body.entry.eventId;
    const general = (await h.record({ kind: "broker_message", party: "client", message: "هل الموعد مناسب؟", messageKind: "general", requiresReply: true })).body.entry.eventId;
    const info = (await h.record({ kind: "broker_message", party: "client", message: "للعلم فقط", messageKind: "general", requiresReply: false })).body.entry.eventId;
    await h.party("POST", `${clientPath}/event`, { replyToEventId: price, responseId: "need_time", clientEventId: "p1" });
    await h.party("POST", `${ownerPath}/event`, { replyToEventId: price, responseId: "accept", clientEventId: "p2" });
    await h.party("POST", `${clientPath}/event`, { replyToEventId: general, responseId: "need_clarification", responseText: "أي موعد؟", clientEventId: "g1" });
    assert.equal((await h.party("POST", `${clientPath}/event`, { replyToEventId: info, responseId: "accept" })).status, 400, "no reply to a message that does not require one");
    const responses = activityOf(h.op()).filter((e) => /_MESSAGE_RESPONSE$/.test(e.eventType));
    assert.deepEqual(responses.map((e) => `${e.actorType}:${e.payload.replyToEventId === price ? "price" : "general"}:${e.payload.responseId}`),
      ["client:price:need_time", "owner:price:accept", "client:general:need_clarification"]);
    const clientThreads = (await h.party("GET", clientPath)).body.view.negotiation.messages;
    const clientPrice = clientThreads.find((m) => m.eventId === price);
    assert.equal(clientPrice.myResponse.responseId, "need_time");
    assert.deepEqual(clientPrice.otherResponses.map((r) => `${r.party}:${r.responseId}`), ["owner:accept"]);
    assert.equal(clientThreads.find((m) => m.eventId === general).myResponse.responseText, "أي موعد؟");
    assert.equal(clientThreads.find((m) => m.eventId === info).canReply, false);
    const ownerThreads = (await h.party("GET", ownerPath)).body.view.negotiation.messages;
    assert.deepEqual(ownerThreads.map((m) => m.eventId), [price], "owner sees only the both-party message");

    // Broker workspace renders each reply under its own message.
    const opportunities = h.list(`offices/${OFFICE}/opportunities`).map((o) => ({ ...o, recordId: o.id, opportunityId: o.id, recordType: "opportunity" }));
    const [task] = mapOperationsItemsToDailyTasks([projectOperationToUiItem(h.op()), ...opportunities], new Date(), { officeId: OFFICE });
    const html = buildDailyTaskCardHtml(task, { open: true });
    const priceBlock = html.slice(html.indexOf(`data-message-thread="${price}"`), html.indexOf("</li>", html.indexOf(`data-message-response="owner"`, html.indexOf(`data-message-thread="${price}"`))));
    assert.match(priceBlock, /ردّ العميل: أحتاج وقت/);
    assert.match(priceBlock, /ردّ المالك: موافق/);
    assert.match(html, /data-broker-message-kind/);
    assert.doesNotMatch(html, /data-negotiation-log-kind="CLIENT_MESSAGE_RESPONSE"/, "replies are nested, not separate rows");
  });
});
