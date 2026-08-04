/**
 * Phase 1 security gate — executable Firestore rules tests.
 *
 * Loads the repository's real `firestore.rules` into the Firestore emulator via
 * `@firebase/rules-unit-testing`. Rules are never duplicated or approximated here.
 *
 * Run (starts emulator, loads rules from firebase.json / this suite, exits):
 *   npm run test:rules
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc
} from "firebase/firestore";
import { cooperationSettingsPayload } from "../../public/js/office-domain.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const RULES_PATH = resolve(ROOT, "firestore.rules");
const PROJECT_ID = "demo-iaqar-rules";

/** Absolute path used so the suite always binds the repo rules file. */
const RULES_SOURCE = readFileSync(RULES_PATH, "utf8");

assert.match(RULES_SOURCE, /^rules_version = '2';/m, "must load the real firestore.rules file");
assert.match(RULES_SOURCE, /match \/officeSettings\/\{settingId\}/);
assert.match(RULES_SOURCE, /match \/officeNameClaims\/\{nameKey\}/);

let testEnv;

function officeProfile(overrides = {}) {
  return {
    officeId: "office-a",
    ownerUid: "owner-a",
    officeName: "مكتب ألف",
    officeNameKey: "مكتبالف",
    brokerName: "وسيط ألف",
    phone: "0551111111",
    whatsapp: "0551111111",
    licenseNumber: "100001",
    city: "الرياض",
    specialties: ["sale"],
    publicSlug: "office-a-public",
    ...overrides
  };
}

async function seedTenantData() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, "offices/office-a"), officeProfile());
    await setDoc(doc(db, "offices/office-b"), officeProfile({
      officeId: "office-b",
      ownerUid: "owner-b",
      officeName: "مكتب باء",
      officeNameKey: "مكتبباء",
      brokerName: "وسيط باء",
      phone: "0552222222",
      whatsapp: "0552222222",
      licenseNumber: "100002",
      publicSlug: "office-b-public"
    }));

    await setDoc(doc(db, "offices/office-a/members/broker-a1"), {
      officeId: "office-a",
      role: "broker",
      active: true
    });
    await setDoc(doc(db, "offices/office-a/members/broker-a2"), {
      officeId: "office-a",
      role: "broker",
      active: true
    });
    await setDoc(doc(db, "offices/office-a/members/manager-a"), {
      officeId: "office-a",
      role: "manager",
      active: true
    });
    await setDoc(doc(db, "offices/office-b/members/broker-b1"), {
      officeId: "office-b",
      role: "broker",
      active: true
    });

    await setDoc(doc(db, "offices/office-a/officeSettings/profile"), {
      officeId: "office-a",
      notificationPreferences: {
        matches: true,
        participants: true,
        cooperation: true,
        messages: true,
        appointmentsFollowUps: true,
        systemImportant: true
      },
      cooperation: cooperationSettingsPayload("SMART_AUTOMATIC"),
      // Private operational note — must never become world-readable via publicOffices.
      privateContactNote: "0551111111-owner-direct"
    });

    await setDoc(doc(db, "offices/office-b/officeSettings/profile"), {
      officeId: "office-b",
      notificationPreferences: { matches: true },
      cooperation: cooperationSettingsPayload("APPROVAL_REQUIRED"),
      privateContactNote: "0552222222-owner-direct"
    });

    await setDoc(doc(db, "offices/office-a/brokerSettings/broker-a1"), {
      officeId: "office-a",
      brokerId: "broker-a1",
      quietHours: true
    });
    await setDoc(doc(db, "offices/office-a/brokerSettings/broker-a2"), {
      officeId: "office-a",
      brokerId: "broker-a2",
      quietHours: false
    });

    await setDoc(doc(db, "officeNameClaims/مكتبالف"), {
      officeId: "office-a",
      officeName: "مكتب ألف",
      ownerUid: "owner-a"
    });

    // Approved public office projection — intentionally excludes private settings/contacts.
    await setDoc(doc(db, "publicOffices/office-a"), {
      officeId: "office-a",
      officeName: "مكتب ألف",
      brokerName: "وسيط ألف",
      city: "الرياض",
      publicSlug: "office-a-public"
    });
  });
}

test.before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST is not set. Run via: npm run test:rules"
    );
  }

  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: RULES_SOURCE,
      host: "127.0.0.1",
      port: Number(process.env.FIRESTORE_EMULATOR_PORT || 8080)
    }
  });
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedTenantData();
});

test.after(async () => {
  if (testEnv) await testEnv.cleanup();
});

