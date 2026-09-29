/**
 * Office session — «دخول المكتب» for office owners and brokers only.
 * Membership is re-checked against Firestore (rules-enforced) on every start; the
 * Worker independently re-verifies it on every write.
 */

import { ApiError, auth, db, officeIdFromUrl, rememberOfficeId, storedOfficeId, workerBase } from "./runtime.js";
import { whatsappDigits } from "../domain/format-domain.js";

const MANAGER_ROLES = new Set(["owner", "admin", "manager"]);

export const session = {
  user: null,
  officeId: "",
  office: null,
  member: null,
  role: "",
  isManager: false
};

export function waitForAuth() {
  return new Promise((resolve) => {
    let settled = false;
    const unsubscribe = auth().onAuthStateChanged((user) => {
      if (settled) return;
      settled = true;
      if (typeof unsubscribe === "function") setTimeout(unsubscribe, 0);
      resolve(user || null);
    });
  });
}

export async function loadOfficeAccess(officeId) {
  const user = auth().currentUser;
  if (!user || !officeId) return { ok: false, reason: "signed_out" };
  const officeRef = db().collection("offices").doc(officeId);
  let officeSnap;
  let memberSnap;
  try {
    [officeSnap, memberSnap] = await Promise.all([officeRef.get(), officeRef.collection("members").doc(user.uid).get()]);
  } catch (error) {
    const code = String(error?.code || "");
    if (code.includes("permission")) return { ok: false, reason: "not_member" };
    return { ok: false, reason: "offline" };
  }
  if (!officeSnap.exists) return { ok: false, reason: "office_missing" };
  const office = { id: officeId, ...(officeSnap.data() || {}) };
  const member = memberSnap.exists ? (memberSnap.data() || {}) : null;
  const isOwner = office.ownerUid === user.uid;
  if (!isOwner && (!member || member.active === false)) return { ok: false, reason: member ? "inactive" : "not_member" };
  const role = isOwner ? "owner" : String(member?.role || "broker");
  Object.assign(session, { user, officeId, office, member, role, isManager: MANAGER_ROLES.has(role) });
  rememberOfficeId(officeId);
  window.IAQAR = window.IAQAR || {};
  window.IAQAR.office = { ...(window.IAQAR.office || {}), officeId };
  return { ok: true };
}

export function preferredOfficeId() {
  return officeIdFromUrl() || storedOfficeId();
}

export const ACCESS_MESSAGES = Object.freeze({
  not_member: "هذا الحساب غير مرتبط بهذا المكتب.",
  inactive: "هذا الحساب معطّل في هذا المكتب. تواصل مع مدير المكتب.",
  office_missing: "تعذر العثور على المكتب.",
  offline: "تعذر الوصول إلى البيانات — تحقق من الاتصال.",
  signed_out: "سجل دخول المكتب للمتابعة."
});

/** Phone + password → resolve the office login, then Firebase email/password sign-in. */
export async function signInOffice(phone, password) {
  const digits = whatsappDigits(phone);
  if (!digits) throw new ApiError("أدخل رقم جوال سعودي صحيحًا يبدأ بـ 05");
  if (!password) throw new ApiError("أدخل كلمة المرور");
  let resolved;
  try {
    const response = await fetch(`${workerBase()}/auth/phone-login-resolve`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: `0${digits.slice(3)}` })
    });
    resolved = await response.json().catch(() => ({}));
    if (!response.ok || !resolved.loginEmail || !resolved.officeId) {
      throw new ApiError("رقم الجوال أو كلمة المرور غير صحيحة، أو الحساب غير مفعّل.");
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("تعذر الاتصال بالخادم — حاول مجددًا");
  }
  try {
    await auth().setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
  } catch (_) { /* default persistence */ }
  try {
    await auth().signInWithEmailAndPassword(resolved.loginEmail, password);
  } catch (_) {
    throw new ApiError("رقم الجوال أو كلمة المرور غير صحيحة، أو الحساب غير مفعّل.");
  }
  const access = await loadOfficeAccess(resolved.officeId);
  if (!access.ok) {
    await auth().signOut().catch(() => {});
    throw new ApiError(ACCESS_MESSAGES[access.reason] || ACCESS_MESSAGES.not_member);
  }
  return session;
}

export async function signOutOffice() {
  await auth().signOut().catch(() => {});
  Object.assign(session, { user: null, officeId: "", office: null, member: null, role: "", isManager: false });
}

export function brokerDisplayName(uid) {
  if (!uid) return "";
  if (session.office?.ownerUid === uid) return session.office?.brokerName || "مدير المكتب";
  if (session.user?.uid === uid) return session.member?.displayName || session.member?.name || "أنت";
  return "";
}
