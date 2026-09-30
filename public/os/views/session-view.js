/**
 * Broker negotiation workspace. The page has one stable hierarchy:
 * 1) property data, 2) agreed items, 3) owner/client, then secondary links/log,
 * with the broker's single message composer at the bottom.
 */

import { h, ic, clear, append } from "../core/dom.js";
import { back, go } from "../core/nav.js";
import { api } from "../core/runtime.js";
import { session } from "../core/session.js";
import { watchDoc, watchJourneyEvents } from "../core/live.js";
import { newRequestKey, openWhatsApp, runAction, toast } from "../core/ui.js";
import { ROLE_LABEL, parsePayload, sessionEventCard, sessionPrices, sessionStageLabel, isOpenJourney } from "../domain/session-domain.js";
import { formatDateTime, formatPrice } from "../domain/format-domain.js";
import { priceStatusLabel } from "../domain/flow-domain.js";
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
  const body = h("div", {});
  if (!state.links) {
    const load = h("button", { type: "button", class: "os-btn secondary block" }, ic("link"), "تجهيز روابط الطرفين");
    load.addEventListener("click", () => runAction(load, async () => {
      const res = await api("/os/session/links", { officeId: session.officeId, journeyId: jid });
      state.links = res.links;
      state.redraw();
    }));
    append(body, h("p", { class: "os-sub", text: "لكل طرف رابط خاص بدوره، بلا تسجيل دخول." }), load);
  } else {
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
      }, { success: `تم استبدال رابط ${ROLE_LABEL[role]}` }));
      return h("div", { class: "os-session-link" },
        h("div", {}, h("b", { text: ROLE_LABEL[role] }), h("small", { text: link.opened ? "فتح الرابط" : link.hasPhone ? "لم يُفتح بعد" : "لا يوجد رقم جوال" })),
        h("div", { class: "os-btn-row" }, wa, copy, replace));
    };
    append(body, h("div", { class: "os-session-links" }, row("owner"), row("client")));
  }
  return h("details", { class: "os-card", "aria-label": "روابط الطرفين" },
    h("summary", { class: "os-h2" }, ic("link"), "روابط الطرفين"),
    h("div", { style: { marginTop: "10px" } }, body));
}

function propertyCard(journey) {
  const prices = sessionPrices(journey);
  const offer = journey.offerSummary || {};
  return h("section", { class: "os-card", "aria-label": "بيانات العقار" },
    h("h2", { class: "os-h2" }, ic("home"), "بيانات العقار"),
    sessionSummary({ propertyType: offer.propertyType, district: offer.district, currentPrice: prices.current, agreedPrice: prices.agreed, stageLabel: sessionStageLabel(journey), intervention: false }),
    h("div", { class: "os-meta-row" }, ic("price"), h("span", {}, "حالة السعر: ", h("b", { text: priceStatusLabel(offer) }))));
}

function agreedCard(journey) {
  const rows = [];
  for (const item of Array.isArray(journey.agreedItems) ? journey.agreedItems : []) {
    if (!item || item.value === undefined || item.value === null || item.value === "") continue;
    let value = item.value;
    if (item.key === "price") value = formatPrice(item.value);
    if (item.key === "viewing") value = formatDateTime(item.value);
    rows.push(h("div", { class: "os-meta-row" }, ic("check-circle"), h("span", {}, `${item.label || "تم الاتفاق"}: `, h("b", { text: value }))));
  }
  return h("section", { class: "os-card", "aria-label": "تم الاتفاق عليه" },
    h("h2", { class: "os-h2" }, ic("check-circle"), "تم الاتفاق عليه"),
    rows.length ? h("div", { style: { display: "grid", gap: "8px" } }, rows) : h("p", { class: "os-sub", text: "لم يُعتمد بند بعد." }));
}

