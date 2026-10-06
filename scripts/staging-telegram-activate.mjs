#!/usr/bin/env node
/**
 * Staging only — turns on the platform's Telegram bot for «قنوات المكتب».
 *
 *   prepare <dir>   checks the bot token with Telegram (getMe) and writes three private files
 *                   for `wrangler secret put`: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET,
 *                   TELEGRAM_BOT_USERNAME.
 *   register        points the bot at the Staging Worker's central address
 *                   (<worker>/telegram/webhook) and checks that Telegram and the Worker agree.
 *
 * The bot only receives: nothing here sends a message to anyone. No secret value is ever
 * printed — only the bot's public username and the webhook's address.
 * A bot has ONE webhook: registering it here moves it away from wherever it pointed before.
 */
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const STAGING_WORKER_NAME = "iaqar-intake-staging";
export const WEBHOOK_PATH = "/telegram/webhook";
// «callback_query» = a side pressing the bot's «مناسب / غير مناسب» buttons.
export const ALLOWED_UPDATES = Object.freeze(["message", "edited_message", "channel_post", "callback_query"]);
const TOKEN_SHAPE = /^\d{5,20}:[A-Za-z0-9_-]{30,80}$/;
const SECRET_SHAPE = /^[A-Za-z0-9_-]{16,256}$/;
const USERNAME_SHAPE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

export function cleanToken(value) {
  const token = String(value || "").replace(/\s+/g, "");
  return TOKEN_SHAPE.test(token) ? token : "";
}

/**
 * The webhook secret Telegram sends back with every update. Taken from TELEGRAM_WEBHOOK_SECRET
 * when one is given; otherwise derived from the bot token, so it is stable across deploys and
 * cannot be guessed without the token.
 */
export function webhookSecretFor(token, explicit = "") {
  const given = String(explicit || "").trim();
  if (given) {
    if (!SECRET_SHAPE.test(given)) throw new Error("TELEGRAM_WEBHOOK_SECRET must be 16–256 characters of A–Z a–z 0–9 _ -");
    return given;
  }
  return createHmac("sha256", token).update("iaqar-staging-telegram-webhook-v1").digest("hex");
}

/** Only the Staging Worker may be the bot's address from this script. */
export function stagingWebhookUrl(workerUrl) {
  let url;
  try { url = new URL(String(workerUrl || "")); } catch { throw new Error("STAGING_WORKER_URL is not a URL"); }
  if (url.protocol !== "https:" || !url.hostname.startsWith(`${STAGING_WORKER_NAME}.`) || !url.hostname.endsWith(".workers.dev")) {
    throw new Error(`refusing: ${url.hostname} is not the Staging Worker (${STAGING_WORKER_NAME})`);
  }
  return `${url.origin}${WEBHOOK_PATH}`;
}

/** Never let a token reach a log line (Telegram addresses carry it). */
export function redact(message, token) {
  let out = String(message || "");
  if (token) out = out.split(token).join("<token>");
  return out.replace(/bot\d{5,20}:[A-Za-z0-9_-]{20,}/g, "bot<token>");
}

async function telegram(fetchImpl, token, method, payload) {
  let response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload || {})
    });
  } catch (error) {
    throw new Error(`Telegram ${method} could not be reached: ${redact(error?.message, token)}`);
  }
  const body = await response.json().catch(() => null);
  if (!body || body.ok !== true) throw new Error(`Telegram ${method} refused (HTTP ${response.status}): ${redact(body?.description || "no description", token)}`);
  return body.result;
}

/** getMe → the bot's public username (proves the token is a live bot's). */
export async function botIdentity({ token, fetchImpl = fetch }) {
  const me = await telegram(fetchImpl, token, "getMe");
  const username = String(me?.username || "");
  if (me?.is_bot !== true || !USERNAME_SHAPE.test(username)) throw new Error("the token does not belong to a bot with a username");
  return { username, id: String(me.id || "") };
}

export async function prepare({ env = process.env, dir, fetchImpl = fetch, log = console.log }) {
  const token = cleanToken(env.TELEGRAM_BOT_TOKEN);
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is missing or is not a bot token");
  const secret = webhookSecretFor(token, env.TELEGRAM_WEBHOOK_SECRET);
  const { username } = await botIdentity({ token, fetchImpl });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const [name, value] of [["TELEGRAM_BOT_TOKEN", token], ["TELEGRAM_WEBHOOK_SECRET", secret], ["TELEGRAM_BOT_USERNAME", username]]) {
    fs.writeFileSync(path.join(dir, name), value, { mode: 0o600 });
  }
  log(`Telegram bot verified: @${username} (values not printed)`);
  return { username };
}

/**
 * Point the bot at Staging and prove the whole chain:
 *   Telegram reports the Staging address · the Worker refuses a call without the secret ·
 *   the Worker accepts a call with it (an unlinked chat is ignored, nothing is stored).
 */
export async function register({ env = process.env, fetchImpl = fetch, log = console.log, attempts = 8, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const token = cleanToken(env.TELEGRAM_BOT_TOKEN);
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is missing or is not a bot token");
  const secret = webhookSecretFor(token, env.TELEGRAM_WEBHOOK_SECRET);
  const url = stagingWebhookUrl(env.STAGING_WORKER_URL);

  const before = await telegram(fetchImpl, token, "getWebhookInfo");
  const previous = String(before?.url || "");
  if (previous && previous !== url) {
    let host = "another address";
    try { host = new URL(previous).hostname; } catch { /* keep the generic wording */ }
    log(`NOTE: the bot pointed at ${host}; it is moved to Staging now.`);
  }
  await telegram(fetchImpl, token, "setWebhook", { url, secret_token: secret, allowed_updates: ALLOWED_UPDATES });
  const info = await telegram(fetchImpl, token, "getWebhookInfo");
  if (String(info?.url || "") !== url) throw new Error("Telegram did not keep the Staging address");

  const call = (headers) => fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ update_id: 0, message: { message_id: 0, chat: { id: 1, type: "private" }, text: "iaqar staging wiring check" } }) });
  // A secret just written to the Worker takes a few moments to be live everywhere.
  let problem = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt) await wait(5000);
    const unsigned = await call({});
    if (unsigned.status !== 401) { problem = `the Worker must refuse an unsigned call with 401 (got ${unsigned.status}) — its webhook secret is not in place`; continue; }
    const signed = await call({ "x-telegram-bot-api-secret-token": secret });
    const answer = await signed.json().catch(() => ({}));
    if (signed.status === 200 && answer.ignored === true && answer.reason === "chat_not_linked") { problem = ""; break; }
    problem = `the Worker did not accept a signed call as expected (HTTP ${signed.status}, ${String(answer.error || answer.reason || "no reason")})`;
  }
  if (problem) throw new Error(problem);
  log(`Telegram webhook → ${url} (pending updates: ${Number(info.pending_update_count || 0)})`);
  if (info.last_error_message) log(`NOTE: Telegram's last delivery error (may predate this deploy): ${redact(info.last_error_message, token)}`);
  return { url, pending: Number(info.pending_update_count || 0) };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const [mode, arg] = process.argv.slice(2);
  try {
    if (mode === "prepare" && arg) await prepare({ dir: arg });
    else if (mode === "register") await register({});
    else { console.error("usage: staging-telegram-activate.mjs prepare <dir> | register"); process.exit(2); }
  } catch (error) {
    console.error(`staging-telegram-activate: ${redact(error?.message, cleanToken(process.env.TELEGRAM_BOT_TOKEN))}`);
    process.exit(1);
  }
}
