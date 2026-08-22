/**
 * A logged-in office broker who submits through their own office public link
 * already sees the form result. They must not also receive the office notice
 * for that same intake. Other office members still receive it.
 */

export const SELF_PUBLIC_INTAKE_STORAGE_KEY = "iaqar:selfPublicIntakeIds";
export const SELF_PUBLIC_INTAKE_LIMIT = 20;

export function normalizePublicIntakeId(value) {
  return String(value || "").trim();
}

export function rememberSelfSubmittedPublicIntake(intakeId, storedIds = []) {
  const id = normalizePublicIntakeId(intakeId);
  const previous = (Array.isArray(storedIds) ? storedIds : [])
    .map(normalizePublicIntakeId)
    .filter(Boolean);
  if (!id) return previous;
  return [id, ...previous.filter(item => item !== id)].slice(0, SELF_PUBLIC_INTAKE_LIMIT);
}

export function isSelfSubmittedPublicIntake(intakeId, storedIds = []) {
  const id = normalizePublicIntakeId(intakeId);
  return Boolean(id) && (Array.isArray(storedIds) ? storedIds : []).includes(id);
}

export function shouldNotifyActorAboutPublicIntake({
  intakeId,
  selfSubmittedIds = []
} = {}) {
  return !isSelfSubmittedPublicIntake(intakeId, selfSubmittedIds);
}

export function readSelfSubmittedPublicIntakeIds(storage) {
  if (!storage || typeof storage.getItem !== "function") return [];
  try {
    const parsed = JSON.parse(storage.getItem(SELF_PUBLIC_INTAKE_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizePublicIntakeId).filter(Boolean) : [];
  } catch (_error) {
    return [];
  }
}

export function persistSelfSubmittedPublicIntake(intakeId, storage) {
  if (!storage || typeof storage.setItem !== "function") return [];
  const next = rememberSelfSubmittedPublicIntake(intakeId, readSelfSubmittedPublicIntakeIds(storage));
  storage.setItem(SELF_PUBLIC_INTAKE_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function createPublicIntakeNotifySession(storage) {
  return {
    remember(intakeId) {
      return persistSelfSubmittedPublicIntake(intakeId, storage);
    },
    shouldNotify(input = {}) {
      return shouldNotifyActorAboutPublicIntake({
        ...input,
        selfSubmittedIds: readSelfSubmittedPublicIntakeIds(storage)
      });
    }
  };
}
