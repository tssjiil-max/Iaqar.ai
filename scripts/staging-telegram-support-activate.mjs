#!/usr/bin/env node
/**
 * Staging only — turns on the PLATFORM SUPPORT assistant (Telegram Business).
 *
 * This is a SECOND bot, separate from the central intake bot (@iaqar_intake_bot): its own token
 * (TELEGRAM_SUPPORT_BOT_TOKEN), its own secret and its own address (<worker>/telegram/support/webhook).
 * Nothing here reads or changes the intake bot or its webhook.
 *
 *   prepare <dir>   checks the support bot token with Telegram (getMe), and writes two private files
 *                   for `wrangler secret put`: TELEGRAM_SUPPORT_BOT_TOKEN, TELEGRAM_SUPPORT_WEBHOOK_SECRET.
 *                   Warns when the bot's Business Mode is off (BotFather → Bot Settings → Business Mode).
 *   register        points the support bot at the Staging Worker and checks the chain.
 *
 * Linking the bot to the business account is the account owner's step in Telegram
 * (Settings → Telegram Business → Chatbots); it cannot be done from here. No secret is printed.
 */
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { STAGING_WORKER_NAME, cleanToken, redact } from "./staging-telegram-activate.mjs";

export const SUPPORT_WEBHOOK_PATH = "/telegram/support/webhook";
export const SUPPORT_ALLOWED_UPDATES = Object.freeze(["message", "callback_query", "business_connection", "business_message", "edited_business_message"]);
const SECRET_SHAPE = /^[A-Za-z0-9_-]{16,256}$/;

export function supportSecretFor(token, explicit = "") {
  const given = String(explicit || "").trim();
  if (given) {
    if (!SECRET_SHAPE.test(given)) throw new Error("TELEGRAM_SUPPORT_WEBHOOK_SECRET must be 16–256 characters of A–Z a–z 0–9 _ -");
    return given;
  }
  return createHmac("sha256", token).update("iaqar-staging-telegram-support-webhook-v1").digest("hex");
}

export function stagingSupportWebhookUrl(workerUrl) {
  let url;
  try { url = new URL(String(workerUrl || "")); } catch { throw new Error("STAGING_WORKER_URL is not a URL"); }
  if (url.protocol !== "https:" || !url.hostname.startsWith(`${STAGING_WORKER_NAME}.`) || !url.hostname.endsWith(".workers.dev")) {
    throw new Error(`refusing: ${url.hostname} is not the Staging Worker (${STAGING_WORKER_NAME})`);
  }
  return `${url.origin}${SUPPORT_WEBHOOK_PATH}`;
}

async function telegram(fetchImpl, token, method, payload) {
  let response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload || {}) });
  } catch (error) {
    throw new Error(`Telegram ${method} could not be reached: ${redact(error?.message, token)}`);
  }
  const body = await response.json().catch(() => null);
  if (!body || body.ok !== true) throw new Error(`Telegram ${method} refused (HTTP ${response.status}): ${redact(body?.description || "no description", token)}`);
  return body.result;
}

export async function prepare({ env = process.env, dir, fetchImpl = fetch, log = console.log }) {
  const token = cleanToken(env.TELEGRAM_SUPPORT_BOT_TOKEN);
  if (!token) throw new Error("TELEGRAM_SUPPORT_BOT_TOKEN is missing or is not a bot token");
  // The two bots must differ: the intake bot's webhook is never moved by this script.
  if (cleanToken(env.TELEGRAM_BOT_TOKEN) && cleanToken(env.TELEGRAM_BOT_TOKEN).split(":")[0] === token.split(":")[0]) {
    throw new Error("the support bot must be a different bot from the intake bot");
  }
  const secret = supportSecretFor(token, env.TELEGRAM_SUPPORT_WEBHOOK_SECRET);
  const me = await telegram(fetchImpl, token, "getMe");
  if (me?.is_bot !== true || !me.username) throw new Error("the token does not belong to a bot with a username");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, "TELEGRAM_SUPPORT_BOT_TOKEN"), token, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, "TELEGRAM_SUPPORT_WEBHOOK_SECRET"), secret, { mode: 0o600 });
  log(`Support bot verified: @${me.username} (values not printed)`);
  const businessMode = me.can_connect_to_business === true;
  if (!businessMode) log("NOTE: Business Mode is OFF for this bot — turn it on in @BotFather (Bot Settings → Business Mode) before linking it to the business account.");
  return { username: String(me.username), businessMode };
}

export async function register({ env = process.env, fetchImpl = fetch, log = console.log, attempts = 8, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const token = cleanToken(env.TELEGRAM_SUPPORT_BOT_TOKEN);
  if (!token) throw new Error("TELEGRAM_SUPPORT_BOT_TOKEN is missing or is not a bot token");
  const secret = supportSecretFor(token, env.TELEGRAM_SUPPORT_WEBHOOK_SECRET);
  const url = stagingSupportWebhookUrl(env.STAGING_WORKER_URL);
  await telegram(fetchImpl, token, "setWebhook", { url, secret_token: secret, allowed_updates: SUPPORT_ALLOWED_UPDATES });
  const info = await telegram(fetchImpl, token, "getWebhookInfo");
  if (String(info?.url || "") !== url) throw new Error("Telegram did not keep the Staging support address");
  const call = (headers) => fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ update_id: 0 }) });
  let problem = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt) await wait(5000);
    const unsigned = await call({});
    if (unsigned.status !== 401) { problem = `the Worker must refuse an unsigned call with 401 (got ${unsigned.status})`; continue; }
    const signed = await call({ "x-telegram-bot-api-secret-token": secret });
    const answer = await signed.json().catch(() => ({}));
    if (signed.status === 200 && answer.ignored === true && answer.reason === "unsupported_update") { problem = ""; break; }
    problem = `the Worker did not accept a signed call as expected (HTTP ${signed.status}, ${String(answer.error || answer.reason || "no reason")})`;
  }
  if (problem) throw new Error(problem);
  log(`Support webhook → ${url}`);
  return { url };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const [mode, arg] = process.argv.slice(2);
  try {
    if (mode === "prepare" && arg) await prepare({ dir: arg });
    else if (mode === "register") await register({});
    else { console.error("usage: staging-telegram-support-activate.mjs prepare <dir> | register"); process.exit(2); }
  } catch (error) {
    console.error(`staging-telegram-support-activate: ${redact(error?.message, cleanToken(process.env.TELEGRAM_SUPPORT_BOT_TOKEN))}`);
    process.exit(1);
  }
}
