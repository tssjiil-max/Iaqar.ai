/**
 * «بوت المكتب» on the screens: the office's switch and each broker's own alerts («قنوات المكتب»,
 * «الإشعارات»), the link a side receives (record page), and what the bot is doing about a match
 * (review page). Sending itself happens only in the Worker.
 */

import { h, ic, clear, append } from "../core/dom.js";
import { session } from "../core/session.js";
import { confirmDialog, runAction, toast } from "../core/ui.js";
import { loadChannels } from "../core/channels.js";
import { partyBotStatus, setBotEnabled, startBrokerBotLink, startPartyBotLink, unlinkBrokerBot } from "../core/bot.js";
import { ASK_STATE_LABEL } from "../domain/bot-domain.js";

async function copyText(value, done) {
  try { await navigator.clipboard.writeText(value); toast(done); } catch (_) { toast("تعذر النسخ — انسخ الرابط يدويًا", "bad"); }
}

/** The office's switch (manager). `view` = payload.bot from /os/channels/status. */
export function botCard(view = {}, reload) {
  const status = h("span", { class: `os-chan-status is-${view.enabled ? "connected" : "disconnected"}`, "data-bot-state": view.enabled ? "ON" : view.available ? "OFF" : "UNAVAILABLE", text: view.stateLabel || "" });
  const toggle = view.available ? h("button", { type: "button", class: `os-btn ${view.enabled ? "danger" : "primary"}`, "data-bot-toggle": view.enabled ? "off" : "on" }, ic(view.enabled ? "x" : "check"), view.enabled ? "إيقاف البوت" : "تشغيل البوت") : null;
  if (toggle) {
    toggle.addEventListener("click", async () => {
      const yes = await confirmDialog(view.enabled
        ? { title: "إيقاف بوت المكتب؟", text: "يتوقف البوت عن سؤال الأطراف وعن تمرير الردود بينهم. كل مطابقة جديدة تبقى مهمة مراجعة عندك. الأسئلة التي أُرسلت تبقى قابلة للإجابة.", confirmLabel: "إيقاف", danger: true }
        : { title: "تشغيل بوت المكتب؟", text: "من الآن يسأل البوت العميل ثم المالك عن كل مطابقة قوية جديدة، ويفتح الصفقة ويرسل رابط صفحة التفاوض عند موافقتهما — دون الرجوع لك. يعمل فقط مع من فتح رابط البوت من الأطراف. يمكنك إيقافه في أي لحظة.", confirmLabel: "تشغيل" });
      if (!yes) return;
      await runAction(toggle, async () => { await setBotEnabled(session.officeId, !view.enabled); await reload(); }, { success: view.enabled ? "تم إيقاف البوت" : "البوت يعمل الآن" });
    });
  }
  return h("article", { class: "os-card os-chan os-bot", "data-bot": "" },
    h("header", { class: "os-chan-head" },
      h("span", { class: "os-set-icon" }, ic("sparkles")),
      h("div", { class: "os-set-text" }, h("b", { text: "بوت المكتب — التواصل مع الأطراف" }), h("small", { text: "البوت يسأل العميل ثم المالك عن المطابقة، ويرسل صفحة التفاوض عند موافقتهما، ويخبرك فقط عند الحاجة." })),
      status),
    h("dl", { class: "os-chan-facts" },
      h("div", { class: "os-chan-fact" }, h("dt", { text: "الأطراف المرتبطون بالبوت" }), h("dd", { "data-bot-parties": "", text: String(view.linkedParties || 0) })),
      h("div", { class: "os-chan-fact" }, h("dt", { text: "أدنى قوة مطابقة للسؤال" }), h("dd", { text: `${view.minScore || 70}%` })),
      h("div", { class: "os-chan-fact" }, h("dt", { text: "حد الأسئلة اليومي للشخص" }), h("dd", { text: String(view.dailyAsks || 3) }))),
    h("ul", { class: "os-bot-rules" },
      h("li", { text: "يراسل البوت فقط من فتح رابط البوت من صفحة سجله وضغط «Start» وأكّد رقم جواله — هذا شرط تيليجرام." }),
      h("li", { text: "لا يرى أي طرف اسم الآخر أو رقمه أو العنوان الدقيق." }),
      h("li", { text: "أي رسالة مكتوبة من طرف تصلك في مركز التواصل، ولا يرد عليها البوت من عنده." }),
      h("li", { text: "من أي صفقة تستطيع «استلام التواصل» فيتوقف البوت عنها." })),
    view.note ? h("p", { class: "os-sub", "data-bot-note": "", text: view.note }) : null,
    toggle ? h("div", { class: "os-btn-row" }, toggle) : null);
}

