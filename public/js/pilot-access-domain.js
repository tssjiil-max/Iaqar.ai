/**
 * Production pilot access — pure domain. No I/O.
 * Authoritative office allowlist lives in Firestore (platformSettings/pilotAccess).
 */

import {
  firestoreOfficeId,
  officeAuthorizationKey,
  text
} from "./office-id-domain.js";

export const PILOT_ACCESS_DENIED = "PILOT_ACCESS_DENIED";
export const PILOT_FEATURE_DISABLED = "PILOT_FEATURE_DISABLED";

export const PILOT_FEATURE_MESSAGES = Object.freeze({
  matching: "ميزة المطابقة متوقفة مؤقتًا في المرحلة التجريبية.",
  publicOpportunityRouting: "توجيه الفرص العامة متوقف مؤقتًا في المرحلة التجريبية.",
  pushNotifications: "الإشعارات الفورية متوقفة مؤقتًا في المرحلة التجريبية.",
  crossOfficeCollaboration: "التعاون بين المكاتب متوقف مؤقتًا في المرحلة التجريبية."
});

export const DEFAULT_PILOT_REGISTRATION_MESSAGE =
  "التسجيل متاح حاليًا لعدد محدود من المكاتب ضمن المرحلة التجريبية.";

export const DEFAULT_FEATURE_FLAGS = Object.freeze({
  matching: true,
  publicOpportunityRouting: true,
  pushNotifications: true,
  crossOfficeCollaboration: true
});

export function normalizePilotAccessConfig(raw = {}) {
  const enabled = raw.enabled === true;
  const maxOffices = Math.max(1, Math.min(50, Number.parseInt(raw.maxOffices, 10) || 5));
  const authorizedOfficeIds = [...new Set(
    (Array.isArray(raw.authorizedOfficeIds) ? raw.authorizedOfficeIds : [])
      .map(officeAuthorizationKey)
      .filter(Boolean)
  )].slice(0, maxOffices);
  const featureFlags = {
    ...DEFAULT_FEATURE_FLAGS,
    ...(raw.featureFlags && typeof raw.featureFlags === "object" ? raw.featureFlags : {})
  };
  return {
    enabled,
    maxOffices,
    authorizedOfficeIds,
    featureFlags,
    registrationClosedMessage: text(raw.registrationClosedMessage) || DEFAULT_PILOT_REGISTRATION_MESSAGE
  };
}

export function isPilotFeatureEnabled(config, featureKey) {
  const cfg = normalizePilotAccessConfig(config);
  if (!cfg.enabled) return true;
  return cfg.featureFlags[featureKey] !== false;
}

export function evaluatePilotOfficeAccess(config, officeId, { isPlatformAdmin = false } = {}) {
  const cfg = normalizePilotAccessConfig(config);
  const authKey = officeAuthorizationKey(officeId);
  const firestoreId = firestoreOfficeId(officeId);
  if (!cfg.enabled) {
    return { allowed: true, code: "PILOT_DISABLED", officeId: firestoreId, officeAuthorizationKey: authKey };
  }
  if (isPlatformAdmin) {
    return { allowed: true, code: "PLATFORM_ADMIN", officeId: firestoreId, officeAuthorizationKey: authKey };
  }
  if (!authKey || authKey === "platform") {
    return { allowed: true, code: "NON_OFFICE_SCOPE", officeId: firestoreId, officeAuthorizationKey: authKey };
  }
  if (cfg.authorizedOfficeIds.includes(authKey)) {
    return {
      allowed: true,
      code: "PILOT_AUTHORIZED",
      officeId: firestoreId,
      officeAuthorizationKey: authKey,
      pilotAuthorized: true
    };
  }
  return {
    allowed: false,
    code: PILOT_ACCESS_DENIED,
    officeId: firestoreId,
    officeAuthorizationKey: authKey,
    message: "هذا المكتب غير مشمول في المرحلة التجريبية الحالية."
  };
}

export function evaluatePilotRegistration(config, { activeOfficeCount = 0 } = {}) {
  const cfg = normalizePilotAccessConfig(config);
  if (!cfg.enabled) return { allowed: true, code: "PILOT_DISABLED" };
  if (activeOfficeCount >= cfg.maxOffices) {
    return {
      allowed: false,
      code: "PILOT_REGISTRATION_CLOSED",
      message: cfg.registrationClosedMessage
    };
  }
  return { allowed: true, code: "PILOT_REGISTRATION_OPEN" };
}

export function pilotAccessSummary(config) {
  const cfg = normalizePilotAccessConfig(config);
  return {
    enabled: cfg.enabled,
    maxOffices: cfg.maxOffices,
    authorizedCount: cfg.authorizedOfficeIds.length,
    authorizedOfficeIds: cfg.authorizedOfficeIds,
    featureFlags: cfg.featureFlags,
    registrationClosedMessage: cfg.registrationClosedMessage
  };
}
