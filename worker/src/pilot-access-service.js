/**
 * Production pilot access — Worker persistence + enforcement.
 * Reads platform/settings/pilotAccess from Firestore. Never hardcodes office IDs in UI.
 */

import {
  DEFAULT_PILOT_REGISTRATION_MESSAGE,
  evaluatePilotOfficeAccess,
  evaluatePilotRegistration,
  normalizePilotAccessConfig,
  pilotAccessSummary
} from "../../public/js/pilot-access-domain.js";

const SETTINGS_DOC_SEGMENTS = Object.freeze(["platform", "settings", "pilotAccess"]);
const CACHE_TTL_MS = 30_000;

let cachedConfig = { expiresAt: 0, config: null };

function text(value) {
  return String(value == null ? "" : value).trim();
}

function logPilot(event, payload = {}) {
  console.log(JSON.stringify({
    event,
    subsystem: "pilotAccess",
    at: new Date().toISOString(),
    ...payload
  }));
}

function parseFeatureFlags(raw) {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" ? raw : {};
}

function parseOfficeIds(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return raw.split(",").map(text).filter(Boolean);
    }
  }
  return [];
}

export function pilotConfigFromFirestoreFields(fields = {}) {
  return normalizePilotAccessConfig({
    enabled: fields.enabled === true || fields.enabled === "true",
    maxOffices: fields.maxOffices,
    authorizedOfficeIds: parseOfficeIds(fields.authorizedOfficeIds),
    featureFlags: parseFeatureFlags(fields.featureFlagsJson || fields.featureFlags),
    registrationClosedMessage: fields.registrationClosedMessage || DEFAULT_PILOT_REGISTRATION_MESSAGE
  });
}

export async function loadPilotAccessConfig(deps) {
  const now = Date.now();
  if (cachedConfig.config && cachedConfig.expiresAt > now) {
    return cachedConfig.config;
  }
  try {
    const doc = await deps.getFirestoreDocument({
      projectId: deps.projectId,
      segments: SETTINGS_DOC_SEGMENTS,
      accessToken: deps.accessToken,
      allowMissing: true
    });
    const config = doc
      ? pilotConfigFromFirestoreFields(deps.firestoreFieldsToJs(doc.fields || {}))
      : normalizePilotAccessConfig({ enabled: false });
    cachedConfig = { expiresAt: now + CACHE_TTL_MS, config };
    return config;
  } catch (error) {
    logPilot("pilot.config.load_failed", { reason: text(error?.message || error) });
    return normalizePilotAccessConfig({ enabled: false });
  }
}

export function invalidatePilotAccessCache() {
  cachedConfig = { expiresAt: 0, config: null };
}

export async function countActivePilotOffices(deps) {
  const docs = await deps.listCollectionDocuments({
    projectId: deps.projectId,
    segments: ["offices"],
    accessToken: deps.accessToken,
    pageSize: 300
  });
  let count = 0;
  for (const doc of docs) {
    const row = deps.firestoreFieldsToJs(doc.fields || {});
    const officeId = text(row.officeId || doc.name?.split("/").pop());
    if (!officeId || officeId === "platform") continue;
    const status = text(row.accountStatus || row.approvalStatus).toLowerCase();
    if (status === "active" || status === "approved") count += 1;
  }
  return count;
}

export async function assertPilotOfficeAccess(deps, { officeId, isPlatformAdmin = false } = {}) {
  const config = await loadPilotAccessConfig(deps);
  const decision = evaluatePilotOfficeAccess(config, officeId, { isPlatformAdmin });
  if (!decision.allowed) {
    logPilot("security.denied", { officeId: decision.officeId, code: decision.code });
    const error = new Error(decision.message || "Pilot access denied");
    error.code = decision.code;
    error.status = 403;
    throw error;
  }
  return { config, decision };
}

export async function assertPilotRegistrationAllowed(deps) {
  const config = await loadPilotAccessConfig(deps);
  const activeOfficeCount = await countActivePilotOffices(deps);
  const decision = evaluatePilotRegistration(config, { activeOfficeCount });
  if (!decision.allowed) {
    logPilot("pilot.registration.denied", { activeOfficeCount, code: decision.code });
    const error = new Error(decision.message || DEFAULT_PILOT_REGISTRATION_MESSAGE);
    error.code = decision.code;
    error.status = 403;
    throw error;
  }
  return { config, decision, activeOfficeCount };
}

export async function getPilotAccessStatus(deps, { officeId = "", isPlatformAdmin = false } = {}) {
  const config = await loadPilotAccessConfig(deps);
  const activeOfficeCount = await countActivePilotOffices(deps);
  const officeDecision = officeId
    ? evaluatePilotOfficeAccess(config, officeId, { isPlatformAdmin })
    : null;
  const registrationDecision = evaluatePilotRegistration(config, { activeOfficeCount });
  return {
    ...pilotAccessSummary(config),
    activeOfficeCount,
    officeAccess: officeDecision,
    registration: registrationDecision
  };
}

export function isPilotFeatureEnabledSync(config, featureKey) {
  return normalizePilotAccessConfig(config).featureFlags[featureKey] !== false;
}