/** «تنبيهاتي على تيليجرام» — each broker links his own chat; loads and refreshes itself. */
export function brokerAlertsCard() {
  const body = h("div", { class: "os-skeleton" });
  const card = h("article", { class: "os-card os-chan", "data-bot-alerts": "" }, body);
  const pending = { link: "", until: 0 };
  let timer = 0;
  const draw = (view = {}) => {
    clear(card);
    clearTimeout(timer);
    // The link is dropped once used, and when its 15 minutes are over.
    if (view.brokerLinked || Date.now() > pending.until) pending.link = "";
    const link = h("button", { type: "button", class: "os-btn primary", "data-bot-alerts-link": "" }, ic("link"), view.brokerLinked ? "ربط محادثة أخرى" : "ربط تنبيهاتي");
    link.addEventListener("click", () => runAction(link, async () => { const result = await startBrokerBotLink(session.officeId); pending.link = result.deepLink; pending.until = new Date(result.expiresAt || Date.now() + 15 * 60000).getTime(); await refresh(); }));
    const unlink = view.brokerLinked ? h("button", { type: "button", class: "os-btn danger", "data-bot-alerts-unlink": "" }, ic("x"), "إيقاف تنبيهاتي") : null;
    if (unlink) unlink.addEventListener("click", () => runAction(unlink, async () => { await unlinkBrokerBot(session.officeId); await refresh(); }, { success: "توقفت تنبيهات تيليجرام" }));
    const copy = h("button", { type: "button", class: "os-btn secondary" }, ic("clipboard"), "نسخ الرابط");
    copy.addEventListener("click", () => copyText(pending.link, "تم نسخ الرابط"));
    append(card,
      h("header", { class: "os-chan-head" },
        h("span", { class: "os-set-icon" }, ic("bell")),
        h("div", { class: "os-set-text" }, h("b", { text: "تنبيهاتي على تيليجرام" }), h("small", { text: "يصلك فقط ما يحتاج تدخلك: طلب تدخل، سعر خاص، اتفاق، موعد معاينة، رسالة من طرف — مع زر يفتح الصفقة." })),
        h("span", { class: `os-chan-status is-${view.brokerLinked ? "connected" : "disconnected"}`, "data-bot-alerts-state": view.brokerLinked ? "LINKED" : "NOT_LINKED", text: view.brokerLinked ? "مرتبط" : "غير مرتبط" })),
      !view.available ? h("p", { class: "os-sub", "data-bot-alerts-note": "", text: "بوت المنصة غير مفعّل للإرسال على هذه البيئة بعد." }) : null,
      view.available && pending.link ? h("div", { class: "os-chan-link", "data-bot-alerts-pending": "" },
        h("p", { class: "os-sub", text: "افتح الرابط من حسابك الشخصي في تيليجرام ثم اضغط «Start». الرابط صالح 15 دقيقة ولمرة واحدة." }),
        h("div", { class: "os-btn-row" }, h("a", { class: "os-btn primary", href: pending.link, target: "_blank", rel: "noopener", "data-bot-alerts-open": "" }, ic("telegram"), "فتح تيليجرام"), copy)) : null,
      view.available ? h("div", { class: "os-btn-row" }, link, unlink) : null);
    // While the link waits for «Start», check again so the card turns «مرتبط» by itself.
    if (pending.link && card.isConnected) timer = setTimeout(() => { if (card.isConnected) refresh().catch(() => {}); }, 4000);
  };
  async function refresh() {
    const payload = await loadChannels(session.officeId);
    if (card.isConnected || !card.parentNode) draw(payload.bot || {});
  }
  refresh().catch(() => { clear(card); append(card, h("p", { class: "os-sub", text: "تعذر تحميل حالة تنبيهات تيليجرام." })); });
  return card;
}

