import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptPlatformOffer,
  afterPublicIntakePersisted,
  declinePlatformOffer,
  expireDuePlatformOffers,
  routePlatformOpportunity,
  submitOfficeRating
} from "../src/opportunity-router-service.js";
import { ATTEMPT_DECISION, ORIGIN_SOURCE_TYPE, ROUTING_STATUS } from "../../public/js/opportunity-router-domain.js";

const CITY = "المدينة المنورة";

function jsToFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === "number") return { doubleValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((item) => jsToFirestoreValue(item)) } };
  }
  if (typeof value === "object") {
    const fields = {};
    for (const [key, nested] of Object.entries(value)) fields[key] = jsToFirestoreValue(nested);
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function firestoreValueToJs(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map(firestoreValueToJs);
  if ("mapValue" in value) return firestoreFieldsToJs(value.mapValue?.fields || {});
  return null;
}

function firestoreFieldsToJs(fields) {
  const output = {};
  for (const [key, value] of Object.entries(fields || {})) output[key] = firestoreValueToJs(value);
  return output;
}

function createMemoryDeps() {
  const docs = new Map();
  const updateTimes = new Map();
  const keyOf = (segments) => segments.join("/");
  const parentOf = (key) => key.split("/").slice(0, -1).join("/");
  let clock = 1;
  const deps = {
    projectId: "demo",
    accessToken: "token",
    firestoreFieldsToJs,
    firestoreHelpers: {
      firestoreString: (v) => ({ stringValue: String(v) }),
      firestoreBoolean: (v) => ({ booleanValue: Boolean(v) }),
      firestoreInteger: (v) => ({ integerValue: String(v) }),
      firestoreTimestamp: (v) => ({ timestampValue: new Date(v).toISOString() }),
      firestoreOptionalString: (v) => (v ? { stringValue: String(v) } : null),
      firestoreFieldsToJs,
      jsToFirestoreValue
    },
    async getFirestoreDocument({ segments, allowMissing = false }) {
      const key = keyOf(segments);
      const fields = docs.get(key);
      if (!fields) return allowMissing ? null : null;
      return { fields, updateTime: updateTimes.get(key) || "t1", name: key };
    },
    async setFirestoreDocument({ segments, fields }) {
      const key = keyOf(segments);
      const current = { ...(docs.get(key) || {}) };
      for (const [name, value] of Object.entries(fields || {})) {
        if (value != null) current[name] = value;
      }
      docs.set(key, current);
      updateTimes.set(key, `t${clock++}`);
      return { fields: current, updateTime: updateTimes.get(key) };
    },
    async patchFirestoreDocument({ segments, fields, updateTime }) {
      const key = keyOf(segments);
      if (updateTime && updateTimes.get(key) && updateTimes.get(key) !== updateTime) {
        const err = new Error("FAILED_PRECONDITION");
        throw err;
      }
      return deps.setFirestoreDocument({ segments, fields });
    },
    async listCollectionDocuments({ segments }) {
      const prefix = keyOf(segments);
      const out = [];
      for (const [key, fields] of docs) {
        if (parentOf(key) === prefix) out.push({ name: key, fields });
      }
      return out;
    }
  };
  deps._docs = docs;
  return deps;
}

function seedOffice(deps, office) {
  const fields = {};
  for (const [key, value] of Object.entries(office)) fields[key] = jsToFirestoreValue(value);
  deps._docs.set(`offices/${office.officeId}`, fields);
}

function opportunity(extra = {}) {
  return {
    id: "opp_public_1",
    opportunityId: "opp_public_1",
    opportunityKind: "REQUEST",
    purpose: "PURCHASE",
    propertyType: "أرض",
    city: CITY,
    district: "السكب",
    budget: 850000,
    ...extra
  };
}

function baseOffice(id, extra = {}) {
  return {
    officeId: id,
    city: CITY,
    accountStatus: "active",
    approvalStatus: "approved",
    acceptPlatformPublicOpportunities: true,
    specialties: ["purchase", "sale"],
    primaryNeighborhoodId: "alsakb",
    serviceNeighborhoodIds: ["alsakb"],
    ...extra
  };
}

test("TEST 1 service: OFFICE_DIRECT never routes to another office", async () => {
  const deps = createMemoryDeps();
  seedOffice(deps, baseOffice("office-a"));
  seedOffice(deps, baseOffice("office-b", { primaryNeighborhoodId: "alhamra", serviceNeighborhoodIds: ["alhamra"] }));
  const result = await afterPublicIntakePersisted(deps, {
    officeId: "office-a",
    source: "office_public_link",
    opportunity: opportunity({ id: "opp_direct_1", opportunityId: "opp_direct_1" })
  });
  assert.equal(result.skippedRouter, true);
  assert.equal(result.assignedOfficeId, "office-a");
  const stored = firestoreFieldsToJs(deps._docs.get("offices/office-a/opportunities/opp_direct_1"));
  assert.equal(stored.originSourceType, ORIGIN_SOURCE_TYPE.OFFICE_DIRECT);
  assert.equal(stored.assignedOfficeId, "office-a");
  const routed = await routePlatformOpportunity(deps, { opportunityId: "opp_direct_1" });
  assert.equal(routed.ok, false);
});

test("TEST 2/8/18 service: public intake offers only rank 1 and is idempotent", async () => {
  const deps = createMemoryDeps();
  seedOffice(deps, baseOffice("office-a"));
  seedOffice(deps, baseOffice("office-b", { primaryNeighborhoodId: "alhamra", serviceNeighborhoodIds: ["alhamra"] }));
  const first = await afterPublicIntakePersisted(deps, {
    officeId: "platform",
    source: "platform_public",
    opportunity: opportunity()
  });
  assert.equal(first.routingStatus, ROUTING_STATUS.OFFERED_TO_OFFICE);
  assert.equal(first.currentOfferedOfficeId, "office-a");
  const second = await routePlatformOpportunity(deps, { opportunityId: "opp_public_1" });
  assert.equal(second.idempotent, true);
  assert.equal(second.currentOfferedOfficeId, "office-a");
  const opsA = [...deps._docs.keys()].filter((key) => key.startsWith("offices/office-a/operations/"));
  const opsB = [...deps._docs.keys()].filter((key) => key.startsWith("offices/office-b/operations/"));
  assert.equal(opsA.length, 1);
  assert.equal(opsB.length, 0);
});

test("TEST 9 service: decline offers the next office for the same opportunityId", async () => {
  const deps = createMemoryDeps();
  seedOffice(deps, baseOffice("office-a"));
  seedOffice(deps, baseOffice("office-b", { primaryNeighborhoodId: "alhamra", serviceNeighborhoodIds: ["alhamra"] }));
  await afterPublicIntakePersisted(deps, {
    officeId: "platform",
    source: "platform_public",
    opportunity: opportunity()
  });
  const declined = await declinePlatformOffer(deps, {
    officeId: "office-a",
    opportunityId: "opp_public_1",
    reason: "TOO_BUSY"
  });
  assert.equal(declined.ok, true);
  assert.equal(declined.next.currentOfferedOfficeId, "office-b");
  const attempts = [...deps._docs.entries()]
    .filter(([key]) => key.includes("/routingAttempts/"))
    .map(([, fields]) => firestoreFieldsToJs(fields));
  const firstAttempt = attempts.find((row) => row.officeId === "office-a");
  assert.equal(firstAttempt.decision, ATTEMPT_DECISION.DECLINED);
  const platform = firestoreFieldsToJs(deps._docs.get("offices/platform/opportunities/opp_public_1"));
  assert.equal(platform.id, "opp_public_1");
});

test("TEST 10 service: expiry offers the next office automatically", async () => {
  const deps = createMemoryDeps();
  seedOffice(deps, baseOffice("office-a"));
  seedOffice(deps, baseOffice("office-b", { primaryNeighborhoodId: "alhamra", serviceNeighborhoodIds: ["alhamra"] }));
  await afterPublicIntakePersisted(deps, {
    officeId: "platform",
    source: "platform_public",
    opportunity: opportunity()
  });
  const platform = firestoreFieldsToJs(deps._docs.get("offices/platform/opportunities/opp_public_1"));
  deps._docs.get("offices/platform/opportunities/opp_public_1").currentOfferedExpiresAt = {
    stringValue: new Date(Date.now() - 1000).toISOString()
  };
  const attemptKey = [...deps._docs.keys()].find((key) => key.includes("/routingAttempts/"));
  deps._docs.get(attemptKey).expiresAt = { stringValue: new Date(Date.now() - 1000).toISOString() };
  const expired = await expireDuePlatformOffers(deps, { opportunityId: "opp_public_1" });
  assert.equal(expired.expiredCount, 1);
  const next = firestoreFieldsToJs(deps._docs.get("offices/platform/opportunities/opp_public_1"));
  assert.equal(next.currentOfferedOfficeId, "office-b");
  assert.equal(platform.id, next.id);
});

test("TEST 11 service: concurrent accept allows only one winner", async () => {
  const deps = createMemoryDeps();
  seedOffice(deps, baseOffice("office-a"));
  await afterPublicIntakePersisted(deps, {
    officeId: "platform",
    source: "platform_public",
    opportunity: opportunity()
  });
  const first = await acceptPlatformOffer(deps, { officeId: "office-a", opportunityId: "opp_public_1" });
  assert.equal(first.ok, true);
  const second = await acceptPlatformOffer(deps, { officeId: "office-a", opportunityId: "opp_public_1" });
  assert.equal(second.ok, false);
  const assigned = firestoreFieldsToJs(deps._docs.get("offices/office-a/opportunities/opp_public_1"));
  assert.equal(assigned.assignedOfficeId, "office-a");
  assert.equal(assigned.originSourceType, ORIGIN_SOURCE_TYPE.PLATFORM_PUBLIC);
});

test("TEST 16/17 service: opt-out and unsupported city fail closed", async () => {
  const deps = createMemoryDeps();
  seedOffice(deps, baseOffice("office-a", { acceptPlatformPublicOpportunities: false }));
  const none = await afterPublicIntakePersisted(deps, {
    officeId: "platform",
    source: "platform_public",
    opportunity: opportunity()
  });
  assert.equal(none.routingStatus, ROUTING_STATUS.NO_ELIGIBLE_OFFICE);
  seedOffice(deps, baseOffice("office-b"));
  const otherCity = await afterPublicIntakePersisted(deps, {
    officeId: "platform",
    source: "platform_public",
    opportunity: opportunity({ id: "opp_public_2", opportunityId: "opp_public_2", city: "جدة" })
  });
  assert.equal(otherCity.routingStatus, ROUTING_STATUS.NO_ELIGIBLE_OFFICE);
  const kept = firestoreFieldsToJs(deps._docs.get("offices/platform/opportunities/opp_public_2"));
  assert.equal(kept.routingStatus, ROUTING_STATUS.NO_ELIGIBLE_OFFICE);
  assert.equal(kept.assignedOfficeId, "");
});

test("TEST 15 service: rating persists, updates aggregate, blocks duplicates", async () => {
  const deps = createMemoryDeps();
  seedOffice(deps, baseOffice("office-a", { ratingAverage: 0, ratingCount: 0 }));
  await afterPublicIntakePersisted(deps, {
    officeId: "platform",
    source: "platform_public",
    opportunity: opportunity()
  });
  await acceptPlatformOffer(deps, { officeId: "office-a", opportunityId: "opp_public_1" });
  const first = await submitOfficeRating(deps, {
    officeId: "office-a",
    opportunityId: "opp_public_1",
    raterId: "party_1",
    raterRole: "party",
    stars: 5
  });
  assert.equal(first.ok, true);
  assert.equal(first.ratingCount, 1);
  const dup = await submitOfficeRating(deps, {
    officeId: "office-a",
    opportunityId: "opp_public_1",
    raterId: "party_1",
    raterRole: "party",
    stars: 4
  });
  assert.equal(dup.error, "duplicate_rating");
  const office = firestoreFieldsToJs(deps._docs.get("offices/office-a"));
  assert.equal(office.ratingCount, 1);
  assert.equal(office.ratingAverage, 5);
});
