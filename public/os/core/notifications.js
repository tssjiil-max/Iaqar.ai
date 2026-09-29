/**
 * Device notifications (optional). Uses the existing Worker FCM endpoints; the app
 * works fully without them. Status shown is what the browser/server reports — no
 * delivery claims.
 */

import { idToken, workerBase } from "./runtime.js";
import { session } from "./session.js";

function installationId() {
  const key = "iaqar.notificationInstallationId";
  try {
    let value = localStorage.getItem(key);
    if (!value) {
      value = crypto.randomUUID ? crypto.randomUUID() : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(key, value);
    }
    return value;
  } catch (_) {
    return "";
  }
}

export function notificationStatus() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return "غير مدعومة في هذا المتصفح";
  if (Notification.permission === "denied") return "محظورة من المتصفح";
  try {
    if (localStorage.getItem(`iaqar.fcm.enabled.${session.officeId}`) === "1" && Notification.permission === "granted") return "مفعّلة";
  } catch (_) { /* ignore */ }
  return "غير مفعّلة";
}

function loadFidBridge() {
  if (window.IAQAR_FCM_READY) return window.IAQAR_FCM_READY;
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "/js/fcm-fid.js";
    script.onload = () => resolve(window.IAQAR_FCM_READY || null);
    script.onerror = () => resolve(null);
    document.head.append(script);
  });
}

export async function enableNotifications() {
  try {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return { ok: false, message: "التنبيهات غير مدعومة في هذا المتصفح" };
    const configResponse = await fetch(`${workerBase()}/fcm/config`, { cache: "no-store" });
    const config = await configResponse.json().catch(() => ({}));
    if (!configResponse.ok || !config.serverReady || !config.vapidKey) return { ok: false, message: "خدمة التنبيهات غير مهيأة في الخادم حاليًا" };
    let permission = Notification.permission;
    if (permission !== "granted") permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, message: permission === "denied" ? "التنبيهات محظورة من إعدادات المتصفح" : "لم يتم السماح بالتنبيهات" };
    const swRegistration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
    let registration = null;
    const bridge = await (await loadFidBridge());
    if (bridge?.register) {
      const fid = await bridge.register({ vapidKey: config.vapidKey, serviceWorkerRegistration: swRegistration }).catch(() => "");
      if (fid) registration = { id: fid, type: "fid" };
    }
    if (!registration && window.firebase?.messaging) {
      const token = await window.firebase.messaging().getToken({ vapidKey: config.vapidKey, serviceWorkerRegistration: swRegistration }).catch(() => "");
      if (token) registration = { id: token, type: "token" };
    }
    if (!registration) return { ok: false, message: "تعذر تسجيل هذا الجهاز للتنبيهات" };
    const response = await fetch(`${workerBase()}/fcm/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
      body: JSON.stringify({
        officeId: session.officeId,
        fcmRegistrationId: registration.id,
        registrationType: registration.type,
        fcmToken: registration.type === "token" ? registration.id : "",
        userAgent: navigator.userAgent,
        deviceName: /iPhone|iPad/.test(navigator.userAgent) ? "iPhone" : /Android/.test(navigator.userAgent) ? "Android" : "متصفح",
        installationId: installationId(),
        language: navigator.language || "ar-SA",
        notificationPermission: permission,
        appVersion: "office-os-1"
      })
    });
    if (!response.ok) return { ok: false, message: "تعذر تسجيل الجهاز في الخادم" };
    try { localStorage.setItem(`iaqar.fcm.enabled.${session.officeId}`, "1"); } catch (_) { /* ignore */ }
    return { ok: true, message: "تم تفعيل التنبيهات لهذا الجهاز" };
  } catch (error) {
    console.warn("[office-os] notifications", error);
    return { ok: false, message: "تعذر تفعيل التنبيهات الآن" };
  }
}