function authed(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function unauthed() {
  return testEnv.unauthenticatedContext().firestore();
}

// ---------------------------------------------------------------------------
// Office settings isolation
// ---------------------------------------------------------------------------

test("Office A can read and update its own allowed office settings", async () => {
  const db = authed("owner-a");
  const ref = doc(db, "offices/office-a/officeSettings/profile");

  const snap = await assertSucceeds(getDoc(ref));
  assert.equal(snap.data().officeId, "office-a");
  assert.equal(snap.data().cooperation.exposeContactAutomatically, false);

  await assertSucceeds(updateDoc(ref, {
    officeId: "office-a",
    notificationPreferences: {
      matches: false,
      participants: true,
      cooperation: true,
      messages: true,
      appointmentsFollowUps: true,
      systemImportant: true
    },
    cooperation: cooperationSettingsPayload("APPROVAL_REQUIRED")
  }));
});

test("Office A cannot read Office B office settings", async () => {
  const db = authed("owner-a");
  await assertFails(getDoc(doc(db, "offices/office-b/officeSettings/profile")));
});

test("Office A cannot update Office B office settings", async () => {
  const db = authed("owner-a");
  await assertFails(updateDoc(doc(db, "offices/office-b/officeSettings/profile"), {
    officeId: "office-b",
    cooperation: cooperationSettingsPayload("DISABLED")
  }));
});

// ---------------------------------------------------------------------------
// Broker settings isolation
// ---------------------------------------------------------------------------

test("A broker can access only their permitted brokerSettings", async () => {
  const db = authed("broker-a1");
  const own = doc(db, "offices/office-a/brokerSettings/broker-a1");

  const snap = await assertSucceeds(getDoc(own));
  assert.equal(snap.data().brokerId, "broker-a1");

  await assertSucceeds(updateDoc(own, {
    officeId: "office-a",
    brokerId: "broker-a1",
    quietHours: false
  }));
});

test("A broker cannot read or update another broker’s private settings", async () => {
  const db = authed("broker-a1");
  const other = doc(db, "offices/office-a/brokerSettings/broker-a2");

  // Same office, different broker: read is denied unless manager/owner.
  await assertFails(getDoc(other));
  await assertFails(updateDoc(other, {
    officeId: "office-a",
    brokerId: "broker-a2",
    quietHours: true
  }));

  // Cross-office broker cannot touch Office A settings either.
  const outsider = authed("broker-b1");
  await assertFails(getDoc(doc(outsider, "offices/office-a/brokerSettings/broker-a1")));
  await assertFails(updateDoc(doc(outsider, "offices/office-a/brokerSettings/broker-a1"), {
    officeId: "office-a",
    brokerId: "broker-a1",
    quietHours: true
  }));
});

// ---------------------------------------------------------------------------
// officeNameClaims
// ---------------------------------------------------------------------------

test("A new unique officeNameClaim can be created correctly", async () => {
  const db = authed("owner-b");
  await assertSucceeds(setDoc(doc(db, "officeNameClaims/مسارالعقار"), {
    officeId: "office-b",
    officeName: "مسار العقار",
    ownerUid: "owner-b"
  }));

  const snap = await assertSucceeds(getDoc(doc(db, "officeNameClaims/مسارالعقار")));
  assert.equal(snap.data().officeId, "office-b");
});

test("An existing officeNameClaim cannot be taken over by another office", async () => {
  const attacker = authed("owner-b");
  await assertFails(updateDoc(doc(attacker, "officeNameClaims/مكتبالف"), {
    officeId: "office-b",
    officeName: "مكتب ألف",
    ownerUid: "owner-b"
  }));

  // Owner A may refresh own claim metadata without changing officeId.
  const owner = authed("owner-a");
  await assertSucceeds(updateDoc(doc(owner, "officeNameClaims/مكتبالف"), {
    officeId: "office-a",
    officeName: "مكتب ألف",
    ownerUid: "owner-a"
  }));
});

test("An office cannot change a claim’s officeId after creation", async () => {
  const db = authed("owner-a");
  await assertFails(updateDoc(doc(db, "officeNameClaims/مكتبالف"), {
    officeId: "office-b",
    officeName: "مكتب ألف",
    ownerUid: "owner-a"
  }));
});

// ---------------------------------------------------------------------------
// Unauthenticated access
// ---------------------------------------------------------------------------

test("Unauthenticated users cannot access protected office settings or claims", async () => {
  const db = unauthed();

  await assertFails(getDoc(doc(db, "offices/office-a/officeSettings/profile")));
  await assertFails(updateDoc(doc(db, "offices/office-a/officeSettings/profile"), {
    officeId: "office-a",
    cooperation: cooperationSettingsPayload("DISABLED")
  }));
  await assertFails(getDoc(doc(db, "offices/office-a/brokerSettings/broker-a1")));
  await assertFails(getDoc(doc(db, "officeNameClaims/مكتبالف")));
  await assertFails(setDoc(doc(db, "officeNameClaims/اسمجديد"), {
    officeId: "office-a",
    officeName: "اسم جديد"
  }));
  await assertFails(getDoc(doc(db, "offices/office-a")));
});

// ---------------------------------------------------------------------------
// Cooperation contact exposure + public offices
// ---------------------------------------------------------------------------

test("Cooperation settings do not expose contact information automatically", async () => {
  // Domain invariant used when writing settings.
  const payload = cooperationSettingsPayload("SMART_AUTOMATIC");
  assert.equal(payload.exposeContactAutomatically, false);

  const ownerDb = authed("owner-a");
  const settings = await assertSucceeds(
    getDoc(doc(ownerDb, "offices/office-a/officeSettings/profile"))
  );
  assert.equal(settings.data().cooperation.mode, "SMART_AUTOMATIC");
  assert.equal(settings.data().cooperation.exposeContactAutomatically, false);
  assert.equal(settings.data().privateContactNote, "0551111111-owner-direct");

  // Another office cannot read those private cooperation/contact fields.
  await assertFails(
    getDoc(doc(authed("owner-b"), "offices/office-a/officeSettings/profile"))
  );

  // Public projection stays readable and does not include private contact notes
  // or the cooperation settings document fields.
  const publicSnap = await assertSucceeds(
    getDoc(doc(unauthed(), "publicOffices/office-a"))
  );
  const publicData = publicSnap.data();
  assert.equal(publicData.officeName, "مكتب ألف");
  assert.equal(publicData.privateContactNote, undefined);
  assert.equal(publicData.cooperation, undefined);
  assert.equal(publicData.exposeContactAutomatically, undefined);
  assert.equal(publicData.phone, undefined);
});

test("Existing approved public-office access continues to work", async () => {
  const db = unauthed();
  const snap = await assertSucceeds(getDoc(doc(db, "publicOffices/office-a")));
  assert.equal(snap.exists(), true);
  assert.equal(snap.data().publicSlug, "office-a-public");

  // Unauthenticated users still cannot mutate the public card.
  await assertFails(updateDoc(doc(db, "publicOffices/office-a"), {
    officeName: "اسم مزيف"
  }));
  await assertFails(deleteDoc(doc(db, "publicOffices/office-a")));

  // Managing office can still refresh its public card.
  await assertSucceeds(updateDoc(doc(authed("owner-a"), "publicOffices/office-a"), {
    officeId: "office-a",
    officeName: "مكتب ألف",
    brokerName: "وسيط ألف",
    city: "الرياض",
    publicSlug: "office-a-public"
  }));
});

// ---------------------------------------------------------------------------
// Phase 2 opportunity isolation
// ---------------------------------------------------------------------------

test("Office A can create and read its own opportunities and sources", async () => {
  const db = authed("broker-a1");
  await assertSucceeds(setDoc(doc(db, "offices/office-a/opportunitySources/src_phase2_a"), {
    officeId: "office-a",
    brokerId: "broker-a1",
    sourceType: "text",
    deduplicationFingerprint: "fp-a"
  }));
  await assertSucceeds(setDoc(doc(db, "offices/office-a/opportunities/opp_phase2_a"), {
    officeId: "office-a",
    brokerId: "broker-a1",
    sourceType: "text",
    sourceReference: "src_phase2_a",
    deduplicationFingerprint: "fp-a",
    opportunityKind: "OFFER",
    purpose: "SALE"
  }));
  const snap = await assertSucceeds(getDoc(doc(db, "offices/office-a/opportunities/opp_phase2_a")));
  assert.equal(snap.data().officeId, "office-a");
});

test("Office A cannot read or write Office B opportunities or sources", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "offices/office-b/opportunities/opp_phase2_b"), {
      officeId: "office-b",
      brokerId: "broker-b1",
      sourceType: "text",
      sourceReference: "src_b",
      deduplicationFingerprint: "fp-b"
    });
    await setDoc(doc(db, "offices/office-b/opportunitySources/src_phase2_b"), {
      officeId: "office-b",
      brokerId: "broker-b1",
      sourceType: "text",
      deduplicationFingerprint: "fp-b"
    });
  });

  const db = authed("owner-a");
  await assertFails(getDoc(doc(db, "offices/office-b/opportunities/opp_phase2_b")));
  await assertFails(getDoc(doc(db, "offices/office-b/opportunitySources/src_phase2_b")));
  await assertFails(setDoc(doc(db, "offices/office-b/opportunities/opp_hack"), {
    officeId: "office-b",
    brokerId: "owner-a",
    sourceType: "text",
    sourceReference: "x",
    deduplicationFingerprint: "hack"
  }));
});

