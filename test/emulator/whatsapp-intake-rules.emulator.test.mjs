/**
 * B-04 — who may read what the WhatsApp intake writes (emulator, real firestore.rules).
 * The Worker writes inbox and opportunities with the service account; browsers only read, and only
 * inside their own office. whatsapp_accounts (number → office mapping) is never readable by a browser.
 * Run with: npm run test:rules
 */
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, limit, query } from "firebase/firestore";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RULES = readFileSync(resolve(ROOT, "firestore.rules"), "utf8");
let env;

// Shapes as written by saveInboundMessage() and startCanonicalIntake() in the Worker.
const inboxDoc = (officeId) => ({
  schemaVersion: 2, officeId, direction: "inbound", source: "whatsapp_cloud_api", channel: "whatsapp_business",
  status: "processed", processingState: "processed", isProcessed: true, outboundEnabled: false,
  messageId: `wamid.${officeId}`, messageType: "text", messageText: "للبيع شقة في العزيزية",
  senderName: "سالم أحمد", senderPhone: "966500000009", phoneNumberId: `phone-${officeId}`, wabaId: `waba-${officeId}`,
  messageClass: "OFFER", opportunityId: `opp_wa_${officeId}`, createdAt: new Date()
});
const waRecord = (officeId) => ({
  schemaVersion: 5, officeId, brokerId: `channel_whatsapp_${officeId}`, originatingOfficeId: officeId,
  currentOwningOfficeId: officeId, sourceChannel: "whatsapp", opportunityKind: "OFFER", purpose: "SALE",
  district: "العزيزية", internalStatus: "NEEDS_DATA", analysisStatus: "analysis_complete",
  lifecycleStatus: "NEW", cooperationState: "NOT_SHARED", createdAt: new Date()
});

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-iaqar-wa-rules", firestore: { rules: RULES } });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [id, owner] of [["office-a", "owner-a"], ["office-b", "owner-b"]]) {
      await setDoc(doc(db, `offices/${id}`), { officeId: id, ownerUid: owner, officeName: id, officeNameKey: `${id}key`, specialties: [] });
      await setDoc(doc(db, `offices/${id}/members/${owner}`), { uid: owner, role: "owner", active: true });
      await setDoc(doc(db, `offices/${id}/inbox/wa_${id}`), inboxDoc(id));
      await setDoc(doc(db, `offices/${id}/opportunities/opp_wa_${id}`), waRecord(id));
      await setDoc(doc(db, `whatsapp_accounts/phone-${id}`), { officeId: id, wabaId: `waba-${id}`, status: "connected" });
    }
    await setDoc(doc(db, "offices/office-a/members/broker-a"), { uid: "broker-a", role: "broker", active: true });
    await setDoc(doc(db, "offices/office-a/members/inactive-a"), { uid: "inactive-a", role: "broker", active: false });
  });
});
test.after(async () => { await env?.cleanup(); });

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

test("an active member reads their own office's WhatsApp inbox and the record it produced", async () => {
  for (const uid of ["owner-a", "broker-a"]) {
    await assertSucceeds(getDoc(doc(as(uid), "offices/office-a/inbox/wa_office-a")));
    await assertSucceeds(getDocs(query(collection(as(uid), "offices/office-a/inbox"), limit(10))));
    await assertSucceeds(getDoc(doc(as(uid), "offices/office-a/opportunities/opp_wa_office-a")));
  }
});

test("another office's member cannot read this office's WhatsApp inbox or records", async () => {
  await assertFails(getDoc(doc(as("owner-b"), "offices/office-a/inbox/wa_office-a")));
  await assertFails(getDocs(query(collection(as("owner-b"), "offices/office-a/inbox"), limit(10))));
  await assertFails(getDoc(doc(as("owner-b"), "offices/office-a/opportunities/opp_wa_office-a")));
});

test("an inactive member and an anonymous visitor cannot read the WhatsApp inbox", async () => {
  await assertFails(getDoc(doc(as("inactive-a"), "offices/office-a/inbox/wa_office-a")));
  await assertFails(getDoc(doc(anon(), "offices/office-a/inbox/wa_office-a")));
});

test("no browser writes the inbox: create, edit and delete are Worker-only, even for the owner", async () => {
  const db = as("owner-a");
  await assertFails(setDoc(doc(db, "offices/office-a/inbox/wa_forged"), inboxDoc("office-a")));
  await assertFails(updateDoc(doc(db, "offices/office-a/inbox/wa_office-a"), { processingState: "kept" }));
  await assertFails(deleteDoc(doc(db, "offices/office-a/inbox/wa_office-a")));
});

test("a member cannot plant a WhatsApp message into another office's inbox", async () => {
  await assertFails(setDoc(doc(as("owner-a"), "offices/office-b/inbox/wa_planted"), inboxDoc("office-b")));
});

test("the number → office mapping (whatsapp_accounts) is closed to every browser", async () => {
  await assertFails(getDoc(doc(as("owner-a"), "whatsapp_accounts/phone-office-a")));
  await assertFails(setDoc(doc(as("owner-a"), "whatsapp_accounts/phone-office-b"), { officeId: "office-a", status: "connected" }));
  await assertFails(getDoc(doc(anon(), "whatsapp_accounts/phone-office-a")));
});
