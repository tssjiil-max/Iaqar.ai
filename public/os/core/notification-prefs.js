/**
 * Notification preferences — same storage and rules as the old settings screen:
 * officeSettings/notifications (office default, read by the Worker; managers only) and
 * brokerSettings/<uid> (the person's own override).
 */

import { db } from "./runtime.js";
import { session } from "./session.js";
import { resolveNotificationPreferences, sanitizeNotificationPreferences } from "../../js/office-domain.js";

const stamp = () => new Date().toISOString();

export async function loadNotificationPrefs() {
  const ref = db().collection("offices").doc(session.officeId);
  const [officeSnap, brokerSnap] = await Promise.all([
    ref.collection("officeSettings").doc("notifications").get(),
    ref.collection("brokerSettings").doc(session.user.uid).get()
  ]);
  return resolveNotificationPreferences({
    officeDefaults: officeSnap.exists ? officeSnap.data() : null,
    brokerOverrides: brokerSnap.exists ? brokerSnap.data() : null
  });
}

/** Returns { scope: "office" | "account" }: managers also set the office default the server applies. */
export async function saveNotificationPrefs(values) {
  const preferences = sanitizeNotificationPreferences(values);
  const ref = db().collection("offices").doc(session.officeId);
  const writes = [ref.collection("brokerSettings").doc(session.user.uid).set({
    officeId: session.officeId, brokerId: session.user.uid, ...preferences, updatedAt: stamp()
  }, { merge: true })];
  if (session.isManager) {
    writes.push(ref.collection("officeSettings").doc("notifications").set({
      officeId: session.officeId, ...preferences, updatedAt: stamp(), updatedBy: session.user.uid
    }, { merge: true }));
  }
  const results = await Promise.allSettled(writes);
  if (results.some((r) => r.status === "rejected")) throw new Error("تعذر حفظ تفضيلات الإشعارات");
  return { scope: session.isManager ? "office" : "account" };
}