test("Unauthenticated users cannot access opportunities or sources", async () => {
  const db = unauthed();
  await assertFails(getDoc(doc(db, "offices/office-a/opportunities/opp_phase2_a")));
  await assertFails(setDoc(doc(db, "offices/office-a/opportunitySources/src_unauth"), {
    officeId: "office-a",
    brokerId: "anon",
    sourceType: "text",
    deduplicationFingerprint: "x"
  }));
});

// ---------------------------------------------------------------------------
// Phase 3 — Opportunity Bank isolation, ownership, cooperation / sharing
// ---------------------------------------------------------------------------

function opportunityDoc(overrides = {}) {
  return {
    officeId: "office-a",
    brokerId: "broker-a1",
    originatingOfficeId: "office-a",
    originatingBrokerId: "broker-a1",
    sourceType: "text",
    sourceReference: "src_phase3_a",
    deduplicationFingerprint: "fp-phase3-a",
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "شقة",
    city: "الرياض",
    district: "النرجس",
    priceOrBudget: 900000,
    lifecycleStatus: "ACTIVE",
    cooperationStatus: "NOT_SHARED",
    cooperationState: "NOT_SHARED",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    version: 1,
    ...overrides
  };
}

function cooperationPayload(overrides = {}) {
  return {
    id: "coop_test_1",
    originatingOfficeId: "office-a",
    originatingBrokerId: "broker-a1",
    targetOfficeId: "office-b",
    targetBrokerId: "",
    opportunityId: "opp_phase3_a",
    opportunityIds: ["opp_phase3_a"],
    scopeType: "single",
    requestedAt: "2026-08-03T10:00:00.000Z",
    status: "PENDING",
    permissions: {
      readOnly: true,
      minimumData: true,
      contactVisible: false,
      ownershipModifiable: false,
      canDelete: false,
      canArchive: false,
      unrestrictedAttachmentDownload: false,
      canReshare: false
    },
    createdBy: "broker-a1",
    createdAt: "2026-08-03T10:00:00.000Z",
    updatedAt: "2026-08-03T10:00:00.000Z",
    ...overrides
  };
}

