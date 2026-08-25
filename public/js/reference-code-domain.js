/**
 * Short stable opportunity / cooperation references for broker UI.
 * Never render the long Firebase document id.
 */

function digitsFrom(id = "") {
  const raw = String(id || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  if (digits.length >= 3) return digits.padStart(4, "0");
  if (raw.length <= 8 && raw) return raw.replace(/[^A-Za-z0-9]/g, "").slice(-4);
  if (!raw) return "";
  return raw.replace(/[^A-Za-z0-9]/g, "").slice(-4);
}

export function formatShortReferenceNumber(id = "") {
  return digitsFrom(id);
}

export function formatOpportunityReference(id = "") {
  const num = digitsFrom(id);
  return num ? `#A-${num}` : "";
}

export function formatCooperationReference(id = "") {
  const num = digitsFrom(id);
  return num ? `#C-${num}` : "";
}

export function formatMatchReference(opportunityId = "", matchId = "") {
  return formatOpportunityReference(opportunityId || matchId);
}
