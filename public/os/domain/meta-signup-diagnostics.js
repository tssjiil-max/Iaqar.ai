/** Public configuration is not proof of Meta permissions or number eligibility. */
export function signupConfiguration(config = {}) {
  if (!/^[0-9]{1,32}$/.test(String(config.appId || ""))) return { valid: false, code: "INVALID_APP_ID", message: "معرّف تطبيق Meta مفقود أو غير صالح؛ راجع إعداد App ID." };
  if (!/^[0-9]{1,32}$/.test(String(config.configId || ""))) return { valid: false, code: "INVALID_CONFIG_ID", message: "معرّف إعداد التسجيل مفقود أو غير صالح؛ راجع Configuration ID داخل التطبيق نفسه." };
  if (config.enabled !== true) return { valid: false, code: "EMBEDDED_SIGNUP_MISCONFIGURED", message: "إعداد الربط الرسمي غير مكتمل على هذه البيئة." };
  return { valid: true, code: "", message: "", coexistenceStatus: "UNVERIFIED" };
}

/** Allowlist numeric diagnostics only. Meta text can contain OAuth credentials. */
export function safeMetaFailure(raw = {}) {
  const number = value => /^\d{1,10}$/.test(String(value ?? "")) ? Number(value) : null;
  const metaCode = number(raw?.code ?? raw?.error_code);
  const metaSubcode = number(raw?.error_subcode);
  const code = [10, 200].includes(metaCode) ? "APP_PERMISSION_DENIED" : metaCode === 191 ? "DOMAIN_NOT_ALLOWED" : "UNKNOWN_META_ERROR";
  const text = code === "APP_PERMISSION_DENIED" ? "Meta رفضت الصلاحيات؛ راجع صلاحيات التطبيق والحساب في لوحة Meta."
    : code === "DOMAIN_NOT_ALLOWED" ? "Meta رفضت نطاق الموقع؛ راجع النطاقات المسموحة وإعدادات OAuth."
      : "تعذر إكمال التسجيل لدى Meta؛ يلزم فحص إعداد التسجيل ووضع التطبيق وصلاحية الحساب.";
  const error = Object.assign(new Error(`${text} (${code}${metaCode !== null ? `; Meta ${metaCode}` : ""})`), { code, metaCode, metaSubcode });
  return error;
}
