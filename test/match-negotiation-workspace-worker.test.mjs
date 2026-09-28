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
  // More than one page of operations, sorted ahead of the real MATCH_REVIEW id.
  for (let i = 0; i < 150; i += 1) seed(`offices/${OFFICE}/operations/op_00000${String(i).padStart(5, "0")}`, { officeId: OFFICE, type: "OPPORTUNITY_REVIEW", status: "COMPLETED", opportunityId: `filler_${i}` });

  const call = async (pathname, body) => {
    const response = await worker.fetch(new Request(`https://worker.test${pathname}`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token()}` }, body: JSON.stringify(body)
    }), env, { waitUntil() {} });
    return { status: response.status, body: await response.json() };
  };
  return { env, get, list, call, restore() { globalThis.fetch = originalFetch; } };
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

test("party session handoff stamps the MATCH_REVIEW operation even beyond the first page", async () => {
  await withMatch(async ({ call, match, op, matchDoc }) => {
    const minted = await call("/party/sessions", { officeId: OFFICE, matchId: match.id, party: "client", offerId: OFFER_ID, requestId: REQUEST_ID });
    assert.equal(minted.status, 200, JSON.stringify(minted.body));
    assert.equal(matchDoc().livingStage, "WAITING_CLIENT");
    assert.equal(op().livingStage, "WAITING_CLIENT", "operation must follow the match, not stay on تطابق جديد");
  });
});

test("repeated client and owner sends are recorded on the exact match and its operation", async () => {
  await withMatch(async ({ record, op, matchDoc, match }) => {
    for (const party of ["client", "client", "owner", "owner"]) {
      const result = await record({ kind: "party_send", party });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.matchId, match.id);
    }
    const summary = (await record({ kind: "party_send", party: "client" })).body.summary;
    assert.equal(summary.clientSendCount, 3);
    assert.equal(summary.ownerSendCount, 2);
    assert.equal(activityOf(op()).length, 5);
    assert.equal(activityOf(matchDoc()).length, 5);
  });
});

test("party options persist, can change, and survive a reload of the operation", async () => {
  await withMatch(async ({ record, op }) => {
    await record({ kind: "party_choice", party: "client", choiceId: "interested" });
    await record({ kind: "party_choice", party: "client", choiceId: "not_interested" });
    const owner = await record({ kind: "party_choice", party: "owner", choiceId: "equipment" });
    assert.equal(owner.body.summary.clientChoice.id, "not_interested");
    assert.equal(owner.body.summary.ownerChoice.label, "التجهيزات");
    const invalid = await record({ kind: "party_choice", party: "owner", choiceId: "drop_table" });
    assert.equal(invalid.status, 400);
    const choices = activityOf(op()).filter((entry) => entry.kind === "party_choice");
    assert.deepEqual(choices.map((entry) => entry.choiceId), ["interested", "not_interested", "equipment"]);
  });
});

test("broker messages reach the chosen party link; the internal note never does", async () => {
  await withMatch(async ({ record, get, match, op }) => {
    for (const [party, message] of [["client", "أولى"], ["client", "ثانية"], ["owner", "للمالك"], ["both", "للطرفين"]]) {
      const result = await record({ kind: "broker_message", party, message });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.entry.party, party);
    }
    const note = await record({ kind: "internal_note", party: "client", message: "ملاحظة سرية" });
    assert.equal(note.body.entry.party, "internal");
    const session = JSON.parse(get(`offices/${OFFICE}/coordinationSessions/${match.id}`).coordinationJson);
    assert.deepEqual(session.brokerNotes.map((n) => `${n.audience}:${n.message}`), ["client:أولى", "client:ثانية", "owner:للمالك", "both:للطرفين"]);
    assert.equal(JSON.stringify(session).includes("ملاحظة سرية"), false);
    const log = activityOf(op());
    assert.equal(log.filter((e) => e.kind === "broker_message").length, 4);
    assert.equal(log.filter((e) => e.kind === "internal_note").length, 1);
    assert.equal((await record({ kind: "broker_message", party: "client", message: "  " })).status, 400);
  });
});

test("an operation id is never accepted as the matchId", async () => {
  await withMatch(async ({ call, operation }) => {
    const result = await call("/workflow/action", { officeId: OFFICE, recordId: operation.id, action: "record_negotiation_activity", kind: "party_send", party: "client" });
    assert.equal(result.status, 404);
  });
});

test("a worked match projects to متابعة, never back to تطابق جديد, and renders stable workspace data", async () => {
  await withMatch(async ({ record, op, match, list }) => {
    const untouched = projectOpportunityAction(projectOperationToUiItem(op()));
    assert.equal(untouched.badge, "تطابق جديد");
    await record({ kind: "party_send", party: "client" });
    await record({ kind: "party_send", party: "owner" });
    await record({ kind: "party_choice", party: "client", choiceId: "interested" });
    await record({ kind: "broker_message", party: "both", message: "موعد المعاينة الخميس" });
    await record({ kind: "internal_note", message: "العميل مستعجل" });
    const item = projectOperationToUiItem(op());
    const action = projectOpportunityAction(item);
    assert.notEqual(action.badge, "تطابق جديد");
    assert.equal(action.category, "follow_up");
    const index = buildOpportunityActionIndex([item], { officeId: OFFICE });
    const onRequest = index.get(REQUEST_ID);
    assert.ok(onRequest.filterMemberships.includes("follow_up"));
    assert.ok(onRequest.filterMemberships.includes("matches"));
    assert.equal(onRequest.matchId, match.id);

    const opportunities = list(`offices/${OFFICE}/opportunities`).map((o) => ({ ...o, recordId: o.id, opportunityId: o.id, recordType: "opportunity" }));
    const [task] = mapOperationsItemsToDailyTasks([item, ...opportunities], new Date(), { officeId: OFFICE });
    assert.equal(task.matchId, match.id);
    const html = buildDailyTaskCardHtml(task, { open: true });
    assert.match(html, /data-party-send="client"[^>]*>إعادة الإرسال للعميل</);
    assert.match(html, /data-party-send="owner"[^>]*>إعادة الإرسال للمالك</);
    assert.doesNotMatch(html, /data-party-send="(client|owner)"[^>]*disabled/);
    assert.match(html, /data-party-choice="interested" data-party="client" aria-pressed="true"/);
    assert.match(html, /رسالة الوسيط إلى الطرفان/);
    assert.match(html, /ملاحظة داخلية/);
    assert.match(html, /data-log-recipient>المستلم: داخلي/);
    assert.match(html, new RegExp(`data-match-id="${match.id}"`));
    assert.doesNotMatch(html, /undefined|غير محدد/);
  });
});

test("an engaged match outranks an untouched sibling candidate on the same card", () => {
  const base = { officeId: OFFICE, status: "OPEN", operationType: "MATCH_REVIEW", opportunityId: REQUEST_ID, clientRequestId: REQUEST_ID };
  const untouched = { ...base, id: "op_b", matchId: "mat_b", createdAt: "2026-09-29T10:00:00Z", updatedAt: "2026-09-29T10:00:00Z" };
  const engaged = { ...base, id: "op_a", matchId: "mat_a", createdAt: "2026-09-28T10:00:00Z", updatedAt: "2026-09-28T10:00:00Z",
    negotiationActivityJson: JSON.stringify([{ id: "na_1", kind: "party_send", party: "client", label: "إرسال واتساب للعميل", status: "whatsapp_opened", createdAt: "2026-09-29T09:00:00Z" }]) };
  for (const order of [[untouched, engaged], [engaged, untouched]]) {
    const action = buildOpportunityActionIndex(order, { officeId: OFFICE }).get(REQUEST_ID);
    assert.equal(action.matchId, "mat_a");
    assert.notEqual(action.badge, "تطابق جديد");
  }
});
