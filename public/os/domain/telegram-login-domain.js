/**
 * «دخول بتيليجرام» — a broker links his own Telegram to his office alerts from the site, without a
 * one-time link or pressing «Start». Uses Telegram's own sign-in page (oauth.telegram.org), which returns
 * the signed account data in the address after «#tgAuthResult=». The Worker checks the signature with the
 * bot's token (never in the browser) and how fresh it is. The old one-time-link method stays as it was.
 *
 * Needs the site's domain set for the bot once in BotFather («/setdomain»); otherwise Telegram shows
 * «Bot domain invalid» and the broker uses the one-time link instead.
 */

// The sign-in is used right after it happens: a short life, and each signed result once (the Worker keeps its hash).
export const LOGIN_MAX_AGE_SECONDS = 15 * 60;
export const NONCE_KEY = "os.tgLoginNonce";

/** This browser started the sign-in: the nonce it saved is the one Telegram's return address carries. */
export function loginNonceMatches(saved = "", returned = "", now = Date.now(), maxAgeMs = 15 * 60 * 1000) {
  const [nonce, at] = String(saved || "").split("|");
  return /^[A-Za-z0-9]{16,64}$/.test(nonce || "") && nonce === String(returned || "") && now - Number(at || 0) <= maxAgeMs && Number(at || 0) <= now + 60000;
}
const FIELDS = ["id", "first_name", "last_name", "username", "photo_url", "auth_date"];

/** The bot's public numeric id (the part before «:» of its token). Never the token itself. */
export function botIdFromToken(token = "") {
  const m = String(token || "").match(/^(\d{5,20}):/);
  return m ? m[1] : "";
}

export function telegramLoginUrl({ botId = "", origin = "", returnTo = "" } = {}) {
  if (!/^\d{5,20}$/.test(String(botId)) || !/^https:\/\/[^/]+$/.test(String(origin)) || !String(returnTo).startsWith(`${origin}/`)) return "";
  const params = new URLSearchParams({ bot_id: String(botId), origin, request_access: "write", return_to: returnTo });
  return `https://oauth.telegram.org/auth?${params.toString()}`;
}

/** «#tgAuthResult=<base64url JSON>» → the account fields, or null. */
export function parseTgAuthResult(hash = "", decode = (b64) => atob(b64)) {
  const m = String(hash || "").match(/^#?tgAuthResult=([A-Za-z0-9_=+/-]{10,4000})$/);
  if (!m) return null;
  try {
    let b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const raw = decode(b64);
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    return cleanAuth(data);
  } catch {
    return null;
  }
}

/** Only Telegram's own fields, as strings (the signature covers exactly these). */
export function cleanAuth(data = {}) {
  if (!data || typeof data !== "object") return null;
  const out = {};
  for (const key of FIELDS) if (data[key] !== undefined && data[key] !== null && data[key] !== "") out[key] = String(data[key]).slice(0, 300);
  const hash = String(data.hash || "");
  if (!/^\d{1,20}$/.test(out.id || "") || !/^\d{9,12}$/.test(out.auth_date || "") || !/^[a-f0-9]{64}$/.test(hash)) return null;
  return { ...out, hash };
}

/** Telegram's «data-check-string»: key=value lines, sorted, without «hash». */
export function telegramLoginCheckString(auth = {}) {
  return Object.keys(auth).filter((k) => k !== "hash" && FIELDS.includes(k)).sort().map((k) => `${k}=${auth[k]}`).join("\n");
}

export function telegramLoginFresh(auth = {}, now = new Date(), maxAge = LOGIN_MAX_AGE_SECONDS) {
  const at = Number(auth.auth_date || 0);
  const nowSec = Math.floor(now.getTime() / 1000);
  return at > 0 && nowSec - at <= maxAge && at - nowSec <= 300;
}
