import test from "node:test";
import assert from "node:assert/strict";
import { findAndSaveMatchesForOpportunity } from "../worker/src/index.js";
import { ACTIVE_OPERATION_STATUSES, projectOperationToUiItem } from "../public/js/operations-domain.js";
import { mapOperationsItemsToDailyTasks } from "../public/js/v2/daily-tasks/domain.js";

// End-to-end regression for: Match saved, but its MATCH_REVIEW never reaches the
// responsible broker's Daily Tasks. Runs the real Worker persistence path against
// an in-memory Firestore REST double, then reads it back through the same
// active-status filter, projection and mapper used by Daily Tasks.

const PROJECT = "demo-iaqar";
const OFFICE = "office-match-review";
const REQUEST_ID = "opp_request_review";
const OFFER_ID = "opp_offer_review";
const REQUEST_BROKER = "broker-request-uid";
const OFFER_BROKER = "broker-offer-uid";

function toFields(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "boolean") out[key] = { booleanValue: value };
    else if (typeof value === "number") out[key] = { integerValue: String(value) };
    else out[key] = { stringValue: String(value) };
  }
  return out;
}

function fromFields(fields = {}) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if ("stringValue" in value) out[key] = value.stringValue;
    else if ("integerValue" in value) out[key] = Number(value.integerValue);
    else if ("booleanValue" in value) out[key] = value.booleanValue;
    else if ("timestampValue" in value) out[key] = value.timestampValue;
    else if ("nullValue" in value) out[key] = null;
  }
  return out;
}

function installMemoryFirestore() {
  const docs = new Map();
  let clock = 0;
  const base = `/v1/projects/${PROJECT}/databases/(default)/documents/`;
  const originalFetch = globalThis.fetch;
  const stamp = () => `2026-09-27T10:00:00.${String(++clock).padStart(6, "0")}Z`;
  const docJson = (path) => ({
    name: `projects/${PROJECT}/databases/(default)/documents/${path}`,
    fields: docs.get(path).fields,
    updateTime: docs.get(path).updateTime
  });
  const write = (path, fields, mask) => {
    const merged = mask && mask.length ? { ...(docs.get(path)?.fields || {}) } : {};
    for (const key of mask && mask.length ? mask : Object.keys(fields)) {
      if (key in fields) merged[key] = fields[key];
      else delete merged[key];
    }
    docs.set(path, { fields: merged, updateTime: stamp() });
  };
  const preconditionHolds = (path, current) => {
    if (!current) return true;
    if (typeof current.exists === "boolean") return current.exists === docs.has(path);
    if (current.updateTime) return docs.get(path)?.updateTime === current.updateTime;
    return true;
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || "GET").toUpperCase();
    if (url.hostname !== "firestore.googleapis.com") return Response.json({ ok: true });
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith(":commit")) {
      const { writes = [] } = JSON.parse(init.body || "{}");
      const pathOf = (w) => w.update.name.split("/documents/")[1];
      if (!writes.every((w) => preconditionHolds(pathOf(w), w.currentDocument))) {
        return Response.json({ error: { status: "FAILED_PRECONDITION" } }, { status: 400 });
      }
      writes.forEach((w) => write(pathOf(w), w.update.fields, w.updateMask?.fieldPaths));
      return Response.json({ writeResults: [] });
    }
    if (pathname.includes(":")) return Response.json([]);
    const path = pathname.slice(base.length);
    const isCollection = path.split("/").length % 2 === 1;
    if (method === "GET" && isCollection) {
      const prefix = `${path}/`;
      const documents = [...docs.keys()]
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
        .map(docJson);
      return Response.json({ documents });
    }
    if (method === "GET") return docs.has(path) ? Response.json(docJson(path)) : new Response("{}", { status: 404 });
    if (method === "PATCH") {
      const current = url.searchParams.has("currentDocument.exists")
        ? { exists: url.searchParams.get("currentDocument.exists") === "true" }
        : null;
      if (!preconditionHolds(path, current)) return new Response("{}", { status: 404 });
      write(path, JSON.parse(init.body || "{}").fields || {}, url.searchParams.getAll("updateMask.fieldPaths"));
      return Response.json(docJson(path));
    }
    return new Response("unsupported", { status: 500 });
  };

  return {
    seed(path, obj) { write(path, toFields(obj), null); },
    patch(path, obj) { write(path, toFields(obj), Object.keys(obj)); },
    list(collection) {
      const prefix = `${collection}/`;
      return [...docs.keys()]
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
        .map((p) => ({ id: p.slice(prefix.length), ...fromFields(docs.get(p).fields) }));
    },
    restore() { globalThis.fetch = originalFetch; }
  };
}

