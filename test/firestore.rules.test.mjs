import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  setDoc,
  updateDoc
} from "firebase/firestore";

const projectId = "iaqar-phase1-test";
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
let environment;

function profile(officeId, ownerUid, officeName, officeNameKey) {
  return {
    officeId,
    ownerUid,
    officeName,
    officeNameKey,
    brokerName: `وسيط ${officeName}`,
    phone: "+966500000000",
    whatsapp: "+966500000000",
    licenseNumber: "1234567890",
    city: "المدينة المنورة",
    specialties: []
  };
}

async function seed() {
  await environment.withSecurityRulesDisabled(async context => {
    const database = context.firestore();
    await setDoc(doc(database, "offices/office-a"), profile("office-a", "user-a", "مكتب ألفا", "مكتبالفا"));
    await setDoc(doc(database, "offices/office-b"), profile("office-b", "user-b", "مكتب بيتا", "مكتببيتا"));
    await setDoc(doc(database, "officeNameClaims/مكتبالفا"), {
      officeId: "office-a",
      ownerUid: "user-a",
      officeName: "مكتب ألفا",
      officeNameKey: "مكتبالفا"
    });
    await setDoc(doc(database, "officeNameClaims/مكتببيتا"), {
      officeId: "office-b",
      ownerUid: "user-b",
      officeName: "مكتب بيتا",
      officeNameKey: "مكتببيتا"
    });
    await setDoc(doc(database, "offices/office-a/opportunities/opportunity-a"), {
      officeId: "office-a",
      title: "فرصة المكتب أ"
    });
    await setDoc(doc(database, "offices/office-b/opportunities/opportunity-b"), {
      officeId: "office-b",
      title: "فرصة المكتب ب"
    });
  });
}

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules }
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await seed();
});

after(async () => {
  await environment.cleanup();
});

test("office members cannot read, list or modify another office data", async () => {
  const officeA = environment.authenticatedContext("user-a").firestore();
  await assertFails(getDoc(doc(officeA, "offices/office-b")));
  await assertFails(getDoc(doc(officeA, "offices/office-b/opportunities/opportunity-b")));
  await assertFails(getDocs(collection(officeA, "offices/office-b/opportunities")));
  await assertFails(updateDoc(doc(officeA, "offices/office-b/opportunities/opportunity-b"), {
    officeId: "office-b",
    title: "تعديل غير مصرح"
  }));
  await assertSucceeds(getDoc(doc(officeA, "offices/office-a/opportunities/opportunity-a")));
});

test("only office managers can save office-scoped preferences", async () => {
  const officeA = environment.authenticatedContext("user-a").firestore();
  await assertSucceeds(setDoc(doc(officeA, "offices/office-a/officeSettings/notifications"), {
    officeId: "office-a",
    matches: true,
    participants: true,
    cooperation: true,
    messages: true,
    appointments: true,
    system: true
  }));
  await assertFails(setDoc(doc(officeA, "offices/office-b/officeSettings/notifications"), {
    officeId: "office-b",
    matches: true,
    participants: true,
    cooperation: true,
    messages: true,
    appointments: true,
    system: true
  }));
});

test("cooperation settings accept the approval default and reject automatic contact exposure", async () => {
  const officeA = environment.authenticatedContext("user-a").firestore();
  const reference = doc(officeA, "offices/office-a/officeSettings/cooperation");
  await assertSucceeds(setDoc(reference, {
    officeId: "office-a",
    mode: "APPROVAL_REQUIRED",
    exposeContactsAutomatically: false
  }));
  await assertFails(setDoc(reference, {
    officeId: "office-a",
    mode: "SMART_AUTOMATIC",
    exposeContactsAutomatically: true
  }));
});

test("office names shorter than four characters are rejected by database rules", async () => {
  const officeA = environment.authenticatedContext("user-a").firestore();
  await assertFails(updateDoc(doc(officeA, "offices/office-a"), {
    officeName: "دار",
    officeNameKey: "دار"
  }));
});

async function claimName(context, officeId, ownerUid, officeName, officeNameKey) {
  const database = context.firestore();
  return runTransaction(database, async transaction => {
    const officeReference = doc(database, `offices/${officeId}`);
    const claimReference = doc(database, `officeNameClaims/${officeNameKey}`);
    const [officeSnapshot, claimSnapshot] = await Promise.all([
      transaction.get(officeReference),
      transaction.get(claimReference)
    ]);
    if (claimSnapshot.exists() && claimSnapshot.data().officeId !== officeId) {
      throw new Error("OFFICE_NAME_TAKEN");
    }
    transaction.set(claimReference, {
      officeId,
      ownerUid,
      officeName,
      officeNameKey
    });
    transaction.set(officeReference, {
      ...officeSnapshot.data(),
      officeName,
      officeNameKey
    });
  });
}

test("one unique normalized office name is accepted", async () => {
  const officeA = environment.authenticatedContext("user-a");
  await assertSucceeds(claimName(officeA, "office-a", "user-a", "المسار العقاري", "المسارالعقاري"));
  const snapshot = await getDoc(doc(officeA.firestore(), "officeNameClaims/المسارالعقاري"));
  assert.equal(snapshot.data().officeId, "office-a");
});

test("concurrent duplicate name claims result in exactly one owning office", async () => {
  const officeA = environment.authenticatedContext("user-a");
  const officeB = environment.authenticatedContext("user-b");
  const results = await Promise.allSettled([
    claimName(officeA, "office-a", "user-a", "الاسم الموحد", "الاسمالموحد"),
    claimName(officeB, "office-b", "user-b", "الاسم الموحد", "الاسمالموحد")
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  let winner;
  await environment.withSecurityRulesDisabled(async context => {
    winner = await getDoc(doc(context.firestore(), "officeNameClaims/الاسمالموحد"));
  });
  assert.ok(["office-a", "office-b"].includes(winner.data().officeId));
});
