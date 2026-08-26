/**
 * Activepieces ingest validation. Persistence stays in the existing
 * inbox + processInboundMessage path.
 */

import { firestoreOfficeId } from "../../public/js/office-id-domain.js";

export const ACTIVEPIECES_SOURCE = "activepieces";
export const STAGING_FIREBASE_PROJECT = "iaqar-ai-staging";
export const ALLOWED_INTAKE_TYPES = Object.freeze(["owner_offer", "buyer_request"]);

function cleanText(value, maxLength) {
  return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    difference |= (a[i % (a.length || 1)] || 0) ^ (b[i % (b.length || 1)] || 0);
  }
  return difference === 0;
}

export function isStagingFirebaseEnv(env = {}) {
  return String(env.DEPLOYMENT_ENV || "").toLowerCase() === "staging"
    && String(env.FIREBASE_PROJECT_ID || "") === STAGING_FIREBASE_PROJECT;
}

export function authorizeActivepieces(request, env = {}) {
  const expected = String(env.ACTIVEPIECES_INGEST_TOKEN || "");
  if (!expected) return { ok: false, reason: "not_configured" };
  const header = String(request.headers.get("Authorization") || request.headers.get("authorization") || "");
  if (!/^Bearer\s+\S+/i.test(header)) return { ok: false, reason: "missing" };
  const provided = header.replace(/^Bearer\s+/i, "").trim();
  if (!constantTimeEqual(provided, expected)) return { ok: false, reason: "invalid" };
  return { ok: true };
}

export function validateActivepiecesIntakeBody(body = {}) {
  const missingFields = [];
  if (body && (body.projectId || body.collection || body.firebaseProject || body.databaseId)) {
    return {
      ok: false,
      missingFields: [],
      message: "لا يمكن اختيار مشروع أو مجموعة Firebase من الطلب"
    };
  }

  const idempotencyKey = cleanText(body.idempotencyKey, 200);
  if (!idempotencyKey) missingFields.push("idempotencyKey");

  const source = cleanText(body.source, 40);
  if (source !== ACTIVEPIECES_SOURCE) missingFields.push("source");

  const type = cleanText(body.type, 40);
  if (!ALLOWED_INTAKE_TYPES.includes(type)) missingFields.push("type");

  const rawText = cleanText(body.rawText, 12000);
  if (!rawText) missingFields.push("rawText");

  const officeId = body.officeId == null || body.officeId === ""
    ? ""
    : firestoreOfficeId(body.officeId);
  if (!officeId) missingFields.push("officeId");

  if (missingFields.length) {
    const message = missingFields.includes("type") && cleanText(body.type, 40)
      ? "نوع الطلب غير مسموح"
      : "بيانات الطلب غير صالحة";
    return { ok: false, missingFields, message };
  }

  const extracted = body.extracted && typeof body.extracted === "object" ? body.extracted : {};
  return {
    ok: true,
    idempotencyKey,
    source: ACTIVEPIECES_SOURCE,
    type,
    rawText,
    officeId,
    extracted: {
      city: cleanText(extracted.city, 100) || null,
      neighborhood: cleanText(extracted.neighborhood, 100) || null,
      propertyType: cleanText(extracted.propertyType, 80) || null,
      purpose: cleanText(extracted.purpose, 40) || null,
      price: Number.isFinite(Number(extracted.price)) ? Number(extracted.price) : null,
      area: Number.isFinite(Number(extracted.area)) ? Number(extracted.area) : null,
      contactPhone: cleanText(extracted.contactPhone, 60) || null
    }
  };
}

export function composeActivepiecesMessage(payload) {
  const extracted = payload.extracted || {};
  const typeHint = payload.type === "owner_offer" ? "عرض مالك" : "طلب عميل";
  const purposeHint = /ايجار|إيجار|rent/i.test(String(extracted.purpose || ""))
    ? "للإيجار"
    : (extracted.purpose ? "للبيع" : "");
  return [
    typeHint,
    purposeHint,
    extracted.propertyType,
    extracted.neighborhood,
    extracted.city,
    extracted.price ? `بسعر ${extracted.price}` : "",
    extracted.area ? `مساحة ${extracted.area} متر` : "",
    payload.rawText
  ].filter(Boolean).join(" — ");
}

export function activepiecesFailure(status, message, extra = {}) {
  return {
    status,
    body: {
      success: false,
      duplicate: false,
      opportunityId: "",
      missingFields: extra.missingFields || [],
      error: extra.error || (status === 401 ? "unauthorized" : "invalid_body"),
      message,
      requestId: extra.requestId || ""
    }
  };
}