const listing = { officeId: OFFICE, city: "المدينة المنورة", district: "العزيزية", propertyType: "شقة", lifecycleStatus: "ACTIVE", version: 1 };

// Deliberately no `area` on either side: area is optional for completeness and matching.
function requestRecord() {
  return { ...listing, opportunityKind: "REQUEST", purpose: "PURCHASE", advertiserRole: "CLIENT",
    budget: 800000, priceOrBudget: 800000, contactPhone: "0550000001",
    brokerId: REQUEST_BROKER, originatingBrokerId: REQUEST_BROKER };
}

function offerRecord(price = 790000) {
  return { ...listing, opportunityKind: "OFFER", purpose: "SALE", advertiserRole: "OWNER",
    salePrice: price, priceOrBudget: price, contactPhone: "0550000002",
    brokerId: OFFER_BROKER, originatingBrokerId: OFFER_BROKER };
}

function setup() {
  const store = installMemoryFirestore();
  store.seed(`offices/${OFFICE}`, { officeName: "مكتب اختبار", ownerUid: "owner-uid" });
  store.seed(`offices/${OFFICE}/opportunities/${REQUEST_ID}`, requestRecord());
  store.seed(`offices/${OFFICE}/opportunities/${OFFER_ID}`, offerRecord());
  return store;
}

const runMatching = (opportunityId = REQUEST_ID) => findAndSaveMatchesForOpportunity({
  projectId: PROJECT, officeId: OFFICE, opportunityId, accessToken: "test-token", notify: false, env: {}
});

const matchReviews = (store) => store.list(`offices/${OFFICE}/operations`).filter((op) => op.type === "MATCH_REVIEW");

// Same read path as Daily Tasks: active-status query → projection → daily-task mapper.
function dailyTasksFor(store) {
  const active = store.list(`offices/${OFFICE}/operations`)
    .filter((op) => ACTIVE_OPERATION_STATUSES.includes(String(op.status || "").toUpperCase()));
  return mapOperationsItemsToDailyTasks(active.map((op) => projectOperationToUiItem(op)), new Date(), { officeId: OFFICE });
}

test("a successful Match creates a linked MATCH_REVIEW under offices/{officeId}/operations", async () => {
  const store = setup();
  try {
    const result = await runMatching();
    assert.equal(result.matches.length, 1);
    const match = result.matches[0];
    assert.ok(match.matchId);
    assert.equal(match.operationCreated, true);

    const reviews = matchReviews(store);
    assert.equal(reviews.length, 1);
    const [op] = reviews;
    assert.equal(op.id, match.operationId);
    assert.equal(op.officeId, OFFICE);
    assert.equal(op.matchId, match.matchId);
    assert.equal(op.sourceEntityType, "match");
    assert.equal(op.sourceEntityId, match.matchId);
    assert.equal(op.opportunityId, REQUEST_ID);
    assert.equal(op.status, "OPEN");
    assert.ok(op.createdAt && op.updatedAt, "timestamps follow the operation schema");
    const metadata = JSON.parse(op.metadataJson);
    assert.equal(metadata.clientRequestId, REQUEST_ID);
    assert.equal(metadata.ownerOfferId, OFFER_ID);
    assert.equal(metadata.counterpartOpportunityId, OFFER_ID);

    const [persistedMatch] = store.list(`offices/${OFFICE}/matches`);
    assert.equal(persistedMatch.id, match.matchId);
    assert.equal(persistedMatch.requestId, REQUEST_ID);
    assert.equal(persistedMatch.offerId, OFFER_ID);
  } finally {
    store.restore();
  }
});