const PARTY_STATE = Object.freeze({
  LINKED: { label: "مرتبط بالبوت", tone: "connected" },
  STOPPED: { label: "أوقف رسائل البوت", tone: "error" },
  NOT_LINKED: { label: "غير مرتبط بالبوت", tone: "disconnected" },
  NO_PHONE: { label: "أضف رقم جوال لربطه بالبوت", tone: "disconnected" }
});

/**
 * On a record's page: is this owner / client on the office's bot, and the link to give him.
 * Sending the link is the broker's own act (copy, or his own WhatsApp).
 */
export function partyBotRow(record = {}, { who = "العميل" } = {}) {
  const row = h("div", { class: "os-bot-party", "data-bot-party": "" }, h("div", { class: "os-skeleton", style: { height: "40px" } }));
  const draw = (status, link = null) => {
    clear(row);
    if (!status.available) { row.hidden = true; return; }
    const state = PARTY_STATE[status.state] || PARTY_STATE.NOT_LINKED;
    const make = h("button", { type: "button", class: "os-btn secondary", "data-bot-party-link": "" }, ic("send"), status.state === "LINKED" ? "رابط جديد للبوت" : "رابط بوت تيليجرام");
    make.addEventListener("click", () => runAction(make, async () => { draw(status, await startPartyBotLink(session.officeId, record.id)); }));
    const copy = h("button", { type: "button", class: "os-btn secondary", "data-bot-party-copy": "" }, ic("clipboard"), "نسخ الرسالة");
    if (link) copy.addEventListener("click", () => copyText(link.text, "تم نسخ الرسالة مع الرابط"));
    append(row,
      h("div", { class: "os-bot-party-head" }, ic("telegram"),
        h("span", { class: `os-chan-status is-${state.tone}`, "data-bot-party-state": status.state, text: state.label })),
      status.state === "NO_PHONE" ? null : link
        ? h("div", { class: "os-chan-link", "data-bot-party-pending": "" },
          h("p", { class: "os-sub", text: `أرسل هذا الرابط إلى ${who}. يفتحه ويضغط «Start» ثم «مشاركة رقمي» للتأكيد — يُقبل فقط الرقم المسجل هنا. بعدها يراسله البوت بالمطابقات. الرابط لمرة واحدة.` }),
          h("p", { class: "os-bot-link", dir: "ltr", "data-bot-party-url": "", text: link.deepLink }),
          h("div", { class: "os-btn-row" }, copy,
            link.whatsappUrl ? h("a", { class: "os-btn whatsapp", href: link.whatsappUrl, target: "_blank", rel: "noopener", "data-bot-party-whatsapp": "" }, ic("whatsapp"), "إرساله بواتساب") : null))
        : h("div", { class: "os-btn-row" }, make));
  };
  partyBotStatus(session.officeId, record.id).then((status) => draw(status)).catch(() => { row.hidden = true; });
  return row;
}

/** One line on the review page: what the bot is doing about this match ("" when it is not involved). */
export function botAskLine(match = {}) {
  const label = ASK_STATE_LABEL[String(match.botAskState || "")];
  if (!label) return null;
  return h("div", { class: "os-alert info os-bot-ask", "data-bot-ask": String(match.botAskState) }, ic("telegram"), h("span", { text: `${label}. يمكنك اتخاذ القرار بنفسك في أي وقت، فيتوقف سؤال البوت.` }));
}
