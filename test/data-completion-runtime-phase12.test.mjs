import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  completionRuntimeBoundaryGuarantees,
  createPersistentCompletionSession,
  readPersistentCompletionSession,
  submitPersistentCompletionSession
} from "../worker/src/data-completion-runtime-service.js";

test("completed public form hands the same opportunity directly to matching", () => {
  const source = readFileSync(new URL("../worker/src/index.js", import.meta.url), "utf8");
  const start = source.indexOf("onOpportunityReady: async");
  const end = source.indexOf("async function handleCompletionSessionCreate", start);
  const block = source.slice(start, end);
  assert.match(block, /findAndSaveMatchesForOpportunity\(\{/);
  assert.match(block, /opportunityId/);
  assert.match(block, /notify:\s*true/);
});

function helpersFixture(initial = {}) {
  const db = new Map();
  const writes = [];
  const callbacks = [];

  function fieldToJs(value) {
    if (!value) return null;
    if ("stringValue" in value) return value.stringValue;
    if ("integerValue" in value) return Number(value.integerValue);
    if ("booleanValue" in value) return Boolean(value.booleanValue);
    if ("timestampValue" in value) return value.timestampValue;
    return null;
  }
  const firestoreHelpers = {
    firestoreString: (v) => ({ stringValue: String(v ?? "") }),
    firestoreInteger: (v) => ({ integerValue: String(Number(v || 0)) }),
    firestoreBoolean: (v) => ({ booleanValue: Boolean(v) }),
    firestoreTimestamp: (v) => ({ timestampValue: new Date(v).toISOString() }),
    firestoreFieldsToJs: (fields = {}) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fieldToJs(v)]))
  };
  function jsFields(obj = {}) {
    const fields = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "number") fields[k] = firestoreHelpers.firestoreInteger(v);
      else if (typeof v === "boolean") fields[k] = firestoreHelpers.firestoreBoolean(v);
      else fields[k] = firestoreHelpers.firestoreString(v);
    }
    return fields;
  }
  for (const [path, value] of Object.entries(initial)) db.set(path, { fields: jsFields(value) });

  const deps = {
    firestoreHelpers,
    officeIdsEquivalent: (a, b) => String(a) === String(b),
    getFirestoreDocument: async ({ segments, allowMissing }) => {
      const doc = db.get(segments.join("/"));
      if (!doc && !allowMissing) throw new Error("not_found");
      return doc || null;
    },
    setFirestoreDocument: async ({ segments, fields }) => {
      const path = segments.join("/");
      const prior = db.get(path)?.fields || {};
      const compact = Object.fromEntries(Object.entries(fields || {}).filter(([, v]) => v != null));
      db.set(path, { fields: { ...prior, ...compact } });
      writes.push({ path, fields: compact });
    },
    projectMissingData: async (payload) => callbacks.push({ type: "missing", ...payload }),
    onOpportunityReady: async (payload) => callbacks.push({ type: "ready", ...payload })
  };
  return { db, writes, callbacks, deps, firestoreHelpers };
}

const incompleteOpportunity = {
  officeId: "office-a",
  opportunityKind: "REQUEST",
  purpose: "PURCHASE",
  propertyType: "فيلا",
  city: "المدينة المنورة",
  district: "العزيزية",
  priceOrBudget: 900000,
  advertiserRole: "CLIENT",
  contactPhone: ""
};

