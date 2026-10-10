#!/usr/bin/env node
/**
 * Production channels — READ-ONLY inspection: which credentials this run can see (names only), the central
 * Telegram bot's identity and where its webhook points (host + path), and where the Meta app sends WhatsApp
 * events (host + path). Changes nothing at Telegram, Meta or Cloudflare. Never prints a value.
 *   env (optional): TELEGRAM_BOT_TOKEN, META_APP_SECRET, META_APP_ID
 */
const out = (title, text) => console.log(process.env.GITHUB_ACTIONS ? `::notice title=${title}::${text}` : `${title}: ${text}`);
const where = (url) => { try { const u = new URL(url); return `${u.host}${u.pathname}`; } catch { return url ? "(not a URL)" : "(none)"; } };
const has = (name) => Boolean(String(process.env[name] || "").trim());

out("credentials visible to this run", ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "META_APP_SECRET", "META_WEBHOOK_VERIFY_TOKEN", "GEMINI_API_KEY"].map((n) => `${n}=${has(n) ? "yes" : "no"}`).join(" · "));

const token = String(process.env.TELEGRAM_BOT_TOKEN || "").replace(/\s+/g, "");
if (token) {
  const tg = async (method) => (await (await fetch(`https://api.telegram.org/bot${token}/${method}`, { signal: AbortSignal.timeout(20_000) })).json().catch(() => ({})));
  const me = await tg("getMe");
  const hook = await tg("getWebhookInfo");
  out("Telegram bot", me.ok ? `@${me.result.username}` : "token refused by Telegram");
  if (hook.ok) out("Telegram webhook", `${where(hook.result.url)} · pending ${hook.result.pending_update_count || 0}${hook.result.last_error_message ? ` · last error: ${String(hook.result.last_error_message).slice(0, 120)}` : ""}`);
}

const appId = String(process.env.META_APP_ID || "1315826203671419");
const secret = String(process.env.META_APP_SECRET || "").trim();
if (secret) {
  const r = await fetch(`https://graph.facebook.com/v25.0/${appId}/subscriptions?access_token=${encodeURIComponent(`${appId}|${secret}`)}`, { signal: AbortSignal.timeout(20_000) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) out("Meta app webhooks", `HTTP ${r.status} ${String(body?.error?.message || "").slice(0, 120)}`);
  for (const s of body.data || []) out(`Meta webhook (${s.object})`, `${where(s.callback_url)} · active=${s.active} · fields ${(s.fields || []).map((f) => f.name || f).join(",").slice(0, 160)}`);
}