test("MATCH_REVIEW carries the broker of the opportunity that ran matching", async () => {
  const store = setup();
  try {
    await runMatching(REQUEST_ID);
    const [op] = matchReviews(store);
    assert.equal(op.assignedBrokerId, REQUEST_BROKER);
  } finally {
    store.restore();
  }
});

test("re-running matching for the same Match never duplicates its MATCH_REVIEW", async () => {
  const store = setup();
  try {
    const first = await runMatching(REQUEST_ID);
    const second = await runMatching(REQUEST_ID);
    const third = await runMatching(OFFER_ID);
    assert.equal(second.matches[0].duplicate, true);
    assert.equal(second.matches[0].matchId, first.matches[0].matchId);
    assert.equal(third.matches[0].matchId, first.matches[0].matchId);
    const reviews = matchReviews(store);
    assert.equal(reviews.length, 1, "exactly one MATCH_REVIEW per matchId");
    assert.equal(reviews[0].id, first.matches[0].operationId);
    assert.equal(reviews[0].status, "OPEN");
  } finally {
    store.restore();
  }
});

test("the MATCH_REVIEW reaches Daily Tasks through the existing Operations source", async () => {
  const store = setup();
  try {
    const { matches: [match] } = await runMatching();
    const tasks = dailyTasksFor(store);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].matchId, match.matchId);
    assert.equal(tasks[0].taskKind, "match_group");
  } finally {
    store.restore();
  }
});

test("missing area does not block matching, the review, or its Daily Task", async () => {
  const store = setup();
  try {
    const opportunities = store.list(`offices/${OFFICE}/opportunities`);
    assert.ok(opportunities.every((record) => !("area" in record)), "fixture has no area on either side");
    const result = await runMatching();
    assert.equal(result.matches.length, 1);
    assert.equal(matchReviews(store).length, 1);
    assert.equal(dailyTasksFor(store).length, 1);
    const missingData = store.list(`offices/${OFFICE}/operations`)
      .filter((op) => op.type === "MISSING_DATA" && op.status === "OPEN");
    assert.equal(missingData.length, 0, "area alone must not raise a completion task");
  } finally {
    store.restore();
  }
});

test("a Match that becomes current again reopens its system-expired MATCH_REVIEW (root cause)", async () => {
  const store = setup();
  try {
    const { matches: [original] } = await runMatching();

    // Offer edited → new Match supersedes the original, whose review is expired.
    store.seed(`offices/${OFFICE}/opportunities/${OFFER_ID}`, offerRecord(760000));
    const { matches: [edited] } = await runMatching();
    assert.notEqual(edited.matchId, original.matchId);
    assert.equal(matchReviews(store).find((op) => op.matchId === original.matchId).status, "EXPIRED");

    // Offer reverted → the original Match (same deterministic id) is current again.
    store.seed(`offices/${OFFICE}/opportunities/${OFFER_ID}`, offerRecord(790000));
    const { matches: [revived] } = await runMatching();
    assert.equal(revived.matchId, original.matchId);
    const currentMatch = store.list(`offices/${OFFICE}/matches`).find((m) => m.id === original.matchId);
    assert.equal(currentMatch.status, "active");
    assert.equal(currentMatch.isCurrent, true);

    const reviews = matchReviews(store).filter((op) => op.matchId === original.matchId);
    assert.equal(reviews.length, 1, "reopened in place, not duplicated");
    assert.equal(reviews[0].id, original.operationId);
    assert.equal(reviews[0].status, "OPEN");
    assert.equal(reviews[0].assignedBrokerId, REQUEST_BROKER);

    const tasks = dailyTasksFor(store);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].matchId, original.matchId);
  } finally {
    store.restore();
  }
});

test("a broker-dismissed MATCH_REVIEW stays dismissed when matching re-runs", async () => {
  const store = setup();
  try {
    const { matches: [match] } = await runMatching();
    store.patch(`offices/${OFFICE}/operations/${match.operationId}`, { status: "DISMISSED" });
    await runMatching();
    const reviews = matchReviews(store);
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].status, "DISMISSED");
    assert.equal(dailyTasksFor(store).length, 0);
  } finally {
    store.restore();
  }
});
