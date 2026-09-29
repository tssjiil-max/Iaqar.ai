/**
 * Runtime: Firebase (compat SDK loaded by index.html), the Worker API, and the
 * office session. Staging hosts talk to the staging Worker/project only
 * (runtime-config.js decides; it fails closed to staging).
 */

export class ApiError extends Error {
  constructor(message, { code = "", status = 0, details = null } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function workerBase() {
  const base = window.IAQAR?.resolveWorkerBase?.() || window.IAQAR?.workerBase || "";
  return String(base).replace(/\/+$/, "");
}

export function firebaseReady() {
  return Boolean(window.firebase && window.firebase.apps && window.firebase.apps.length);
}

export function db() {
  return window.firebase.firestore();
}

export function auth() {
  return window.firebase.auth();
}

export async function idToken() {
  const user = auth().currentUser;
  if (!user) throw new ApiError("سجل دخول المكتب أولًا", { code: "authentication_required", status: 401 });
  return user.getIdToken(false);
}

/**
 * POST JSON to the Worker. Office calls send the Firebase ID token; the Worker verifies
 * it and the office membership before touching any data.
 */
export async function api(path, body = {}, { authenticated = true, keepalive = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (authenticated) headers.Authorization = `Bearer ${await idToken()}`;
  let response;
  try {
    response = await fetch(`${workerBase()}${path}`, { method: "POST", headers, body: JSON.stringify(body), keepalive });
  } catch (_) {
    throw new ApiError("تعذر الاتصال بالخادم — تحقق من الإنترنت وحاول مجددًا", { code: "network" });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false && !payload.state) {
    throw new ApiError(payload.message || "تعذر تنفيذ الطلب — حاول مجددًا", { code: payload.error, status: response.status, details: payload.details });
  }
  return payload;
}

export function officeIdFromUrl() {
  const params = new URLSearchParams(location.search);
  const raw = params.get("officeId") || params.get("office") || params.get("o") || "";
  return String(raw).trim().replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

export function storedOfficeId() {
  try { return String(localStorage.getItem("iaqar.officeId") || ""); } catch (_) { return ""; }
}

export function rememberOfficeId(officeId) {
  try { localStorage.setItem("iaqar.officeId", officeId); } catch (_) { /* storage blocked */ }
}

export function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function docData(snapshot) {
  return { id: snapshot.id, ...(snapshot.data() || {}) };
}
