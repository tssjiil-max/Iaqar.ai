/**
 * Push links built by the service worker carry only `openDailyTask=<operation id>` (the Worker
 * adds `openOperation` too). Both name the same task, so either one opens it.
 * (Old-app-only links are forwarded to /legacy.html by the inline script in index.html.)
 */
export function operationIdFromParams(params) {
  return String(params.get("openOperation") || params.get("openDailyTask") || "");
}
