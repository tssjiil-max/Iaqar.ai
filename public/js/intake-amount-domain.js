/** Shared strict money boundary for legacy intake, current Office OS forms and the Worker. */
const MONEY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** Read a positive amount with at most two decimal places, or refuse it without guessing. */
export function parseIntakeAmount(raw) {
  if (typeof raw === "number" && !Number.isFinite(raw)) return null;
  let text = String(raw ?? "")
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776)).trim();
  const currency = "(?:ريال|ر\\.?\\s?س|SAR|SR)";
  const prefix = new RegExp("^" + currency + "(?=\\s|[0-9٠-٩۰-۹])", "i");
  const suffix = new RegExp(currency + "$", "i");
  if (prefix.test(text)) text = text.replace(prefix, "").trim();
  else if (suffix.test(text)) text = text.replace(suffix, "").trim();
  if (new RegExp(currency, "i").test(text)) return null;
  text = text.replace(/٫/g, ".").replace(/[٬،]/g, ",").replace(/[\s\u00a0]/g, "");
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text.replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 && value < 1e12 ? value : null;
}

/** Format only valid money; callers keep invalid input unchanged so validation can reject it. */
export function formatMoneyAmount(raw) {
  const amount = parseIntakeAmount(raw);
  return amount === null ? "" : MONEY.format(amount);
}
