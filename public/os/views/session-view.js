/**
 * جلسة التفاوض — broker view (#/session/<journeyId>).
 * Same layout as the party page: fixed deal card, the session log (everything,
 * including prices sent to the broker only), and at the bottom the broker's own
 * free-text message with an explicit recipient.
 */

import { h, ic, clear, append } from "../core/dom.js";
import { back, go } from "../core/nav.js";
import { api } from "../core/runtime.js";
import { session } from "../core/session.js";
import { watchDoc, watchJourneyEvents } from "../core/live.js";
import { newRequestKey, openWhatsApp, runAction, toast } from "../core/ui.js";
import { ROLE_LABEL, parsePayload, sessionEventCard, sessionPrices, sessionStageLabel, isOpenJourney } from "../domain/session-domain.js";
import { formatPrice } from "../domain/format-domain.js";
import { sessionEventList, sessionSummary } from "./session-parts.js";

function isSessionEvent(event) {
  const type = String(event.type || "");
  if (type.startsWith("SESSION_")) return true;
  return type === "WHATSAPP_OPENED" && Boolean(parsePayload(event).role);
}

function brokerCard(event) {
  const type = String(event.type || "");
  if (type === "SESSION_LINK" || type === "WHATSAPP_OPENED") {
    return { id: event.id, actor: "broker", who: "الوسيط", text: event.text, detail: "", at: event.at || event.createdAt, private: true };
  }
  return sessionEventCard(event, "broker");
}

function linksCard(journey, state) {
  const jid = journey.journeyId || journey.id;
  const card = h("section", { class: "os-card", "aria-label": "روابط الجلسة" },
    h("h2", { class: "os-h2", style: { marginBottom: "8px" } }, ic("link"), "روابط الطرفين"));
  if (!state.links) {
    const load = h("button", { type: "button", class: "os-btn primary block" }, ic("link"), "تجهيز رابطي المالك والعميل");
    load.addEventListener("click", () => runAction(load, async () => {
      const res = await api("/os/session/links", { officeId: session.officeId, journeyId: jid });
      state.links = res.links;
      state.redraw();
    }));
    append(card, h("p", { class: "os-sub", style: { marginBottom: "8px" }, text: "لكل طرف رابط خاص بدوره، بلا تسجيل دخول، ويبقى صالحًا طوال الصفقة." }), load);
    return card;
  }
  const row = (role) => {
    const link = state.links[role];
    const copy = h("button", { type: "button", class: "os-btn secondary", "aria-label": `نسخ رابط ${ROLE_LABEL[role]}` }, ic("link"), "نسخ");
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(link.url); toast(`تم نسخ رابط ${ROLE_LABEL[role]}`, "ok"); } catch (_) { toast(link.url); }
    });
    const wa = h("button", { type: "button", class: "os-btn primary", disabled: !link.whatsappUrl, "aria-label": `إرسال رابط ${ROLE_LABEL[role]} عبر واتساب` }, ic("whatsapp"), "واتساب");
    wa.addEventListener("click", () => {
      openWhatsApp(link.whatsappUrl);
      api("/os/session/handoff", { officeId: session.officeId, journeyId: jid, role }).catch(() => {});
    });
    const replace = h("button", { type: "button", class: "os-btn ghost", "aria-label": `استبدال رابط ${ROLE_LABEL[role]}` }, ic("refresh"));
    replace.addEventListener("click", () => runAction(replace, async () => {
      const res = await api("/os/session/links", { officeId: session.officeId, journeyId: jid, replace: role });
      state.links = res.links;
      state.redraw();
    }, { success: `تم استبدال رابط ${ROLE_LABEL[role]} — الرابط السابق لم يعد يعمل` }));
    return h("div", { class: "os-session-link" },
      h("div", {}, h("b", { text: `رابط ${ROLE_LABEL[role]}` }), h("small", { text: link.opened ? "فتح الطرف الرابط" : link.hasPhone ? "لم يُفتح بعد" : "لا يوجد رقم جوال — انسخ الرابط" })),
      h("div", { class: "os-btn-row" }, wa, copy, replace));
  };
  append(card, h("div", { class: "os-session-links" }, row("owner"), row("client")));
  return card;
}

function pricesCard(journey) {
  const prices = sessionPrices(journey);
  const priv = journey.session?.privatePrices || {};
  const line = (role) => h("div", { class: "os-meta-row" }, ic(role === "owner" ? "home" : "user"),
    h("span", {}, `آخر سعر ${ROLE_LABEL[role]}: `, h("b", { text: formatPrice(prices[role]) || "—" }),
      priv[role]?.price ? ` · للوسيط فقط: ${formatPrice(priv[role].price)}` : ""));
  return h("section", { class: "os-card", "aria-label": "أسعار الطرفين" }, h("div", { style: { display: "grid", gap: "6px" } }, line("owner"), line("client")));
}

