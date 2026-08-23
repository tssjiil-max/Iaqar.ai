/**
 * Content-area reset flag. Default ON.
 * Escape hatch: ?legacyContent=1 or localStorage iaqar.legacyContent=1
 * Does not change auth, matching, voice, or Firebase.
 */

export const CONTENT_RESET_FLAG = "iaqar.contentResetV2";
export const LEGACY_CONTENT_FLAG = "iaqar.legacyContent";

export function isContentResetEnabled(locationLike = globalThis.location, storage = globalThis.localStorage) {
  try {
    const params = new URLSearchParams(locationLike?.search || "");
    if (params.get("legacyContent") === "1" || params.get("legacyContent") === "true") return false;
    if (params.get("contentV2") === "0" || params.get("contentV2") === "false") return false;
    if (storage?.getItem?.(LEGACY_CONTENT_FLAG) === "1") return false;
    if (params.get("contentV2") === "1" || params.get("contentV2") === "true") return true;
    if (storage?.getItem?.(CONTENT_RESET_FLAG) === "0") return false;
    return true;
  } catch {
    return true;
  }
}
