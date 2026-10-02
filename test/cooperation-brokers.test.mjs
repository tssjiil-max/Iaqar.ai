import test from "node:test";
import assert from "node:assert/strict";
import {
  BROKER_ROLE_LABELS, DEFAULT_BROKERS_PER_COOPERATION, HARD_MAX_BROKERS_PER_COOPERATION, MAX_BROKERS_MESSAGE,
  canAddParticipatingBroker, cooperationBrokerCount, cooperationBrokers, defaultCommission, readCommission, validateCommission
} from "../public/js/cooperation-brokers-domain.js";
import { applyCooperationWorkflowTransition } from "../public/js/cooperation-workflow-domain.js";
import { COOPERATION_BROKER_ACTION, runCooperationBrokerAction } from "../worker/src/cooperation-brokers-service.js";

const A = "office-a"; const B = "office-b"; const C = "office-c";
const base = (over = {}) => ({
  id: "coop-1", originatingOfficeId: A, originatingBrokerId: "uid-a", targetOfficeId: B, targetBrokerId: "uid-b",
  propertyOfficeId: B, clientOfficeId: A, status: "ACCEPTED", currentStage: "CUSTOMER_ACTION", ...over
});

/* In-memory Firestore: values are wrapped so the service's field helpers can be exercised. */
function fakeDeps(initial) {
  const docs = new Map(Object.entries(initial));
  const wrap = (v) => ({ v });
  const key = (segments) => segments.join("/");
  return {
    docs,
    getFirestoreDocument: async ({ segments }) => (docs.has(key(segments)) ? { fields: Object.fromEntries(Object.entries(docs.get(key(segments))).map(([k, v]) => [k, wrap(v)])) } : null),
    setFirestoreDocument: async ({ segments, fields }) => {
      const prev = docs.get(key(segments)) || {};
      docs.set(key(segments), { ...prev, ...Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.v])) });
    },
    firestoreFieldsToJs: (fields) => Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.v])),
    firestoreHelpers: { firestoreString: wrap, firestoreInteger: wrap, firestoreTimestamp: (d) => wrap(d.toISOString()), firestoreBoolean: wrap }
  };
}
const world = () => fakeDeps({
  "cooperationRequests/coop-1": base(),
  "offices/office-a": { ownerUid: "uid-a", brokerName: "سلطان" },
  "offices/office-a/members/uid-a2": { active: true, displayName: "خالد" },
  "offices/office-a/members/uid-gone": { active: false, displayName: "قديم" },
  "offices/office-b": { ownerUid: "uid-b" }
});
const run = (deps, over) => runCooperationBrokerAction({ projectId: "p", actorOfficeId: A, actorUid: "uid-a", cooperationId: "coop-1", accessToken: "t", deps, ...over });

test("a cooperation has two brokers by default and never more than three", () => {
  assert.equal(DEFAULT_BROKERS_PER_COOPERATION, 2);
  assert.equal(HARD_MAX_BROKERS_PER_COOPERATION, 3);
  assert.equal(cooperationBrokerCount(base()), 2);
  assert.equal(cooperationBrokerCount(base({ participatingBrokerId: "uid-a2" })), 3);
});

test("roles are وسيط العرض / وسيط الطلب / وسيط مشارك (no «مُحيل»)", () => {
  assert.deepEqual(Object.values(BROKER_ROLE_LABELS), ["وسيط العرض", "وسيط الطلب", "وسيط مشارك"]);
  const rows = cooperationBrokers(base({ participatingBrokerId: "uid-a2", participatingBrokerOfficeId: A, participatingBrokerName: "خالد" }), { officeId: A });
  assert.deepEqual(rows.map((r) => r.label), ["وسيط العرض", "وسيط الطلب", "وسيط مشارك"]);
  assert.equal(rows[0].officeId, B);
  assert.equal(rows[1].officeId, A);
  assert.ok(!JSON.stringify(rows).includes("مُحيل"));
});

