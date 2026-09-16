import core from "./index.js";
import { sanitizePasswordResetResponse } from "./password-recovery-guard.js";

async function fetchWithPasswordRecoveryGuard(request, env, executionContext) {
  const url = new URL(request.url);
  const response = await core.fetch(request, env, executionContext);

  if (request.method !== "POST" || url.pathname !== "/auth/forgot-password") {
    return response;
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return response;

  let payload;
  try {
    payload = await response.clone().json();
  } catch (_) {
    return response;
  }

  const safePayload = sanitizePasswordResetResponse(payload);
  if (safePayload === payload) return response;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(safePayload), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  ...core,
  fetch: fetchWithPasswordRecoveryGuard
};
