/**
 * Live data — Firestore listeners scoped to the signed-in office. All reads are
 * member-only by rules; all writes go through the Worker.
 */

import { db, docData } from "./runtime.js";

const ACTIVE = ["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL_RESPONSE"];

function office(officeId) {
  return db().collection("offices").doc(officeId);
}

function listen(ref, onData, onError) {
  return ref.onSnapshot(
    (snap) => onData(snap),
    (error) => { console.warn("[office-os] listener", error?.code || error); if (onError) onError(error); }
  );
}

export function watchTasks(officeId, cb, onError) {
  return listen(office(officeId).collection("operations").where("status", "in", ACTIVE).limit(300),
    (snap) => cb(snap.docs.map(docData)), onError);
}

export function watchRecords(officeId, cb, onError) {
  return listen(office(officeId).collection("opportunities").limit(500),
    (snap) => cb(snap.docs.map(docData)), onError);
}

export function watchDoc(officeId, collection, id, cb, onError) {
  return listen(office(officeId).collection(collection).doc(id),
    (snap) => cb(snap.exists ? docData(snap) : null), onError);
}

export function watchJourneyEvents(officeId, journeyId, cb, onError) {
  return listen(office(officeId).collection("journeys").doc(journeyId).collection("events").orderBy("createdAt", "desc").limit(60),
    (snap) => cb(snap.docs.map(docData)), onError);
}

export function watchJourneyProposals(officeId, journeyId, cb, onError) {
  return listen(office(officeId).collection("proposals").where("journeyId", "==", journeyId).limit(60),
    (snap) => cb(snap.docs.map(docData)), onError);
}

export async function getDoc(officeId, collection, id) {
  const snap = await office(officeId).collection(collection).doc(id).get();
  return snap.exists ? docData(snap) : null;
}

export async function journeysForRecord(officeId, recordId) {
  const col = office(officeId).collection("journeys");
  const [a, b] = await Promise.all([
    col.where("offerId", "==", recordId).limit(20).get(),
    col.where("requestId", "==", recordId).limit(20).get()
  ]);
  const map = new Map();
  for (const snap of [...a.docs, ...b.docs]) map.set(snap.id, docData(snap));
  return [...map.values()];
}

export async function listMembers(officeId) {
  const snap = await office(officeId).collection("members").limit(100).get();
  return snap.docs.map(docData);
}

export async function officeSetting(officeId, id) {
  const snap = await office(officeId).collection("officeSettings").doc(id).get();
  return snap.exists ? snap.data() : {};
}

/** officeSettings writes are allowed for managers by rules (officeId must match). */
export async function saveOfficeSetting(officeId, id, data) {
  await office(officeId).collection("officeSettings").doc(id).set({ ...data, officeId, updatedAt: new Date().toISOString() }, { merge: true });
}

/** The deal journey that follows an accepted cooperation (same match), when this office has one. */
export async function journeyForMatch(officeId, matchId) {
  if (!matchId) return null;
  const snap = await office(officeId).collection("journeys").where("matchId", "==", matchId).limit(1).get();
  return snap.docs.length ? docData(snap.docs[0]) : null;
}
