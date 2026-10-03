/** Pre-login flows against the existing Worker routes (no new server logic): password reset and broker application. */

import { ApiError, api, auth, workerBase } from "./runtime.js";
import { PHONE_ERROR, mapApplyError, mapAuthError, validateBrokerApplication } from "../domain/auth-flows-domain.js";
import { localPhone } from "../domain/format-domain.js";

/** Always answers generically (the Worker never reveals whether a number exists). Returns the payload. */
export async function requestPasswordReset(phoneRaw) {
  const phone = localPhone(phoneRaw);
  if (!phone) throw new ApiError(PHONE_ERROR);
  let response;
  try {
    response = await fetch(`${workerBase()}/auth/forgot-password`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, apiKey: auth().app.options.apiKey })
    });
  } catch (_) {
    throw new ApiError("تعذر الاتصال بالخادم — حاول بعد قليل");
  }
  if (!response.ok) throw new ApiError("تعذر إرسال رابط الاسترجاع الآن. حاول بعد قليل.");
  return response.json().catch(() => ({}));
}

/**
 * Creates the login account, sends the application (the platform admin approves it), and signs out.
 * On any failure the just-created account is removed again so the person can retry.
 * Throws { field, message } shaped ApiError (details.field) so the screen can mark the field.
 */
export async function submitBrokerApplication(raw) {
  const checked = validateBrokerApplication(raw);
  if (!checked.ok) throw new ApiError("راجع الحقول المظللة", { details: { errors: checked.errors } });
  let created = null;
  const fail = async (field, message) => {
    if (created) { try { await created.delete(); } catch (_) { /* best effort */ } }
    await auth().signOut().catch(() => {});
    throw new ApiError(message, { details: { errors: field ? { [field]: message } : {} } });
  };
  try {
    const credential = await auth().createUserWithEmailAndPassword(checked.value.email, checked.password);
    created = credential.user;
  } catch (error) {
    const mapped = mapAuthError(error?.code);
    throw new ApiError(mapped.message, { details: { errors: mapped.field ? { [mapped.field]: mapped.message } : {} } });
  }
  try {
    await api("/broker/apply", checked.value);
  } catch (error) {
    const mapped = mapApplyError({ code: error.code, message: error.message });
    await fail(mapped.field, mapped.message);
  }
  await auth().signOut().catch(() => {});
  return true;
}