test("Phase 3: Office A can read and soft-update its Opportunity Bank records", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "offices/office-a/opportunities/opp_phase3_a"), opportunityDoc());
  });

  const db = authed("broker-a1");
  const snap = await assertSucceeds(getDoc(doc(db, "offices/office-a/opportunities/opp_phase3_a")));
  assert.equal(snap.data().officeId, "office-a");
  assert.equal(snap.data().cooperationStatus, "NOT_SHARED");

  await assertSucceeds(updateDoc(doc(db, "offices/office-a/opportunities/opp_phase3_a"), {
    ...opportunityDoc(),
    city: "جدة",
    version: 2,
    updatedAt: "2026-08-03T12:00:00.000Z",
    brokerConfirmed: true
  }));

  await assertSucceeds(updateDoc(doc(db, "offices/office-a/opportunities/opp_phase3_a"), {
    ...opportunityDoc({ city: "جدة", version: 2 }),
    lifecycleStatus: "ARCHIVED",
    archivedAt: "2026-08-03T12:30:00.000Z",
    archivedBy: "broker-a1",
    version: 3
  }));
});

test("Phase 3: Office A cannot read, update, archive, or hard-delete Office B opportunities", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "offices/office-b/opportunities/opp_phase3_b"), opportunityDoc({
      officeId: "office-b",
      brokerId: "broker-b1",
      originatingOfficeId: "office-b",
      originatingBrokerId: "broker-b1",
      deduplicationFingerprint: "fp-b-phase3"
    }));
  });

  const db = authed("owner-a");
  await assertFails(getDoc(doc(db, "offices/office-b/opportunities/opp_phase3_b")));
  await assertFails(updateDoc(doc(db, "offices/office-b/opportunities/opp_phase3_b"), {
    lifecycleStatus: "ARCHIVED",
    archivedAt: "2026-08-03T12:00:00.000Z"
  }));
  await assertFails(updateDoc(doc(db, "offices/office-b/opportunities/opp_phase3_b"), {
    lifecycleStatus: "DELETED",
    deletedAt: "2026-08-03T12:00:00.000Z"
  }));
  await assertFails(deleteDoc(doc(db, "offices/office-b/opportunities/opp_phase3_b")));
});

