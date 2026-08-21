/**
 * واجهة التعاون مع المكاتب — اختيار متعدد، بحث، ورسائل عربية فقط.
 */

export function normalizeOfficePickId(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function addSelectedOffice(selectedOffices = [], office = {}) {
  const officeId = normalizeOfficePickId(office.officeId);
  if (!officeId) return [...selectedOffices];
  const exists = selectedOffices.some((row) => normalizeOfficePickId(row.officeId) === officeId);
  if (exists) return [...selectedOffices];
  return [...selectedOffices, {
    officeId,
    officeName: String(office.officeName || officeId).trim()
  }];
}

export function removeSelectedOffice(selectedOffices = [], officeId = "") {
  const target = normalizeOfficePickId(officeId);
  return selectedOffices.filter((row) => normalizeOfficePickId(row.officeId) !== target);
}

export function uniqueSelectedOfficeIds(selectedOffices = []) {
  const seen = new Set();
  const ids = [];
  for (const row of selectedOffices) {
    const id = normalizeOfficePickId(row.officeId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function filterOfficesForCooperationSearch({
  offices = [],
  query = "",
  ownOfficeId = "",
  selectedOfficeIds = [],
  limit = 12
} = {}) {
  const own = normalizeOfficePickId(ownOfficeId);
  const selected = new Set((selectedOfficeIds || []).map(normalizeOfficePickId));
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) return [];
  const pool = offices.filter((office) => {
    const id = normalizeOfficePickId(office.officeId);
    if (!id || id === own || selected.has(id)) return false;
    return true;
  });
  const hay = normalizedQuery
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
  return pool
    .filter((office) => {
      const text = [
        office.officeName,
        office.primaryNeighborhoodLabel,
        office.city
      ].filter(Boolean).join(" ").toLowerCase();
      return text.includes(hay);
    })
    .slice(0, limit);
}

export function cooperationSendSuccessMessage(count = 0) {
  const total = Number(count || 0);
  if (total <= 0) return "";
  if (total === 1) return "تم إرسال الفرصة إلى المكتب.";
  return `تم إرسال الفرصة إلى ${total} مكاتب.`;
}

export function currentCooperationShareStatusLabel(status = "") {
  const key = String(status || "").toUpperCase();
  if (key === "PENDING" || key === "PENDING_APPROVAL" || key === "SENT") return "تم الإرسال";
  if (key === "ACCEPTED" || key === "ACTIVE") return "قَبِل المكتب";
  if (key === "REJECTED") return "اعتذر المكتب";
  if (key === "REVOKED" || key === "ENDED" || key === "CANCELLED") return "انتهى التعاون";
  return "تم الإرسال";
}

export const COOPERATION_SHARE_BLOCKED_KEYS = Object.freeze([
  "ownerName",
  "ownerPhone",
  "ownerMobile",
  "clientName",
  "clientPhone",
  "clientMobile",
  "contactName",
  "contactPhone",
  "whatsapp",
  "email",
  "advertiserPhoneNormalized",
  "advertiserPhoneRaw",
  "phone",
  "mobile",
  "nationalId"
]);

export function assertSafeCooperationSharePayload(payload = {}) {
  const blocked = [];
  for (const key of COOPERATION_SHARE_BLOCKED_KEYS) {
    const value = payload[key];
    if (value != null && String(value).trim() !== "") blocked.push(key);
  }
  return { ok: blocked.length === 0, blocked };
}
