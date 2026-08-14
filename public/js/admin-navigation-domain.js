/**
 * Canonical admin console back navigation — pure logic (no DOM).
 */

export const ADMIN_VIEWS = Object.freeze([
  "overview",
  "applications",
  "offices",
  "activity",
  "billing",
  "audit"
]);

/**
 * @typedef {{ view: string, officeId?: string, applicationId?: string }} AdminNavFrame
 */

/**
 * @param {string} view
 * @param {{ officeId?: string, applicationId?: string }} [extras]
 * @returns {AdminNavFrame}
 */
export function createAdminFrame(view, extras = {}) {
  return {
    view: String(view || "overview"),
    officeId: extras.officeId || "",
    applicationId: extras.applicationId || ""
  };
}

/**
 * @param {AdminNavFrame[]} stack
 * @param {AdminNavFrame} frame
 * @returns {AdminNavFrame[]}
 */
export function pushAdminFrame(stack = [], frame) {
  const next = Array.isArray(stack) ? [...stack] : [];
  next.push(frame);
  return next;
}

/**
 * @param {AdminNavFrame[]} stack
 * @returns {{ stack: AdminNavFrame[], frame: AdminNavFrame|null }}
 */
export function popAdminFrame(stack = []) {
  const current = Array.isArray(stack) ? [...stack] : [];
  if (current.length <= 1) return { stack: current, frame: null };
  current.pop();
  return { stack: current, frame: current[current.length - 1] || null };
}

/**
 * Resolve the next back action for the admin console.
 *
 * @param {AdminNavFrame[]} stack
 * @returns {{ type: "pop-frame" }|null}
 */
export function resolveAdminBackAction(stack = []) {
  if (!Array.isArray(stack) || stack.length <= 1) return null;
  return { type: "pop-frame" };
}

export function shouldShowAdminBack(stack = []) {
  return resolveAdminBackAction(stack) != null;
}

export function currentAdminFrame(stack = []) {
  if (!Array.isArray(stack) || !stack.length) return createAdminFrame("overview");
  return stack[stack.length - 1];
}
