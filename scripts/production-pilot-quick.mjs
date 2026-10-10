#!/usr/bin/env node
/** Quick production check: office bot switches + Telegram links, the central bot's webhook health, broken office
 *  logos (a logo whose file is gone is moved to logoUrlBroken so the app shows the platform mark). Counts/ids only. */
import { getProductionAccessToken, loadProductionServiceAccount, PRODUCTION_PROJECT } from "./production-credentials.mjs";
const out = (t, x) => console.log(`::notice title=${t}::${x}`);
const sa = loadProductionServiceAccount();
const token = await getProductionAccessToken(sa.serviceAccount);
const BASE = `https://firestore.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/databases/(default)/documents`;
const get = async (p) => { const r = await fetch(`${BASE}/${p}`, { headers: { Authorization: `Bearer ${token}` } }); return r.ok ? r.json() : null; };
const offices = ((await get("offices?pageSize=300"))?.documents || []).filter((d) => d.fields?.isTestFixture?.booleanValue !== true);
for (const o of offices) {
  const id = o.name.split("/").pop();
  const name = o.fields?.officeName?.stringValue || id;
  const bot = (await get(`offices/${id}/botSettings/telegram`))?.fields || {};
  const agent = (await get(`offices/${id}/agentSettings/main`))?.fields || {};
  const link = (await get(`telegramOfficeLinks/${id}`))?.fields || {};
  const logo = o.fields?.logoUrl?.stringValue || "";
  let logoState = "none";
  if (/^https?:\/\//.test(logo)) {
    const r = await fetch(logo, { method: "GET", signal: AbortSignal.timeout(15000) }).catch(() => ({ ok: false, status: "unreachable" }));
    logoState = r.ok ? "ok" : `broken (${r.status})`;
    if (!r.ok) {
      await fetch(`${BASE}/offices/${id}?updateMask.fieldPaths=logoUrl&updateMask.fieldPaths=logoUrlBroken`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ fields: { logoUrlBroken: { stringValue: logo } } }) });
      logoState += " → hidden (kept as logoUrlBroken)";
    }
  }
  out(`office ${name}`, `bot=${bot.enabled?.booleanValue === true ? "ON" : "off"} · Telegram chat linked=${link.status?.stringValue || (link.chatId ? "yes" : "no")} · last message=${link.lastInboundAt?.stringValue || link.lastInboundAt?.timestampValue || "-"} · office manager=${agent.enabled?.booleanValue === true ? "ON" : "off"} · logo=${logoState}`);
}
const tg = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
if (tg) {
  const h = await (await fetch(`https://api.telegram.org/bot${tg}/getWebhookInfo`)).json();
  out("central bot", `pending ${h.result?.pending_update_count || 0}${h.result?.last_error_message ? ` · last error: ${h.result.last_error_message}` : " · no delivery errors"}`);
}
