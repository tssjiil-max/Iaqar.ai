function normalizedEmailDomain(value) {
  const email = String(value || "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return "";
  return email.slice(at + 1).replace(/\.+$/, "");
}

export function isReservedInvalidEmail(value) {
  const domain = normalizedEmailDomain(value);
  return Boolean(domain) && (domain === "invalid" || domain.endsWith(".invalid"));
}

export function sanitizePasswordResetResponse(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const maskedEmail = String(payload.maskedEmail || "").trim();
  if (!maskedEmail || !isReservedInvalidEmail(maskedEmail)) return payload;
  const { maskedEmail: _maskedEmail, ...safePayload } = payload;
  return safePayload;
}