test("persistent completion stores only token hash under the office namespace", async () => {
  const fx = helpersFixture({
    "offices/office-a/opportunities/opp-1": incompleteOpportunity,
    "offices/office-a": { officeId: "office-a", name: "مكتب أ" }
  });
  const result = await createPersistentCompletionSession({
    projectId: "p", officeId: "office-a", opportunityId: "opp-1", createdBy: "broker-1",
    accessToken: "google", appOrigin: "https://example.test", deps: fx.deps
  });
  assert.equal(result.ok, true);
  assert.match(result.sessionId, /^cmp_/);
  assert.match(result.completionUrl, /\/complete\.html\?office=office-a&session=cmp_/);
  assert.match(result.completionUrl, /#token=/);

  const path = `offices/office-a/completionSessions/${result.sessionId}`;
  const stored = fx.firestoreHelpers.firestoreFieldsToJs(fx.db.get(path).fields);
  assert.ok(stored.tokenHash);
  assert.equal(stored.token, undefined);
  assert.equal(result.completionUrl.includes(stored.tokenHash), false);
  assert.equal(fx.callbacks.at(-1).type, "missing");
});

test("public completion read rejects a wrong token and does not expose owner-only fields", async () => {
  const fx = helpersFixture({
    "offices/office-a/opportunities/opp-1": { ...incompleteOpportunity, internalNote: "secret" },
    "offices/office-a": { officeId: "office-a", name: "مكتب أ" }
  });
  const minted = await createPersistentCompletionSession({ projectId: "p", officeId: "office-a", opportunityId: "opp-1", accessToken: "g", deps: fx.deps });
  const denied = await readPersistentCompletionSession({
    projectId: "p", officeId: "office-a", sessionId: minted.sessionId, token: "wrong", accessToken: "g", deps: fx.deps
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.error, "invalid_token");

  const token = decodeURIComponent(minted.completionUrl.split("#token=")[1]);
  const allowed = await readPersistentCompletionSession({
    projectId: "p", officeId: "office-a", sessionId: minted.sessionId, token, accessToken: "g", deps: fx.deps
  });
  assert.equal(allowed.ok, true);
  assert.equal("internalNote" in allowed.view.opportunity, false);
  assert.deepEqual(allowed.view.session.allowedFields, ["contactPhone"]);
});

test("completion submission accepts only requested fields and advances to READY_FOR_MATCHING", async () => {
  const fx = helpersFixture({
    "offices/office-a/opportunities/opp-1": incompleteOpportunity,
    "offices/office-a": { officeId: "office-a", name: "مكتب أ" }
  });
  const minted = await createPersistentCompletionSession({ projectId: "p", officeId: "office-a", opportunityId: "opp-1", accessToken: "g", deps: fx.deps });
  const token = decodeURIComponent(minted.completionUrl.split("#token=")[1]);
  const result = await submitPersistentCompletionSession({
    projectId: "p", officeId: "office-a", sessionId: minted.sessionId, token,
    patch: { contactPhone: "0551234567", officeId: "evil-office", internalStatus: "CLOSED" },
    accessToken: "g", deps: fx.deps, now: new Date("2026-09-07T20:00:00Z")
  });
  assert.equal(result.ok, true);
  assert.equal(result.isComplete, true);
  assert.equal(result.isReadyForMatching, true);
  assert.equal(result.sessionStatus, "COMPLETED");

  const opportunity = fx.firestoreHelpers.firestoreFieldsToJs(fx.db.get("offices/office-a/opportunities/opp-1").fields);
  assert.equal(opportunity.officeId, "office-a");
  assert.equal(opportunity.internalStatus, undefined);
  assert.equal(opportunity.contactPhone, "0551234567");
  assert.equal(opportunity.matchingReadiness, "READY_FOR_MATCHING");
  assert.equal(opportunity.completionStatus, "COMPLETE");
  assert.equal(fx.callbacks.at(-1).type, "ready");
});

test("completed completion session cannot be replayed", async () => {
  const fx = helpersFixture({
    "offices/office-a/opportunities/opp-1": incompleteOpportunity,
    "offices/office-a": { officeId: "office-a" }
  });
  const minted = await createPersistentCompletionSession({ projectId: "p", officeId: "office-a", opportunityId: "opp-1", accessToken: "g", deps: fx.deps });
  const token = decodeURIComponent(minted.completionUrl.split("#token=")[1]);
  const first = await submitPersistentCompletionSession({
    projectId: "p", officeId: "office-a", sessionId: minted.sessionId, token,
    patch: { contactPhone: "0551234567" }, accessToken: "g", deps: fx.deps
  });
  assert.equal(first.ok, true);
  const replay = await submitPersistentCompletionSession({
    projectId: "p", officeId: "office-a", sessionId: minted.sessionId, token,
    patch: { contactPhone: "0559999999" }, accessToken: "g", deps: fx.deps
  });
  assert.equal(replay.ok, false);
  assert.equal(replay.error, "session_not_active");
});

test("runtime contract never allows browser Firestore writes or token persistence", () => {
  const guarantees = completionRuntimeBoundaryGuarantees();
  assert.equal(guarantees.rawTokenPersisted, false);
  assert.equal(guarantees.browserWritesFirestore, false);
  assert.equal(guarantees.editableFieldsWhitelisted, true);
  assert.equal(guarantees.officeOwnershipPreserved, true);
  assert.equal(guarantees.terminalSessionReplayAllowed, false);
});
