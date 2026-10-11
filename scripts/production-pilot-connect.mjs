#!/usr/bin/env node
/**
 * Production channels — connect what the owner approved, each part only when its credential is present:
 *   telegram  the central bot (@iaqar_intake_bot) → https://<production Worker>/telegram/webhook (one address for
 *             every office; the linked chat decides the office), with the shared secret; then proves the chain.
 *   meta      the Meta app's WhatsApp webhook → https://<production Worker>/meta/webhook (Meta verifies it with
 *             the verify token the production Worker holds).
 * Prints hosts/paths and results only — never a token.   env: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET,
 * META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN, META_APP_ID (optional)
 */
const WORKER = "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
const out = (title, text) => console.log(process.env.GITHUB_ACTIONS ? `::notice title=${title}::${text}` : `${title}: ${text}`);
const err = (title, text) => { console.log(process.env.GITHUB_ACTIONS ? `::error title=${title}::${text}` : `ERROR ${title}: ${text}`); process.exitCode = 1; };
const where = (url) => { try { const u = new URL(url); return `${u.host}${u.pathname}`; } catch { return url ? "(not a URL)" : "(none)"; } };
const ALLOWED_UPDATES = ["message", "edited_message", "channel_post", "callback_query"];

// ------------------------------------------------------------------ Telegram
const token = String(process.env.TELEGRAM_BOT_TOKEN || "").replace(/\s+/g, "");
const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
if (!token) out("Telegram", "skipped — TELEGRAM_BOT_TOKEN_PRODUCTION is not set");
else if (!secret) err("Telegram", "no webhook secret");
else {
  const tg = async (method, payload) => (await (await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload || {}), signal: AbortSignal.timeout(20_000) })).json().catch(() => ({})));
  const me = await tg("getMe");
  if (!me.ok) err("Telegram", "the token was refused by Telegram");
  else {
    const before = await tg("getWebhookInfo");
    out("Telegram webhook before", `@${me.result.username} → ${where(before.result?.url)}`);
    const url = `${WORKER}/telegram/webhook`;
    const set = await tg("setWebhook", { url, secret_token: secret, allowed_updates: ALLOWED_UPDATES });
    if (!set.ok) err("Telegram setWebhook", String(set.description || "refused").slice(0, 160));
    else {
      // Proof: unsigned → 401; signed → accepted and ignored (an unknown chat stores nothing).
      const call = (headers) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ update_id: 0, message: { message_id: 0, chat: { id: 1, type: "private" }, text: "iaqar production wiring check" } }) });
      let ok = false;
      for (let i = 0; i < 8 && !ok; i += 1) {
        if (i) await new Promise((r) => setTimeout(r, 5000));
        const unsigned = await call({});
        const signed = await call({ "x-telegram-bot-api-secret-token": secret });
        const body = await signed.json().catch(() => ({}));
        ok = unsigned.status === 401 && signed.status === 200 && body.ignored === true;
      }
      const after = await tg("getWebhookInfo");
      if (ok && after.result?.url === url) out("Telegram connected", `@${me.result.username} → ${where(url)} · the Worker refuses unsigned calls and accepts Telegram's`);
      else err("Telegram", `webhook set, but the Worker check did not pass (now → ${where(after.result?.url)})`);
    }
  }
}

// ------------------------------------------------------------------ WhatsApp (Meta app webhook)
const appId = String(process.env.META_APP_ID || "1315826203671419");
const appSecret = String(process.env.META_APP_SECRET || "").trim();
const verify = String(process.env.META_WEBHOOK_VERIFY_TOKEN || "").trim();
if (!appSecret || !verify) out("WhatsApp", "skipped — Meta app secret / verify token not available");
else {
  const appToken = `${appId}|${appSecret}`;
  const graph = `https://graph.facebook.com/v25.0/${appId}/subscriptions`;
  const before = await (await fetch(`${graph}?access_token=${encodeURIComponent(appToken)}`)).json().catch(() => ({}));
  const current = (before.data || []).find((s) => s.object === "whatsapp_business_account");
  out("WhatsApp webhook before", where(current?.callback_url));
  const fields = (current?.fields || []).map((f) => f.name || f).filter(Boolean);
  const body = new URLSearchParams({ object: "whatsapp_business_account", callback_url: `${WORKER}/meta/webhook`, verify_token: verify, fields: (fields.length ? fields : ["messages", "account_update", "message_template_status_update"]).join(","), include_values: "true", access_token: appToken });
  const r = await fetch(graph, { method: "POST", body, signal: AbortSignal.timeout(30_000) });
  const res = await r.json().catch(() => ({}));
  if (!r.ok || res.success !== true) err("WhatsApp webhook", `Meta refused: ${String(res?.error?.message || r.status).slice(0, 200)}`);
  else out("WhatsApp connected", `Meta app → ${where(`${WORKER}/meta/webhook`)} (verified by the production Worker)`);
}
