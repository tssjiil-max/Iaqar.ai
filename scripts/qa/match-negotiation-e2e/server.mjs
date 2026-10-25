// Local QA harness: the actual Worker (worker/src/index.js) behind an in-memory
// Firestore REST double, serving the actual Bank + bridge + Match workspace UI.
// Every outbound Google/Firestore call is answered in memory; nothing leaves the machine.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const PROJECT = "demo-iaqar";
export const OFFICE = "office-e2e";
export const UID = "broker-e2e";
export const REQUEST_ID = "opp_request_e2e";
export const OFFER_ID = "opp_offer_e2e";

function toValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
  if (typeof value === "object") return { mapValue: { fields: toFields(value) } };
  return { stringValue: String(value) };
}
export function toFields(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) out[key] = toValue(value);
  return out;
}
export function fromValue(v = {}) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
  if ("mapValue" in v) return fromFields(v.mapValue.fields || {});
  return null;
}
export function fromFields(fields = {}) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) out[key] = fromValue(value);
  return out;
}

export function installMemoryFirestore({ jwk }) {
  const docs = new Map();
  let clock = 0;
  const base = `/v1/projects/${PROJECT}/databases/(default)/documents/`;
  const stamp = () => new Date(Date.UTC(2026, 8, 29, 9, 0, 0) + (++clock) * 1000).toISOString();
  const docJson = (p) => ({ name: `projects/${PROJECT}/databases/(default)/documents/${p}`, fields: docs.get(p).fields, updateTime: docs.get(p).updateTime });
  const write = (p, fields, mask) => {
    const merged = mask && mask.length ? { ...(docs.get(p)?.fields || {}) } : {};
    for (const key of mask && mask.length ? mask : Object.keys(fields)) {
      if (key in fields) merged[key] = fields[key]; else delete merged[key];
    }
    docs.set(p, { fields: merged, updateTime: stamp() });
  };
  const listPaths = (collection) => {
    const prefix = `${collection}/`;
    return [...docs.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/")).sort();
  };
  const log = [];
  const fcm = [];
  // Billed reads, as Firestore counts them: one per document returned (a get or an empty answer counts one), and one
  // per 1000 index entries for a count. `faults.queries` makes structured queries and counts answer 503.
  const reads = { documents: 0, requests: 0, byKind: {} };
  const billed = (kind, n) => { reads.documents += n; reads.requests += 1; reads.byKind[kind] = (reads.byKind[kind] || 0) + n; };
  const faults = { queries: false };
  const valueOf = (v = {}) => ("stringValue" in v ? v.stringValue : "integerValue" in v ? Number(v.integerValue) : "booleanValue" in v ? v.booleanValue : "nullValue" in v ? null : undefined);
  const matches = (p, filter) => {
    if (!filter) return true;
    const field = filter.field?.fieldPath || "";
    const value = valueOf(docs.get(p).fields[field]);
    if (filter.op === "EQUAL") return value === valueOf(filter.value);
    if (filter.op === "IN") return (filter.value?.arrayValue?.values || []).some((v) => valueOf(v) === value);
    return false;
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || "GET").toUpperCase();
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    if (url.hostname === "fcm.googleapis.com") { fcm.push({ at: Date.now(), body: JSON.parse(init.body || "{}") }); return Response.json({ name: `projects/x/messages/${fcm.length}` }); }
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "e2e-access", expires_in: 3600 });
    if (url.hostname === "www.googleapis.com" && url.pathname.includes("jwk")) return Response.json({ keys: [jwk] });
    if (url.hostname !== "firestore.googleapis.com") return Response.json({ ok: true });
    reads.calls = (reads.calls || 0) + 1;
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith(":commit")) {
      const { writes = [] } = JSON.parse(init.body || "{}");
      // Like Firestore: an update may carry updateTransforms, and a write may be a bare transform; integer
      // increments are applied atomically (one commit at a time here) and reported in transformResults.
      const writeResults = [];
      for (const w of writes) {
        const path = (w.update?.name || w.transform?.document || "").split("/documents/")[1];
        if (w.update) write(path, w.update.fields || {}, w.updateMask?.fieldPaths);
        const transforms = w.update ? (w.updateTransforms || []) : (w.transform?.fieldTransforms || []);
        const transformResults = [];
        for (const t of transforms) {
          if (!t.increment || !path) continue;
          const fields = { ...(docs.get(path)?.fields || {}) };
          const next = Number(fields[t.fieldPath]?.integerValue || 0) + Number(t.increment.integerValue || 0);
          fields[t.fieldPath] = { integerValue: String(next) };
          docs.set(path, { fields, updateTime: stamp() });
          transformResults.push({ integerValue: String(next) });
        }
        writeResults.push({ updateTime: stamp(), transformResults });
      }
      return Response.json({ writeResults });
    }
    // A count over one collection, optionally with one EQUAL filter (…/documents/<parent>:runAggregationQuery).
    if (pathname.endsWith(":runAggregationQuery")) {
      if (faults.queries) return Response.json({ error: { code: 503, status: "UNAVAILABLE" } }, { status: 503 });
      const parent = pathname.slice(base.length, -":runAggregationQuery".length);
      const agg = JSON.parse(init.body || "{}").structuredAggregationQuery || {};
      const q = agg.structuredQuery || {};
      const n = listPaths(`${parent}/${q.from?.[0]?.collectionId || ""}`).filter((p) => matches(p, q.where?.fieldFilter)).length;
      billed(`count:${q.from?.[0]?.collectionId || ""}`, Math.max(1, Math.ceil(n / 1000)));
      const alias = agg.aggregations?.[0]?.alias || "count";
      return Response.json([{ result: { aggregateFields: { [alias]: { integerValue: String(n) } } }, readTime: new Date().toISOString() }]);
    }
    // An equality / IN query ordered by document name, with a cursor and a limit (the matching index's query).
    const ordered = JSON.parse(init.body || "{}").structuredQuery || {};
    if (pathname.endsWith(":runQuery") && (["IN", "EQUAL"].includes(ordered.where?.fieldFilter?.op) || (!ordered.where && ordered.orderBy?.[0]?.field?.fieldPath === "__name__"))) {
      if (faults.queries) return Response.json({ error: { code: 503, status: "UNAVAILABLE" } }, { status: 503 });
      const parent = pathname.slice(base.length, -":runQuery".length);
      const q = JSON.parse(init.body || "{}").structuredQuery || {};
      const after = String(q.startAt?.values?.[0]?.referenceValue || "").split("/documents/")[1] || "";
      const rows = listPaths(`${parent}/${q.from?.[0]?.collectionId || ""}`).filter((p) => matches(p, q.where?.fieldFilter) && (!after || p > after)).slice(0, Number(q.limit || 1000));
      billed(`query:${q.from?.[0]?.collectionId || ""}`, Math.max(1, rows.length));
      return Response.json(rows.length ? rows.map((p) => ({ document: docJson(p) })) : [{ readTime: new Date().toISOString() }]);
    }
    // A query scoped to a parent document (…/documents/<parent>:runQuery): one collection, one range filter on a
    // timestamp field, ordered by it. Root queries (…/documents:runQuery) keep answering with nothing, as before.
    if (pathname.endsWith(":runQuery") && pathname.length > base.length + ":runQuery".length) {
      const parent = pathname.slice(base.length, -":runQuery".length);
      const q = JSON.parse(init.body || "{}").structuredQuery || {};
      const filter = q.where?.fieldFilter;
      const field = filter?.field?.fieldPath || "";
      const bound = Date.parse(filter?.value?.timestampValue || "") || 0;
      const at = (p) => { const v = docs.get(p).fields[field]; return Date.parse(v?.timestampValue || v?.stringValue || "") || 0; };
      const older = filter?.op === "LESS_THAN";
      const rows = listPaths(`${parent}/${q.from?.[0]?.collectionId || ""}`).filter((p) => (older ? at(p) > 0 && at(p) < bound : at(p) > bound)).sort((a, b) => at(a) - at(b)).slice(0, Number(q.limit || 50));
      return Response.json(rows.length ? rows.map((p) => ({ document: docJson(p) })) : [{ readTime: new Date().toISOString() }]);
    }
    if (pathname.includes(":")) return Response.json([]);
    const p = pathname.slice(base.length);
    const isCollection = p.split("/").length % 2 === 1;
    if (method === "GET" && isCollection) {
      // Real Firestore list paging: `pageSize` documents by id per answer, and a `nextPageToken` while more remain.
      const pageSize = Number(url.searchParams.get("pageSize") || 20);
      const after = url.searchParams.get("pageToken") ? Buffer.from(url.searchParams.get("pageToken"), "base64url").toString() : "";
      const rest = listPaths(p).filter((path) => !after || path > after);
      const page = rest.slice(0, pageSize);
      billed(`list:${p.split("/").pop()}`, Math.max(1, page.length));
      return Response.json({ documents: page.map(docJson), ...(rest.length > pageSize ? { nextPageToken: Buffer.from(page.at(-1)).toString("base64url") } : {}) });
    }
    if (method === "GET") { billed("get", 1); return docs.has(p) ? Response.json(docJson(p)) : new Response("{}", { status: 404 }); }
    if (method === "PATCH") {
      if (url.searchParams.get("currentDocument.exists") === "false" && docs.has(p)) return Response.json({ error: { status: "ALREADY_EXISTS" } }, { status: 409 });
      const expected = url.searchParams.get("currentDocument.updateTime");
      if (expected && docs.get(p)?.updateTime !== expected) return Response.json({ error: { status: "FAILED_PRECONDITION" } }, { status: 400 });
      log.push({ path: p, fields: Object.keys(JSON.parse(init.body || "{}").fields || {}) });
      write(p, JSON.parse(init.body || "{}").fields || {}, url.searchParams.getAll("updateMask.fieldPaths"));
      return Response.json(docJson(p));
    }
    if (method === "DELETE") { docs.delete(p); return Response.json({}); }
    return new Response("unsupported", { status: 500 });
  };
  return {
    docs, log, fcm, reads, faults,
    seed(p, obj) { write(p, toFields(obj), null); },
    patch(p, obj) { write(p, toFields(obj), Object.keys(obj)); },
    get(p) { return docs.has(p) ? { id: p.split("/").pop(), ...fromFields(docs.get(p).fields) } : null; },
    list(collection) { return listPaths(collection).map((p) => ({ id: p.split("/").pop(), ...fromFields(docs.get(p).fields) })); },
    remove(p) { docs.delete(p); }
  };
}

