/**
 * B-01 — office authority (emulator, real firestore.rules).
 *
 * Ownership, subscription, approval/suspension and licence state are platform-controlled: no browser
 * changes them, not even the owner or a platform admin (those go through audited Worker routes:
 * /admin/office/owner-transfer, /admin/office/subscription, /admin/office/suspend|reactivate|license).
 * Staff roles live in offices/{o}/members and change only through the Worker (/os/members/access,
 * owner only). Every legitimate profile save the current screens make keeps working.
 * Run with: npm run test:rules
 */
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RULES = readFileSync(resolve(ROOT, "firestore.rules"), "utf8");
let env;

const OFFICE_A = {
  officeId: "office-a", ownerUid: "owner-a", officeName: "مكتب الأول", officeNameKey: "officeakey", specialties: [],
  approvalStatus: "approved", accountStatus: "suspended", subscriptionStatus: "expired", licenseStatus: "valid", pilotAuthorized: true
};

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-iaqar-authority", firestore: { rules: RULES } });
});
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "offices/office-a"), OFFICE_A);
    await setDoc(doc(db, "publicOffices/office-a"), { officeId: "office-a", officeName: "مكتب الأول", approvalStatus: "approved", accountStatus: "active", publicSlug: "office-a-slug" });
    await setDoc(doc(db, "offices/office-a/members/owner-a"), { uid: "owner-a", role: "owner", active: true });
    await setDoc(doc(db, "offices/office-a/members/manager-a"), { uid: "manager-a", role: "manager", active: true });
    await setDoc(doc(db, "offices/office-a/members/broker-a"), { uid: "broker-a", role: "broker", active: true });
    await setDoc(doc(db, "offices/office-b"), { officeId: "office-b", ownerUid: "owner-b", officeName: "مكتب الثاني", officeNameKey: "officebkey", specialties: [] });
    await setDoc(doc(db, "offices/office-b/members/owner-b"), { uid: "owner-b", role: "owner", active: true });
  });
});
test.after(async () => { await env?.cleanup(); });

const as = (uid) => env.authenticatedContext(uid).firestore();
const asPlatformAdmin = () => env.authenticatedContext("platform-admin", { platformAdmin: true }).firestore();

const PLATFORM_FIELDS = {
  ownerUid: "manager-a",
  subscriptionStatus: "active",
  subscriptionExpiresAt: new Date("2030-01-01"),
  accountStatus: "active",
  approvalStatus: "approved-by-self",
  licenseStatus: "valid-forever",
  pilotAuthorized: false,
  approvedByUid: "manager-a",
  suspensionReason: ""
};

// ── Platform-controlled office fields ─────────────────────────────────────────────────────────────
for (const [field, value] of Object.entries(PLATFORM_FIELDS)) {
  test(`office doc: no browser changes «${field}» — manager, owner and platform admin alike`, async () => {
    for (const db of [as("manager-a"), as("owner-a"), asPlatformAdmin()]) {
      await assertFails(updateDoc(doc(db, "offices/office-a"), { [field]: value }));
    }
  });
}

test("office doc: a protected field cannot be added where it was missing", async () => {
  await assertFails(updateDoc(doc(as("owner-b"), "offices/office-b"), { subscriptionStatus: "active" }));
  await assertFails(updateDoc(doc(as("owner-b"), "offices/office-b"), { accountStatus: "active" }));
});

test("office doc: a protected field cannot be removed", async () => {
  await assertFails(setDoc(doc(as("owner-a"), "offices/office-a"), {
    officeId: "office-a", ownerUid: "owner-a", officeName: "مكتب الأول", officeNameKey: "officeakey", specialties: []
  }));
});

// ── Legitimate saves keep working ─────────────────────────────────────────────────────────────────
test("office doc: the manager still saves the office profile (the settings screen's transaction shape)", async () => {
  // public/os/core/office-profile.js and public/js/office-settings.js re-send ownerUid with its current value.
  await assertSucceeds(setDoc(doc(as("manager-a"), "offices/office-a"), {
    officeName: "مكتب الأول للعقار", officeNameKey: "officeakeyx", brokerName: "سالم", phone: "0500000001",
    specialties: ["sale"], officeId: "office-a", ownerUid: "owner-a", updatedAt: serverTimestamp()
  }, { merge: true }));
});

test("office doc: scope, share-card, photo and onboarding saves keep working", async () => {
  const db = as("manager-a");
  await assertSucceeds(setDoc(doc(db, "offices/office-a"), {
    officeId: "office-a", primaryNeighborhoodId: "n1", serviceNeighborhoodIds: ["n1"], receiveExternalOpportunities: true,
    cooperationAvailableNow: true, acceptPlatformPublicOpportunities: true, city: "المدينة المنورة", updatedAt: serverTimestamp()
  }, { merge: true }));
  await assertSucceeds(setDoc(doc(db, "offices/office-a"), { shareCardNonce: "n", sharePhoto: true, sharePreviewFormat: "v1", updatedAt: serverTimestamp() }, { merge: true }));
  await assertSucceeds(setDoc(doc(db, "offices/office-a"), { brokerPhotoUrl: "https://x/y.jpg", updatedAt: serverTimestamp() }, { merge: true }));
  await assertSucceeds(setDoc(doc(db, "offices/office-a"), { officeId: "office-a", platformOpportunityOnboardingAckAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true }));
});

