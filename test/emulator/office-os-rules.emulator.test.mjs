/**
 * Office OS — executable Firestore rules tests (emulator, real firestore.rules).
 * Run with: npm run test:rules
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, serverTimestamp } from "firebase/firestore";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RULES = readFileSync(resolve(ROOT, "firestore.rules"), "utf8");
let env;

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-iaqar-rules", firestore: { rules: RULES } });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [id, owner] of [["office-a", "owner-a"], ["office-b", "owner-b"]]) {
      await setDoc(doc(db, `offices/${id}`), { officeId: id, ownerUid: owner, officeName: id, officeNameKey: `${id}key`, specialties: [] });
      await setDoc(doc(db, `offices/${id}/members/${owner}`), { uid: owner, role: "owner", active: true });
      await setDoc(doc(db, `offices/${id}/journeys/jr_1`), { officeId: id, status: "ACTIVE", assignedBrokerId: owner });
      await setDoc(doc(db, `offices/${id}/journeys/jr_1/events/ev_1`), { officeId: id, type: "MATCH_APPROVED" });
      await setDoc(doc(db, `offices/${id}/proposals/pr_1`), { officeId: id, journeyId: "jr_1", status: "ACTIVE" });
      await setDoc(doc(db, `offices/${id}/osFailures/fl_1`), { officeId: id, kind: "MATCHING_RUN" });
      await setDoc(doc(db, `offices/${id}/operations/op_1`), { officeId: id, type: "SEND_PROPOSAL", status: "OPEN" });
      await setDoc(doc(db, `publicOffices/${id}`), { officeId: id, officeName: id, publicSlug: `${id}-slug` });
    }
    await setDoc(doc(db, "offices/office-a/members/broker-a"), { uid: "broker-a", role: "broker", active: true });
    await setDoc(doc(db, "offices/office-a/members/inactive-a"), { uid: "inactive-a", role: "broker", active: false });
    await setDoc(doc(db, "replyLinks/rl_abc"), { officeId: "office-a", proposalId: "pr_1", status: "ACTIVE" });
  });
});
test.after(async () => { await env?.cleanup(); });

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

test("office members read their own journeys, timeline and proposals", async () => {
  for (const uid of ["owner-a", "broker-a"]) {
    const db = as(uid);
    await assertSucceeds(getDoc(doc(db, "offices/office-a/journeys/jr_1")));
    await assertSucceeds(getDoc(doc(db, "offices/office-a/journeys/jr_1/events/ev_1")));
    await assertSucceeds(getDoc(doc(db, "offices/office-a/proposals/pr_1")));
    await assertSucceeds(getDocs(query(collection(db, "offices/office-a/proposals"), where("journeyId", "==", "jr_1"))));
  }
});

test("office isolation: other offices, inactive members and visitors cannot read", async () => {
  for (const db of [as("owner-b"), as("inactive-a"), anon()]) {
    await assertFails(getDoc(doc(db, "offices/office-a/journeys/jr_1")));
    await assertFails(getDoc(doc(db, "offices/office-a/journeys/jr_1/events/ev_1")));
    await assertFails(getDoc(doc(db, "offices/office-a/proposals/pr_1")));
    await assertFails(getDoc(doc(db, "offices/office-a/operations/op_1")));
  }
});

test("clients can never write journeys, events or proposals (Worker only)", async () => {
  const db = as("owner-a");
  await assertFails(setDoc(doc(db, "offices/office-a/journeys/jr_new"), { officeId: "office-a", status: "ACTIVE" }));
  await assertFails(updateDoc(doc(db, "offices/office-a/journeys/jr_1"), { status: "CLOSED_WON" }));
  await assertFails(deleteDoc(doc(db, "offices/office-a/journeys/jr_1")));
  await assertFails(setDoc(doc(db, "offices/office-a/journeys/jr_1/events/ev_x"), { officeId: "office-a", type: "PARTY_REPLY" }));
  await assertFails(setDoc(doc(db, "offices/office-a/proposals/pr_x"), { officeId: "office-a", status: "ANSWERED" }));
  await assertFails(updateDoc(doc(db, "offices/office-a/proposals/pr_1"), { sendState: "DELIVERED" }));
  await assertFails(updateDoc(doc(db, "offices/office-a/operations/op_1"), { status: "COMPLETED" }));
});

test("replyLinks and osFailures are closed to every client", async () => {
  for (const db of [as("owner-a"), as("broker-a"), as("owner-b"), anon()]) {
    await assertFails(getDoc(doc(db, "replyLinks/rl_abc")));
    await assertFails(setDoc(doc(db, "replyLinks/rl_new"), { officeId: "office-a" }));
    await assertFails(getDoc(doc(db, "offices/office-a/osFailures/fl_1")));
    await assertFails(setDoc(doc(db, "offices/office-a/osFailures/fl_2"), { officeId: "office-a" }));
  }
});

test("public office page: visitors read publicOffices and submit the new office-link payload", async () => {
  const db = anon();
  await assertSucceeds(getDoc(doc(db, "publicOffices/office-a")));
  await assertSucceeds(getDocs(query(collection(db, "publicOffices"), where("publicSlug", "==", "office-a-slug"))));
  const payload = {
    officeId: "office-a", kind: "owner", name: "عبدالله السبيعي", phone: "0557654321", propertyType: "شقة",
    district: "الملقا", city: "الرياض", purpose: "SALE", transactionType: "sale", amount: 1250000, area: 0, rooms: 0,
    details: "", mediaPaths: [], imageCount: 0, hasVideo: false, source: "office_public_link", status: "new", createdAt: serverTimestamp()
  };
  await assertSucceeds(setDoc(doc(db, "offices/office-a/publicIntake/in_1"), payload));
  await assertSucceeds(setDoc(doc(db, "offices/office-a/publicIntake/in_2"), { ...payload, kind: "client", purpose: "PURCHASE", area: 150 }));
  await assertFails(setDoc(doc(db, "offices/office-a/publicIntake/in_3"), { ...payload, officeId: "office-b" }), "cannot retarget another office");
  await assertFails(setDoc(doc(db, "offices/office-a/publicIntake/in_4"), { ...payload, status: "processed" }));
  await assertFails(getDoc(doc(db, "offices/office-a/publicIntake/in_1")), "visitors cannot read intakes");
});

test("assignment and deal-permission settings: managers only", async () => {
  await assertSucceeds(setDoc(doc(as("owner-a"), "offices/office-a/officeSettings/assignment"), { officeId: "office-a", defaultBrokerId: "broker-a" }, { merge: true }));
  await assertSucceeds(setDoc(doc(as("owner-a"), "offices/office-a/officeSettings/deals"), { officeId: "office-a", brokerMayClose: true }, { merge: true }));
  await assertFails(setDoc(doc(as("broker-a"), "offices/office-a/officeSettings/deals"), { officeId: "office-a", brokerMayClose: true }, { merge: true }));
  await assertFails(setDoc(doc(as("owner-b"), "offices/office-a/officeSettings/assignment"), { officeId: "office-a", defaultBrokerId: "x" }, { merge: true }));
  assert.ok(true);
});