function interventionCard(journey) {
  const flag = journey.session?.intervention;
  if (!flag?.required) return null;
  const done = h("button", { type: "button", class: "os-btn primary" }, ic("check"), "تم التدخل");
  done.addEventListener("click", () => runAction(done, () => api("/os/session/resolve", { officeId: session.officeId, journeyId: journey.journeyId || journey.id }), { success: "أُزيل تمييز التدخل" }));
  return h("section", { class: "os-card", "aria-label": "تدخل مطلوب" },
    h("div", { class: "os-alert warn", style: { marginBottom: "8px" } }, h("b", { text: `طلب ${ROLE_LABEL[flag.by] || "الطرف"} تدخل الوسيط. ` }), "تواصل معه ثم اضغط «تم التدخل»."),
    done);
}

function composer(journey, draft) {
  const jid = journey.journeyId || journey.id;
  const seg = h("div", { class: "os-seg", role: "group", "aria-label": "إرسال إلى" });
  const choices = [["owner", "إلى المالك"], ["client", "إلى العميل"], ["both", "إلى الطرفين"]];
  for (const [value, label] of choices) {
    const b = h("button", { type: "button", "aria-pressed": String(draft.audience === value), text: label });
    b.addEventListener("click", () => { draft.audience = value; seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); });
    append(seg, b);
  }
  const text = h("textarea", { class: "os-textarea", maxlength: "500", placeholder: "اكتب رسالتك للطرف…", "aria-label": "رسالة الوسيط" });
  text.value = draft.text || "";
  text.addEventListener("input", () => { draft.text = text.value; });
  const key = newRequestKey();
  const send = h("button", { type: "button", class: "os-btn primary" }, ic("send"), "إرسال");
  send.addEventListener("click", () => runAction(send, async () => {
    if (!draft.audience) throw new Error("اختر: إلى المالك، إلى العميل، أو إلى الطرفين");
    if (text.value.trim().length < 2) throw new Error("اكتب الرسالة أولًا");
    await api("/os/session/message", { officeId: session.officeId, journeyId: jid, audience: draft.audience, text: text.value, requestKey: `${key}-${text.value.length}-${draft.audience}` });
    draft.text = "";
    text.value = "";
  }, { success: "أُرسلت الرسالة إلى الجلسة" }));
  return h("section", { class: "os-session-actions os-session-composer", "aria-label": "رسالة الوسيط" },
    seg, h("div", { class: "os-session-typed" }, text, send),
    h("small", { class: "os-sub", style: { fontSize: ".78rem" }, text: "إذا اخترت طرفًا واحدًا فلن يرى الطرف الآخر الرسالة." }));
}

export function renderSession(container, { journeyId }) {
  let journey;
  let events = [];
  const draft = { audience: "", text: "" };
  const state = { links: null, redraw: () => draw() };
  api("/os/session/links", { officeId: session.officeId, journeyId }).then((res) => { state.links = res.links; draw(); }).catch(() => {});
  let deferred = false;
  const draw = () => {
    // Never rebuild under the broker's cursor: a live update waits until typing stops.
    const active = document.activeElement;
    if (active && active.tagName === "TEXTAREA" && container.contains(active)) {
      if (!deferred) { deferred = true; active.addEventListener("blur", () => { deferred = false; draw(); }, { once: true }); }
      return;
    }
    const y = window.scrollY;
    clear(container);
    append(container, h("div", { class: "os-page-head" },
      h("button", { type: "button", class: "os-back", onClick: () => back("tasks") }, ic("chev-right"), "رجوع"),
      h("h1", { class: "os-page-title", text: "جلسة التفاوض" }),
      h("button", { type: "button", class: "os-ref", onClick: () => go(`journey/${journeyId}`), text: "الفرصة" })));
    if (journey === undefined) { append(container, h("div", { class: "os-skeleton" })); return; }
    if (!journey) { append(container, h("div", { class: "os-alert bad", text: "الصفقة غير موجودة." })); return; }
    const prices = sessionPrices(journey);
    const offer = journey.offerSummary || {};
    const cards = events.filter(isSessionEvent).map(brokerCard);
    append(container,
      sessionSummary({ propertyType: offer.propertyType, district: offer.district, currentPrice: prices.current, agreedPrice: prices.agreed, stageLabel: sessionStageLabel(journey), intervention: Boolean(journey.session?.intervention?.required) }),
      interventionCard(journey),
      pricesCard(journey),
      isOpenJourney(journey) ? linksCard(journey, state) : null,
      h("section", { class: "os-card os-session-history", "aria-label": "سجل الجلسة" },
        h("h2", { class: "os-h2" }, ic("clock"), "سجل الجلسة"),
        sessionEventList(cards, { emptyText: "لا توجد حركات بعد — أرسل الروابط للطرفين." })),
      isOpenJourney(journey) ? composer(journey, draft) : h("div", { class: "os-card" }, h("div", { class: "os-alert info", text: "أُغلقت الصفقة وتوقفت روابط الجلسة. السجل محفوظ." })));
    window.scrollTo({ top: y });
  };
  const offs = [
    watchDoc(session.officeId, "journeys", journeyId, (doc) => { journey = doc; draw(); }, () => { journey = null; draw(); }),
    watchJourneyEvents(session.officeId, journeyId, (rows) => { events = rows; if (journey) draw(); })
  ];
  draw();
  return () => offs.forEach((off) => off && off());
}