test("a third broker is allowed once, a fourth is refused with the approved message", async () => {
  const deps = world();
  const added = await run(deps, { action: COOPERATION_BROKER_ACTION.ADD_PARTICIPATING_BROKER, brokerId: "uid-a2" });
  assert.equal(added.ok, true);
  assert.equal(deps.docs.get("cooperationRequests/coop-1").participatingBrokerId, "uid-a2");
  assert.equal(deps.docs.get("cooperationRequests/coop-1").participatingBrokerName, "خالد");
  const again = await run(deps, { action: COOPERATION_BROKER_ACTION.ADD_PARTICIPATING_BROKER, brokerId: "uid-a2" });
  assert.equal(again.ok, true); assert.equal(again.duplicate, true);
  const fourth = await run(deps, { action: COOPERATION_BROKER_ACTION.ADD_PARTICIPATING_BROKER, brokerId: "uid-a" });
  assert.equal(fourth.ok, false); assert.equal(fourth.error, "max_brokers"); assert.equal(fourth.message, MAX_BROKERS_MESSAGE);
  assert.equal(deps.docs.get("cooperationRequests/coop-1").participatingBrokerId, "uid-a2");
});

test("the domain refuses a fourth broker by itself (not only the service)", () => {
  const full = base({ participatingBrokerId: "uid-a2" });
  assert.equal(canAddParticipatingBroker(full, { officeId: B, brokerId: "uid-b2" }).error, "max_brokers");
});

test("the participating broker must be an active broker of the adding office", async () => {
  const deps = world();
  assert.equal((await run(deps, { action: "ADD_PARTICIPATING_BROKER", brokerId: "uid-gone" })).error, "broker_not_in_office");
  assert.equal((await run(deps, { action: "ADD_PARTICIPATING_BROKER", brokerId: "uid-b-from-other-office" })).error, "broker_not_in_office");
  assert.equal((await run(deps, { action: "ADD_PARTICIPATING_BROKER", brokerId: "uid-b" })).error, "already_in_cooperation");
});

test("a third broker needs an active cooperation", async () => {
  const deps = world();
  deps.docs.set("cooperationRequests/coop-1", base({ status: "PENDING", currentStage: "WAITING_PARTNER" }));
  assert.equal((await run(deps, { action: "ADD_PARTICIPATING_BROKER", brokerId: "uid-a2" })).error, "cooperation_not_active");
});

test("commission shares must total 100 and default to 50/50 (editable, not a legal rule)", () => {
  assert.deepEqual(defaultCommission(2), { propertyBrokerShare: 50, requestBrokerShare: 50, participatingBrokerShare: 0 });
  assert.equal(defaultCommission(3).propertyBrokerShare + defaultCommission(3).requestBrokerShare + defaultCommission(3).participatingBrokerShare, 100);
  assert.equal(validateCommission({ propertyBrokerShare: 60, requestBrokerShare: 40 }, 2).ok, true);
  assert.equal(validateCommission({ propertyBrokerShare: 60, requestBrokerShare: 30 }, 2).error, "shares_sum");
  assert.equal(validateCommission({ propertyBrokerShare: 50.5, requestBrokerShare: 49.5 }, 2).error, "invalid_share");
  assert.equal(validateCommission({ propertyBrokerShare: -10, requestBrokerShare: 110 }, 2).error, "invalid_share");
  assert.equal(validateCommission({ propertyBrokerShare: 45, requestBrokerShare: 45, participatingBrokerShare: 10 }, 2).error, "no_participating_broker");
  assert.equal(validateCommission({ propertyBrokerShare: 45, requestBrokerShare: 45, participatingBrokerShare: 10 }, 3).ok, true);
});

