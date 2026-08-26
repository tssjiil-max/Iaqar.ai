/**
 * Office ID semantics — pure domain, no I/O.
 *
 * firestoreOfficeId: exact case preserved; use for Firestore document paths only.
 * officeAuthorizationKey: normalized; use for pilot allowlist / authorization comparison only.
 */

export function text(value) {
  return String(value == null ? "" : value).trim();
}

export function firestoreOfficeId(value) {
  return text(value)
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function officeAuthorizationKey(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function officeIdsEquivalent(left, right) {
  const a = officeAuthorizationKey(left);
  const b = officeAuthorizationKey(right);
  return Boolean(a) && a === b;
}
