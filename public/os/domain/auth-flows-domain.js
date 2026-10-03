/** Pure rules for the two pre-login flows: password reset and broker registration (same rules as the old gate). */

import { localPhone } from "./format-domain.js";

const text = (v) => String(v ?? "").trim();
const asciiDigits = (v) => String(v ?? "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\D/g, "");

export const PHONE_ERROR = "أدخل رقم جوال سعودي صحيحًا يبدأ بـ 05.";

/** Returns { ok, errors: {field: message}, value }. Nothing is sent when not ok. */
export function validateBrokerApplication(raw = {}) {
  const errors = {};
  const brokerName = text(raw.brokerName).slice(0, 80);
  const phone = localPhone(raw.phone);
  const email = text(raw.email).toLowerCase().slice(0, 120);
  const falLicense = asciiDigits(raw.falLicense).slice(0, 20);
  const officeName = text(raw.officeName).slice(0, 80);
  const password = String(raw.password ?? "");
  if (!brokerName) errors.brokerName = "أدخل اسم الوسيط";
  if (!phone) errors.phone = PHONE_ERROR;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "أدخل بريدًا إلكترونيًا صحيحًا";
  if (!falLicense) errors.falLicense = "أدخل رقم رخصة فال";
  if (officeName.length < 4) errors.officeName = "اسم المكتب لا يقل عن 4 أحرف";
  if (password.length < 8) errors.password = "كلمة المرور 8 أحرف أو أكثر";
  return { ok: Object.keys(errors).length === 0, errors, value: { brokerName, phone, email, falLicense, officeName }, password };
}

/** Maps a Worker /broker/apply error to the field it belongs to. */
export function mapApplyError(payload = {}, fallback = "تعذر إرسال الطلب الآن") {
  const code = String(payload.code || payload.error || "").toLowerCase();
  const message = text(payload.message || payload.publicMessage) || fallback;
  if (code === "email_already_used" || message.includes("البريد")) return { field: "email", message };
  if (code === "phone_already_used" || message.includes("الجوال")) return { field: "phone", message };
  if (code === "fal_already_used" || code === "fal_invalid" || message.includes("فال")) return { field: "falLicense", message };
  if (code === "invalid_broker_application") return { field: "officeName", message };
  if (code === "pilot_registration_closed" || code === "pilot_access_denied") return { field: "", message: message || "التسجيل متاح حاليًا لعدد محدود من المكاتب ضمن المرحلة التجريبية." };
  return { field: "", message };
}

/** Firebase Auth error code → message (+ field). */
export function mapAuthError(code = "") {
  switch (String(code)) {
    case "auth/email-already-in-use": return { field: "email", message: "البريد مستخدم مسبقًا" };
    case "auth/weak-password": return { field: "password", message: "كلمة المرور ضعيفة — استخدم 8 أحرف أو أكثر" };
    case "auth/invalid-email": return { field: "email", message: "البريد غير صالح" };
    case "auth/network-request-failed": return { field: "", message: "مشكلة اتصال مؤقتة — حاول بعد قليل" };
    default: return { field: "", message: "تعذر إنشاء حساب الدخول — تحقق من البيانات وحاول مرة أخرى" };
  }
}

export function resetMessage(payload = {}) {
  return payload.maskedEmail
    ? `تم إرسال الرابط إلى ${payload.maskedEmail}.`
    : "إذا كان الرقم مسجلًا فسيصل رابط الاسترجاع إلى البريد المرتبط به.";
}

export const APPLY_SUCCESS = "تم استلام الطلب وحالته «بانتظار الاعتماد». ستتواصل الإدارة معك بعد التحقق من رخصة فال.";