test("saving the agreement records who and when; the service refuses totals other than 100", async () => {
  const deps = world();
  const bad = await run(deps, { action: "SET_COMMISSION", shares: { propertyBrokerShare: 70, requestBrokerShare: 40 } });
  assert.equal(bad.error, "shares_sum");
  assert.equal(deps.docs.get("cooperationRequests/coop-1").propertyBrokerShare, undefined);
  const ok = await run(deps, { action: "SET_COMMISSION", shares: { propertyBrokerShare: 60, requestBrokerShare: 40 } });
  assert.equal(ok.ok, true);
  const saved = deps.docs.get("cooperationRequests/coop-1");
  assert.equal(saved.propertyBrokerShare, 60); assert.equal(saved.requestBrokerShare, 40);
  assert.equal(saved.commissionAgreementUpdatedBy, "uid-a"); assert.ok(saved.commissionAgreementUpdatedAt);
  assert.deepEqual([readCommission(saved).propertyBrokerShare, readCommission(saved).agreed], [60, true]);
  const same = await run(deps, { action: "SET_COMMISSION", shares: { propertyBrokerShare: 60, requestBrokerShare: 40 } });
  assert.equal(same.duplicate, true);
});

test("adding the third broker re-splits to a total of 100 and the other party sees the last agreement", async () => {
  const deps = world();
  assert.equal((await run(deps, { action: "ADD_PARTICIPATING_BROKER", brokerId: "uid-a2", shares: { propertyBrokerShare: 50, requestBrokerShare: 40, participatingBrokerShare: 20 } })).error, "shares_sum");
  assert.equal((await run(deps, { action: "ADD_PARTICIPATING_BROKER", brokerId: "uid-a2", shares: { propertyBrokerShare: 45, requestBrokerShare: 35, participatingBrokerShare: 20 } })).ok, true);
  const seenByB = readCommission(deps.docs.get("cooperationRequests/coop-1"));
  assert.deepEqual([seenByB.propertyBrokerShare, seenByB.requestBrokerShare, seenByB.participatingBrokerShare], [45, 35, 20]);
});

test("an office that is not a party can neither read nor change the cooperation (403)", async () => {
  const deps = world();
  for (const action of ["ADD_PARTICIPATING_BROKER", "SET_COMMISSION"]) {
    const r = await run(deps, { actorOfficeId: C, actorUid: "uid-c", action, brokerId: "uid-c2", shares: { propertyBrokerShare: 50, requestBrokerShare: 50 } });
    assert.equal(r.ok, false); assert.equal(r.status, 403); assert.equal(r.error, "cooperation_forbidden");
  }
  assert.equal(deps.docs.get("cooperationRequests/coop-1").participatingBrokerId, undefined);
});

test("accepting twice is idempotent and stores the accepting broker once", () => {
  const pending = { id: "c", originatingOfficeId: A, targetOfficeId: B, status: "PENDING", currentStage: "WAITING_PARTNER" };
  const first = applyCooperationWorkflowTransition(pending, "ACCEPT", { actorOfficeId: B, actorUid: "uid-b" });
  assert.equal(first.ok, true); assert.equal(first.patch.targetBrokerId, "uid-b");
  const second = applyCooperationWorkflowTransition({ ...pending, ...first.patch }, "ACCEPT", { actorOfficeId: B, actorUid: "uid-b" });
  assert.equal(second.duplicate, true);
  assert.equal(applyCooperationWorkflowTransition(pending, "ACCEPT", { actorOfficeId: C, actorUid: "uid-c" }).ok, false);
});

test("Firestore rules keep cooperation records readable to the two offices only and closed to client writes of brokers/commission", async () => {
  const { readFileSync } = await import("node:fs");
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const block = rules.slice(rules.indexOf("match /cooperationRequests/{requestId}"), rules.indexOf("match /cooperationRooms/{roomId}"));
  assert.match(block, /allow read: if signedIn\(\)\s*&& \(isOfficeMember\(resource\.data\.originatingOfficeId\)\s*\|\| isOfficeMember\(resource\.data\.targetOfficeId\)\)/);
  assert.doesNotMatch(block, /participatingBroker|BrokerShare|commissionAgreement/);
  assert.match(block, /allow delete: if false/);
});