test("Phase 3: hard delete of own opportunities is denied; ownership fields are immutable", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "offices/office-a/opportunities/opp_phase3_a"), opportunityDoc({
      city: "جدة",
      version: 3
    }));
  });

  const db = authed("broker-a1");
  await assertFails(deleteDoc(doc(db, "offices/office-a/opportunities/opp_phase3_a")));

  await assertFails(updateDoc(doc(db, "offices/office-a/opportunities/opp_phase3_a"), {
    ...opportunityDoc({ city: "جدة", version: 3 }),
    officeId: "office-b"
  }));

  await assertFails(updateDoc(doc(db, "offices/office-a/opportunities/opp_phase3_a"), {
    ...opportunityDoc({ city: "جدة", version: 3 }),
    originatingOfficeId: "office-b"
  }));

  await assertFails(updateDoc(doc(db, "offices/office-a/opportunities/opp_phase3_a"), {
    ...opportunityDoc({ city: "جدة", version: 3 }),
    brokerId: "broker-b1"
  }));

  await assertFails(updateDoc(doc(db, "offices/office-a/opportunities/opp_phase3_a"), {
    ...opportunityDoc({ city: "جدة", version: 3 }),
    createdAt: "1999-01-01T00:00:00.000Z"
  }));
});

test("Phase 3: unauthenticated users cannot access the Opportunity Bank", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "offices/office-a/opportunities/opp_phase3_a"), opportunityDoc());
    await setDoc(doc(db, "cooperationRequests/coop_test_1"), cooperationPayload());
  });

  const db = unauthed();
  await assertFails(getDoc(doc(db, "offices/office-a/opportunities/opp_phase3_a")));
  await assertFails(getDoc(doc(db, "cooperationRequests/coop_test_1")));
  await assertFails(getDoc(doc(db, "bankSharingScopes/scope_test_1")));
  await assertFails(getDoc(doc(db, "offices/office-b/sharedOpportunities/opp_phase3_a")));
});

test("Phase 3: originating office can create a PENDING cooperation request; outsiders cannot forge it", async () => {
  const broker = authed("broker-a1");
  await assertSucceeds(setDoc(doc(broker, "cooperationRequests/coop_test_1"), cooperationPayload()));

  const outsider = authed("broker-b1");
  await assertFails(setDoc(doc(outsider, "cooperationRequests/coop_forged"), cooperationPayload({
    id: "coop_forged",
    originatingOfficeId: "office-a",
    originatingBrokerId: "broker-b1",
    targetOfficeId: "office-b"
  })));

  // Target office cannot create a request pretending to originate from itself for Office A's id mismatch path:
  await assertFails(setDoc(doc(outsider, "cooperationRequests/coop_wrong_origin"), cooperationPayload({
    id: "coop_wrong_origin",
    originatingOfficeId: "office-a",
    originatingBrokerId: "broker-b1"
  })));
});

test("Phase 3: only the target office may accept/reject; originating office may revoke", async () => {
  const origin = authed("broker-a1");
  await assertSucceeds(setDoc(doc(origin, "cooperationRequests/coop_test_1"), cooperationPayload()));

  const target = authed("broker-b1");
  const other = authed("owner-a"); // originating member but not target for accept
  // Office A cannot accept on behalf of Office B.
  await assertFails(updateDoc(doc(other, "cooperationRequests/coop_test_1"), {
    status: "ACCEPTED",
    acceptedAt: "2026-08-03T13:00:00.000Z",
    respondedAt: "2026-08-03T13:00:00.000Z"
  }));

  await assertSucceeds(updateDoc(doc(target, "cooperationRequests/coop_test_1"), {
    status: "ACCEPTED",
    acceptedAt: "2026-08-03T13:00:00.000Z",
    respondedAt: "2026-08-03T13:00:00.000Z",
    respondedBy: "broker-b1"
  }));

  // After acceptance, target cannot flip to REJECTED (only PENDING → ACCEPTED|REJECTED).
  await assertFails(updateDoc(doc(target, "cooperationRequests/coop_test_1"), {
    status: "REJECTED"
  }));

  await assertSucceeds(updateDoc(doc(origin, "cooperationRequests/coop_test_1"), {
    status: "REVOKED",
    revokedAt: "2026-08-03T14:00:00.000Z",
    endedAt: "2026-08-03T14:00:00.000Z",
    revokedBy: "broker-a1"
  }));
});