function partiesCard(journey) {
  const prices = sessionPrices(journey);
  const sessionState = journey.session || {};
  const privatePrices = sessionState.privatePrices || {};
  const last = sessionState.lastMove || {};
  const side = (role) => {
    const title = role === "owner" ? "المالك" : "العميل";
    const price = prices[role];
    const lastText = last.role === role ? "آخر حركة منه" : "بانتظار دوره";
    return h("div", { class: "os-card os-session-party", "data-party": role },
      h("div", { class: "os-h2" }, ic(role === "owner" ? "owner" : "client"), title),
      h("div", { class: "os-meta-row" }, ic("price"), h("span", {}, "السعر الحالي: ", h("b", { text: formatPrice(price) || "—" }))),
      privatePrices[role]?.price ? h("div", { class: "os-meta-row" }, ic("lock"), h("span", {}, "للوسيط فقط: ", h("b", { text: formatPrice(privatePrices[role].price) }))) : null,
      h("small", { class: "os-sub", text: lastText }));
  };
  return h("section", { class: "os-card", "aria-label": "المالك والعميل" },
    h("h2", { class: "os-h2" }, ic("handshake"), "التفاوض الحالي"),
    h("div", { class: "os-session-parties" }, side("owner"), side("client")));
}

function interventionCard(journey) {
  const flag = journey.session?.intervention;
  if (!flag?.required) return null;
  const done = h("button", { type: "button", class: "os-btn primary" }, ic("check"), "تم التدخل");
  done.addEventListener("click", () => runAction(done, () => api("/os/session/resolve", { officeId: session.officeId, journeyId: journey.journeyId || journey.id }), { success: "أُزيل تمييز التدخل" }));
  return h("section", { class: "os-card", "aria-label": "تدخل مطلوب" },
    h("div", { class: "os-alert warn", style: { marginBottom: "8px" } }, h("b", { text: `طلب ${ROLE_LABEL[flag.by] || "الطرف"} تدخل الوسيط. ` }), "تواصل معه ثم سجّل انتهاء التدخل."), done);
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
  const text = h("textarea", { class: "os-textarea", maxlength: "500", placeholder: "اكتب توجيهًا عند الحاجة…", "aria-label": "رسالة الوسيط" });
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
  return h("section", { class: "os-session-actions os-session-composer", "aria-label": "توجيه الوسيط" },
    h("h2", { class: "os-h2" }, ic("broker"), "توجيه الوسيط"),
    seg, h("div", { class: "os-session-typed" }, text, send),
    h("small", { class: "os-sub", text: "استخدمه فقط عند الحاجة؛ بقية الرحلة يقودها النظام." }));
}

function historyCard(events) {
  const cards = events.filter(isSessionEvent).map(brokerCard);
  return h("details", { class: "os-card os-session-history", "aria-label": "سجل التفاوض" },
    h("summary", { class: "os-h2" }, ic("clock"), "السجل"),
    h("div", { style: { marginTop: "10px" } }, sessionEventList(cards, { emptyText: "لا توجد حركات بعد." })));
}

export function renderSession(container, { journeyId }) {
  let journey;
  let events = [];
  const draft = { audience: "", text: "" };
  const state = { links: null, redraw: () => draw() };
  api("/os/session/links", { officeId: session.officeId, journeyId }).then((res) => { state.links = res.links; draw(); }).catch(() => {});
  let deferred = false;
  const draw = () => {
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
    append(container,
      propertyCard(journey),
      agreedCard(journey),
      interventionCard(journey),
      partiesCard(journey),
      isOpenJourney(journey) ? linksCard(journey, state) : null,
      historyCard(events),
      isOpenJourney(journey) ? composer(journey, draft) : h("div", { class: "os-card" }, h("div", { class: "os-alert info", text: "أُغلقت هذه الرحلة. السجل محفوظ." })));
    window.scrollTo({ top: y });
  };
  const offs = [
    watchDoc(session.officeId, "journeys", journeyId, (doc) => { journey = doc; draw(); }, () => { journey = null; draw(); }),
    watchJourneyEvents(session.officeId, journeyId, (rows) => { events = rows; if (journey) draw(); })
  ];
  draw();
  return () => offs.forEach((off) => off && off());
}
