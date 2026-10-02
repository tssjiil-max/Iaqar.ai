/**
 * Saving the office's own settings. Same documents and the same name-claim transaction the old
 * settings screen uses, so the existing Firestore rules (canManage + officeNameClaims) apply
 * unchanged and both apps stay consistent.
 */

import { db, idToken, workerBase, ApiError } from "./runtime.js";
import { session } from "./session.js";
import { OFFICE_NAME_MESSAGES, publicProfileMirror, checkPublicSlug } from "../domain/office-profile-domain.js";
import { COOPERATION_MODES, cooperationSettingsPayload, normalizeCooperationMode } from "../../js/office-domain.js";

const stamp = () => window.firebase.firestore.FieldValue.serverTimestamp();

/** true when no other office holds this name key (the name keeps working for its own office). */
export async function officeNameIsFree(nameKey) {
  const snap = await db().collection("officeNameClaims").doc(nameKey).get();
  return !snap.exists || snap.data().officeId === session.officeId;
}

export async function saveOfficeProfile(data) {
  const officeId = session.officeId;
  const uid = session.user?.uid;
  if (!officeId || !uid) throw new ApiError("سجل دخول المكتب أولًا");
  const officeRef = db().collection("offices").doc(officeId);
  const claimRef = db().collection("officeNameClaims").doc(data.officeNameKey);
  const publicRef = db().collection("publicOffices").doc(officeId);
  try {
    await db().runTransaction(async (tx) => {
      const [officeSnap, claimSnap] = await Promise.all([tx.get(officeRef), tx.get(claimRef)]);
      if (claimSnap.exists && claimSnap.data().officeId !== officeId) throw new Error("OFFICE_NAME_TAKEN");
      const oldKey = officeSnap.exists ? String(officeSnap.data().officeNameKey || "") : "";
      if (oldKey && oldKey !== data.officeNameKey) {
        const oldClaimRef = db().collection("officeNameClaims").doc(oldKey);
        const oldClaim = await tx.get(oldClaimRef);
        if (oldClaim.exists && oldClaim.data().officeId === officeId) tx.delete(oldClaimRef);
      }
      tx.set(claimRef, { officeId, ownerUid: uid, officeName: data.officeName, updatedAt: stamp() }, { merge: true });
      tx.set(officeRef, { ...data, officeId, ownerUid: officeSnap.exists && officeSnap.data().ownerUid ? officeSnap.data().ownerUid : uid, updatedAt: stamp() }, { merge: true });
      tx.set(publicRef, { officeId, ...publicProfileMirror(data), updatedAt: stamp() }, { merge: true });
    });
  } catch (error) {
    if (error?.message === "OFFICE_NAME_TAKEN") throw new ApiError(OFFICE_NAME_MESSAGES.taken);
    if (error?.code === "permission-denied") throw new ApiError("غير مصرح لك بتعديل بيانات المكتب — يلزم مدير المكتب.");
    throw new ApiError("تعذر حفظ بيانات المكتب — حاول مجددًا.");
  }
  Object.assign(session.office, data);
  document.title = session.office.officeName || document.title;
}

export const COOPERATION_OPTIONS = COOPERATION_MODES;

export async function loadCooperationMode() {
  const snap = await db().collection("offices").doc(session.officeId).collection("officeSettings").doc("cooperation").get();
  return normalizeCooperationMode(snap.exists ? snap.data().mode : "");
}

export async function saveCooperationMode(mode) {
  const officeId = session.officeId;
  const payload = cooperationSettingsPayload(mode);
  try {
    await db().collection("offices").doc(officeId).collection("officeSettings").doc("cooperation")
      .set({ officeId, ...payload, updatedAt: stamp(), updatedBy: session.user.uid }, { merge: true });
    await db().collection("publicOffices").doc(officeId).set({ officeId, cooperationMode: payload.mode, updatedAt: stamp() }, { merge: true });
  } catch (error) {
    if (error?.code === "permission-denied") throw new ApiError("غير مصرح لك بتعديل التعاون — يلزم مدير المكتب.");
    throw new ApiError("تعذر حفظ إعداد التعاون — حاول مجددًا.");
  }
  return payload.mode;
}

/** The short link handle is saved by the Worker (it owns the uniqueness claim). */
export async function savePublicSlug(slug) {
  const checked = checkPublicSlug(slug);
  if (!checked.ok) throw new ApiError(checked.message);
  let response;
  try {
    response = await fetch(`${workerBase()}/office/public-slug`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}`, "X-Office-Id": session.officeId },
      body: JSON.stringify({ officeId: session.officeId, publicSlug: checked.slug })
    });
  } catch (_) {
    throw new ApiError("تعذر الاتصال بالخادم — حاول مجددًا.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(payload.message || "تعذر حفظ معرّف الرابط");
  session.office.publicSlug = checked.slug;
  return checked.slug;
}