test("Phase 3: shared projection hides contacts; cooperating office cannot mutate source ownership", async () => {
  const target = authed("broker-b1");
  await assertSucceeds(setDoc(doc(target, "offices/office-b/sharedOpportunities/opp_phase3_a"), {
    id: "opp_phase3_a",
    sourceOpportunityId: "opp_phase3_a",
    originatingOfficeId: "office-a",
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "شقة",
    city: "الرياض",
    district: "النرجس",
    contactName: "",
    contactPhone: "",
    phone: "",
    readOnly: true
  }));

  await assertFails(setDoc(doc(target, "offices/office-b/sharedOpportunities/opp_bad_contact"), {
    id: "opp_bad",
    originatingOfficeId: "office-a",
    contactName: "",
    contactPhone: "0559999999",
    phone: "",
    readOnly: true
  }));

  // Cooperating office still cannot touch the source opportunity under Office A.
  await assertFails(updateDoc(doc(target, "offices/office-a/opportunities/opp_phase3_a"), {
    officeId: "office-b"
  }));
  await assertFails(updateDoc(doc(target, "offices/office-a/opportunities/opp_phase3_a"), {
    lifecycleStatus: "DELETED",
    deletedAt: "2026-08-03T15:00:00.000Z"
  }));
  await assertFails(deleteDoc(doc(target, "offices/office-a/opportunities/opp_phase3_a")));
});

test("Phase 3: scoped bank sharing is createable by origin and readable by target only when active", async () => {
  const origin = authed("broker-a1");
  await assertSucceeds(setDoc(doc(origin, "bankSharingScopes/scope_test_1"), {
    sharingScopeId: "scope_test_1",
    originatingOfficeId: "office-a",
    originatingBrokerId: "broker-a1",
    targetOfficeId: "office-b",
    filters: { activeOnly: true },
    opportunityIds: ["opp_phase3_a"],
    permissions: {
      readOnly: true,
      contactVisible: false,
      ownershipModifiable: false,
      canDelete: false
    },
    status: "DISABLED",
    enabled: false,
    createdAt: "2026-08-03T10:00:00.000Z",
    updatedAt: "2026-08-03T10:00:00.000Z",
    revokedAt: null,
    createdBy: "broker-a1"
  }));

  // Disabled scope: target cannot read.
  await assertFails(getDoc(doc(authed("broker-b1"), "bankSharingScopes/scope_test_1")));

  await assertSucceeds(updateDoc(doc(origin, "bankSharingScopes/scope_test_1"), {
    sharingScopeId: "scope_test_1",
    originatingOfficeId: "office-a",
    originatingBrokerId: "broker-a1",
    targetOfficeId: "office-b",
    filters: { activeOnly: true },
    opportunityIds: ["opp_phase3_a"],
    permissions: {
      readOnly: true,
      contactVisible: false,
      ownershipModifiable: false,
      canDelete: false
    },
    status: "ACTIVE",
    enabled: true,
    createdAt: "2026-08-03T10:00:00.000Z",
    updatedAt: "2026-08-03T11:00:00.000Z",
    revokedAt: null,
    createdBy: "broker-a1"
  }));

  await assertSucceeds(getDoc(doc(authed("broker-b1"), "bankSharingScopes/scope_test_1")));

  await assertSucceeds(updateDoc(doc(origin, "bankSharingScopes/scope_test_1"), {
    sharingScopeId: "scope_test_1",
    originatingOfficeId: "office-a",
    originatingBrokerId: "broker-a1",
    targetOfficeId: "office-b",
    filters: { activeOnly: true },
    opportunityIds: ["opp_phase3_a"],
    permissions: {
      readOnly: true,
      contactVisible: false,
      ownershipModifiable: false,
      canDelete: false
    },
    status: "REVOKED",
    enabled: false,
    createdAt: "2026-08-03T10:00:00.000Z",
    updatedAt: "2026-08-03T12:00:00.000Z",
    revokedAt: "2026-08-03T12:00:00.000Z",
    createdBy: "broker-a1"
  }));

  // After revocation, target loses read access.
  await assertFails(getDoc(doc(authed("broker-b1"), "bankSharingScopes/scope_test_1")));
});