function b64url(buf) { return Buffer.from(buf).toString("base64url"); }

// One signing key per process: the Worker module caches the JWKS it fetched.
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "e2e-kid", alg: "RS256", use: "sig" };

export async function startHarness({ root, port = 0, extraOperations = 150 }) {
  const store = installMemoryFirestore({ jwk });
  const sa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const env = {
    FIREBASE_PROJECT_ID: PROJECT,
    FIREBASE_CLIENT_EMAIL: "e2e@demo-iaqar.iam.gserviceaccount.com",
    FIREBASE_PRIVATE_KEY: sa.privateKey,
    FIREBASE_PRIVATE_KEY_ID: "0123456789abcdef0123456789abcdef01234567",
    DEPLOYMENT_ENV: "staging"
  };
  const idToken = () => {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: "RS256", kid: "e2e-kid", typ: "JWT" }));
    const claims = b64url(JSON.stringify({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: UID, iat: now, exp: now + 3600 }));
    const sig = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), privateKey);
    return `${header}.${claims}.${b64url(sig)}`;
  };

  // Seed: one office, its broker, a request and an offer with contacts, and
  // unrelated operations so the office has more than one page of operations.
  store.seed(`offices/${OFFICE}`, { officeName: "مكتب اختبار المسار", ownerUid: UID, active: true, platformOpportunityOnboardingAckAt: "2026-09-01T00:00:00Z" });
  store.seed(`offices/${OFFICE}/members/${UID}`, { uid: UID, role: "owner", active: true });
  store.seed(`offices/${OFFICE}/devices/broker-phone`, { fcmRegistrationId: "fid-broker-e2e", registrationType: "fid", userUid: UID, enabled: true });
  const listing = { officeId: OFFICE, city: "الرياض", district: "النرجس", propertyType: "شقة", lifecycleStatus: "ACTIVE", version: 1 };
  store.seed(`offices/${OFFICE}/opportunities/${REQUEST_ID}`, { ...listing, opportunityKind: "REQUEST", purpose: "PURCHASE", advertiserRole: "CLIENT",
    budget: 900000, priceOrBudget: 900000, contactPhone: "0551110001", contactName: "عميل الاختبار", referenceCode: "REQ-E2E-1",
    brokerId: UID, createdAt: "2026-09-28T08:00:00.000Z", updatedAt: "2026-09-28T08:00:00.000Z" });
  store.seed(`offices/${OFFICE}/opportunities/${OFFER_ID}`, { ...listing, opportunityKind: "OFFER", purpose: "SALE", advertiserRole: "OWNER",
    salePrice: 880000, priceOrBudget: 880000, contactPhone: "0552220002", contactName: "مالك الاختبار", referenceCode: "OFF-E2E-1",
    brokerId: UID, createdAt: "2026-09-28T07:00:00.000Z", updatedAt: "2026-09-28T07:00:00.000Z" });
  for (let i = 0; i < extraOperations; i += 1) {
    // Sorted ahead of any real op_<sha256> id, so the real operation is on page 2+.
    const id = `op_00000${String(i).padStart(5, "0")}`;
    store.seed(`offices/${OFFICE}/operations/${id}`, { officeId: OFFICE, type: "OPPORTUNITY_REVIEW", status: "COMPLETED", opportunityId: `filler_${i}` });
  }

  const workerModule = await import(path.join(root, "worker/src/index.js"));
  const worker = workerModule.default;
  await workerModule.findAndSaveMatchesForOpportunity({ projectId: PROJECT, officeId: OFFICE, opportunityId: REQUEST_ID, accessToken: "e2e-access", notify: false, env });
  const match = store.list(`offices/${OFFICE}/matches`).find((m) => m.isCurrent !== false);
  const matchOperation = store.list(`offices/${OFFICE}/operations`).find((op) => String(op.type).toUpperCase() === "MATCH_REVIEW");

  const page = fs.readFileSync(new URL("./page.html", import.meta.url), "utf8");
  const partyPage = fs.readFileSync(new URL("./party.html", import.meta.url), "utf8");
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://local");
      if (url.pathname === "/" && url.searchParams.has("cv2Party")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(partyPage);
      }
      if (url.pathname === "/" || url.pathname === "/harness") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(page);
      }
      if (url.pathname === "/token") { res.writeHead(200, { "content-type": "text/plain" }); return res.end(idToken()); }
      if (url.pathname === "/store/list") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(store.list(url.searchParams.get("path"))));
      }
      if (url.pathname === "/store/get") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(store.get(url.searchParams.get("path"))));
      }
      if (url.pathname.startsWith("/worker/")) {
        const chunks = []; for await (const c of req) chunks.push(c);
        const request = new Request(`https://worker.test${url.pathname.slice("/worker".length)}${url.search}`, {
          method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks)
        });
        const response = await worker.fetch(request, env, { waitUntil() {} });
        const body = Buffer.from(await response.arrayBuffer());
        res.writeHead(response.status, { "content-type": response.headers.get("content-type") || "application/json" });
        server.workerCalls.push({ path: url.pathname, status: response.status, body: body.toString("utf8").slice(0, 400) });
        return res.end(body);
      }
      const file = path.join(root, decodeURIComponent(url.pathname));
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      const type = file.endsWith(".js") || file.endsWith(".mjs") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "application/octet-stream";
      res.writeHead(200, { "content-type": `${type}; charset=utf-8` });
      res.end(fs.readFileSync(file));
    } catch (error) {
      res.writeHead(500); res.end(String(error?.stack || error));
    }
  });
  server.workerCalls = [];
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { server, store, env, match, matchOperation, port: server.address().port };
}
