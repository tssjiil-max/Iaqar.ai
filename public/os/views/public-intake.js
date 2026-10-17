/**
 * The one way a visitor's submission reaches an office: the page writes offices/<office>/publicIntake/<id>
 * (the Firestore rules check its shape), then asks the Worker to process it (/pipeline/public-intake), which
 * creates the office's record, contact and opportunity, runs the central matching and notifies the office.
 * Used by «لدي عقار» (an offer) and by «أرسل طلبي للمكتب» after a guest search (a request).
 */
import { h } from "../core/dom.js";
import { db, workerBase } from "../core/runtime.js";
import { localPhone, whatsappDigits } from "../domain/format-domain.js";

/** The reference the visitor sees and the office can search for: derived from the intake id, never guessable. */
export const publicReferenceOf = (intakeId) => `IQ-${String(intakeId || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase()}`;

/** A Saudi mobile in any common form (05…, 5…, +966…, Arabic digits) → its local form; "" when it is not one. */
export const saudiMobile = (value) => (whatsappDigits(value) ? localPhone(value) : "");

/** The full name the rules require: at least two words. */
export const fullNameOk = (value) => /\S+\s+\S+/.test(String(value || "").trim());

export const CONTACT_PREFERENCE = Object.freeze({ whatsapp: "واتساب", call: "اتصال" });

/** A fresh intake document reference for this office (its id is the submission's idempotency key). */
export const newIntakeRef = (officeId) => db().collection("offices").doc(officeId).collection("publicIntake").doc();

/** Save the intake. Resolves only after Firestore confirmed the write. */
export async function saveIntake(ref, data) {
  const stamp = window.firebase.firestore.FieldValue.serverTimestamp();
  await ref.set({ ...data, publicReference: publicReferenceOf(ref.id), consentAt: stamp, createdAt: stamp, status: "new" });
}

/**
 * Ask the Worker to process a saved intake. Never an endless wait: after 20 s the visitor is told it was received
 * and the server finishes on its own. Processing is retry-safe (a processed intake answers «duplicate»).
 */
export async function processIntake(officeId, intakeId) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), 20_000);
  const response = await fetch(`${workerBase()}/pipeline/public-intake`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ officeId, intakeId }), signal: controller?.signal
  }).catch(() => null).finally(() => clearTimeout(timer));
  if (response && !response.ok && response.status === 429) throw new Error("تم استلام بياناتك، وسنعالجها بعد قليل.");
  const answer = response && response.ok ? await response.json().catch(() => ({})) : {};
  return { answer, processed: Boolean(response && response.ok) };
}

/**
 * How the visitor's data is handled — only what this code actually does. When the office published its own
 * privacy policy (an https link on its public profile), that is linked as well.
 */
export function dataNotice(office) {
  const name = office?.officeName || "المكتب";
  const policy = /^https:\/\/[^\s]{4,400}$/.test(String(office?.privacyPolicyUrl || "")) ? office.privacyPolicyUrl : "";
  return h("details", { class: "os-public-data-notice", "data-data-notice": "" },
    h("summary", { class: "os-field-note", text: "كيف نتعامل مع بياناتك" }),
    h("ul", { class: "os-sub" },
      h("li", { text: `تصل بياناتك وطلبك إلى ${name} فقط، ولا تظهر لعملاء أو مكاتب أخرى.` }),
      h("li", { text: "نستخدمها لمتابعة هذا الطلب والتواصل معك بالوسيلة التي اخترتها." }),
      h("li", { text: "لا نرسل لك رسائل آلية بدون موافقتك، ولا تُنشر بياناتك." }),
      h("li", { text: `لتعديل بياناتك أو حذفها تواصل مع ${name} مباشرة.` })),
    policy ? h("a", { href: policy, target: "_blank", rel: "noopener", "data-privacy-policy": "", text: "سياسة الخصوصية" }) : null);
}