test("office doc: a broker still cannot edit the profile, and another office cannot touch it", async () => {
  await assertFails(updateDoc(doc(as("broker-a"), "offices/office-a"), { brokerName: "x" }));
  await assertFails(updateDoc(doc(as("owner-b"), "offices/office-a"), { brokerName: "x" }));
});

// ── Staff roles: Worker only ──────────────────────────────────────────────────────────────────────
test("members: no browser promotes, adds, deactivates or deletes a member — owner and platform admin included", async () => {
  for (const db of [as("manager-a"), as("owner-a"), asPlatformAdmin()]) {
    await assertFails(updateDoc(doc(db, "offices/office-a/members/broker-a"), { role: "owner" }));
    await assertFails(updateDoc(doc(db, "offices/office-a/members/broker-a"), { role: "manager" }));
    await assertFails(setDoc(doc(db, "offices/office-a/members/outsider"), { uid: "outsider", role: "admin", active: true }));
    await assertFails(updateDoc(doc(db, "offices/office-a/members/owner-a"), { active: false }));
    await assertFails(deleteDoc(doc(db, "offices/office-a/members/broker-a")));
  }
});

test("members: a broker cannot promote themself", async () => {
  await assertFails(updateDoc(doc(as("broker-a"), "offices/office-a/members/broker-a"), { role: "owner" }));
});

// The office catch-all rule accepts any member's write when the document carries officeId. Before B-01
// that let a broker promote themself or add an admin; these shapes must stay denied.
test("members: carrying officeId does not open the catch-all for any role", async () => {
  for (const uid of ["broker-a", "manager-a", "owner-a"]) {
    const db = as(uid);
    await assertFails(updateDoc(doc(db, "offices/office-a/members/broker-a"), { role: "owner", officeId: "office-a" }));
    await assertFails(setDoc(doc(db, `offices/office-a/members/${uid}`), { uid, role: "owner", active: true, officeId: "office-a" }));
    await assertFails(setDoc(doc(db, "offices/office-a/members/outsider"), { uid: "outsider", role: "admin", active: true, officeId: "office-a" }));
  }
});

test("members: active members still read the member list", async () => {
  await assertSucceeds(getDoc(doc(as("broker-a"), "offices/office-a/members/owner-a")));
  await assertSucceeds(getDoc(doc(as("manager-a"), "offices/office-a/members/broker-a")));
  await assertFails(getDoc(doc(as("owner-b"), "offices/office-a/members/broker-a")));
});

// ── Public mirror ─────────────────────────────────────────────────────────────────────────────────
test("publicOffices: the manager still updates the public profile mirror", async () => {
  await assertSucceeds(setDoc(doc(as("manager-a"), "publicOffices/office-a"), {
    officeId: "office-a", officeName: "مكتب الأول للعقار", primaryNeighborhoodId: "n1", serviceNeighborhoodIds: ["n1"], city: "المدينة المنورة", updatedAt: serverTimestamp()
  }, { merge: true }));
});

test("publicOffices: no browser changes the mirrored approval or account status", async () => {
  for (const db of [as("manager-a"), as("owner-a")]) {
    await assertFails(updateDoc(doc(db, "publicOffices/office-a"), { accountStatus: "suspended-hidden" }));
    await assertFails(updateDoc(doc(db, "publicOffices/office-a"), { approvalStatus: "pending" }));
  }
  await assertFails(setDoc(doc(as("owner-b"), "publicOffices/office-b"), { officeId: "office-b", officeName: "x", accountStatus: "active" }));
});

// ── Office deletion (D-023): never from a browser ─────────────────────────────────────────────────
// Deleting offices/{id} would orphan members, records, deals and audit logs; deleting publicOffices/{id}
// takes the office off the public site. Closing an office is a platform decision through the Worker.
test("office doc: no browser deletes the office — owner, manager, broker and platform admin alike", async () => {
  for (const db of [as("owner-a"), as("manager-a"), as("broker-a"), asPlatformAdmin(), as("owner-b")]) {
    await assertFails(deleteDoc(doc(db, "offices/office-a")));
  }
  const snap = await assertSucceeds(getDoc(doc(as("owner-a"), "offices/office-a")));
  if (!snap.exists()) throw new Error("office document must still exist");
});

test("publicOffices: no browser deletes the public office profile", async () => {
  for (const db of [as("owner-a"), as("manager-a"), as("broker-a"), asPlatformAdmin(), as("owner-b")]) {
    await assertFails(deleteDoc(doc(db, "publicOffices/office-a")));
  }
});

test("after the delete lock, the owner still reads the office, its members and saves the profile", async () => {
  await assertSucceeds(getDoc(doc(as("owner-a"), "offices/office-a")));
  await assertSucceeds(getDoc(doc(as("owner-a"), "offices/office-a/members/broker-a")));
  await assertSucceeds(setDoc(doc(as("owner-a"), "offices/office-a"), { brokerName: "سالم", updatedAt: serverTimestamp() }, { merge: true }));
  await assertSucceeds(setDoc(doc(as("manager-a"), "publicOffices/office-a"), { officeName: "مكتب الأول", updatedAt: serverTimestamp() }, { merge: true }));
});
