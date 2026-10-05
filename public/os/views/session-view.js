/**
 * غرفة التفاوض — broker view (#/session/<journeyId>) of ONE deal.
 * Same three parts as the sides' page (بيانات العقار · ما تم الاتفاق عليه · المالك مقابل العميل),
 * plus what only the broker has: the requests the sides sent him (pass on · rephrase · reply ·
 * do not pass on), the links, the full log with his own interventions, and his message box.
 * The broker watches the whole negotiation and steps in when asked or when he sees a need.
 */

import { h, ic, clear, append } from "../core/dom.js";
import { back, go } from "../core/nav.js";
import { api } from "../core/runtime.js";
import { session } from "../core/session.js";
import { watchDoc, watchJourneyEvents } from "../core/live.js";
import { newRequestKey, openWhatsApp, runAction, toast } from "../core/ui.js";
import { ROLE_LABEL, parsePayload, sessionEventCard, sessionPrices, sessionStageLabel, isOpenJourney } from "../domain/session-domain.js";
import { formatPrice, relativeAgo } from "../domain/format-domain.js";
import { historyDetails, roomAgreedCard, roomPropertyCard, roomSidesCard, roomTermsList, sessionEventList } from "./session-parts.js";
import { PRICE_STATUS_LABEL, normalizePriceStatus } from "../domain/deal-flow-domain.js";
import { REQUEST_DECISIONS, awaitingParties, openRequests, partyStatus, propertyFacts, readiness, relaySafeText, roomAgreedItems, roomSchema, termRows } from "../domain/negotiation-room-domain.js";
import { recordById } from "../core/state.js";
import { confirmDialog } from "../core/ui.js";
import { dealFollowBar } from "./deal-follow-bar.js";
import { rememberDeal } from "../core/deal-return.js";

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
  const card = h("section", { class: "os-card", "aria-label": "روابط الغرفة" },
    h("h2", { class: "os-h2", style: { marginBottom: "8px" } }, ic("link"), "روابط الطرفين"));
  if (!state.links) {
    const load = h("button", { type: "button", class: "os-btn primary block" }, ic("link"), "تجهيز رابطي المالك والعميل");
    load.addEventListener("click", () => runAction(load, async () => {
      const res = await api("/os/session/links", { officeId: session.officeId, journeyId: jid });
      state.links = res.links;
      state.redraw();
    }));
    append(card, h("p", { class: "os-sub", style: { marginBottom: "8px" }, text: "لكل طرف رابط خاص بغرفة هذه الصفقة، بلا تسجيل دخول، ويبقى صالحًا طوال الصفقة." }), load);
    return card;
  }
  const row = (role) => {
    const link = state.links[role];
    const copy = h("button", { type: "button", class: "os-btn secondary", "aria-label": `نسخ رابط ${ROLE_LABEL[role]}` }, ic("link"), "نسخ");
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(link.url); toast(`تم نسخ رابط ${ROLE_LABEL[role]}`, "ok"); } catch (_) { toast(link.url); }
    });
    const wa = h("button", { type: "button", class: "os-btn primary", disabled: !link.whatsappUrl, "aria-label": `إرسال رابط ${ROLE_LABEL[role]} عبر واتساب` }, ic("whatsapp"), link.awaiting ? "تذكير" : "واتساب");
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
    return h("div", { class: "os-session-link", "data-link-role": role, "data-link-awaiting": String(Boolean(link.awaiting)) },
      h("div", {}, h("b", { text: `رابط ${ROLE_LABEL[role]}` }),
        h("small", { text: link.awaiting ? "بانتظار رده — أرسل له تذكيرًا بالرابط" : link.opened ? "فتح الطرف الرابط" : link.hasPhone ? "لم يُفتح بعد" : "لا يوجد رقم جوال — انسخ الرابط" })),
      h("div", { class: "os-btn-row" }, wa, copy, replace));
  };
  append(card, h("div", { class: "os-session-links" }, row("owner"), row("client")));
  return card;
}

/**
 * «طلبات الطرفين» — what the owner or the client sent to the broker. Nothing here reaches the
 * other side unless the broker chooses: تمرير · إعادة صياغة · الرد على المرسل · عدم التمرير.
 */
function requestsCard(journey, ui) {
  const jid = journey.journeyId || journey.id;
  const open = openRequests(journey);
  const legacy = journey.session?.intervention?.required && !open.length;
  if (!open.length && !legacy) return null;
  const card = h("section", { class: "os-card", "aria-label": "طلبات الطرفين للوسيط", "data-room-requests": "" },
    h("h2", { class: "os-h2", style: { marginBottom: "8px" } }, ic("alert"), "طلبات الطرفين للوسيط", h("span", { class: "os-count", text: String(open.length || 1) })));
  if (legacy) {
    // A request made before the room kept its content: follow it up, then mark it done.
    const flag = journey.session.intervention;
    const done = h("button", { type: "button", class: "os-btn primary" }, ic("check"), "تم التدخل");
    done.addEventListener("click", () => runAction(done, () => api("/os/session/resolve", { officeId: session.officeId, journeyId: jid }), { success: "أُغلق الطلب" }));
    append(card, h("div", { class: "os-request" }, h("p", { class: "os-request-text", text: `طلب ${ROLE_LABEL[flag.by] || "الطرف"} تدخل الوسيط. تواصل معه ثم اضغط «تم التدخل».` }), done));
    return card;
  }
  const decide = (button, request, decision, text = "") => runAction(button, async () => {
    await api("/os/session/request", { officeId: session.officeId, journeyId: jid, requestId: request.id, decision, text, requestKey: newRequestKey() });
    ui.requestMode = null;
    // Leave the text box so the screen can show the request as handled.
    if (document.activeElement && document.activeElement.tagName === "TEXTAREA") document.activeElement.blur();
    ui.redraw();
  }, { success: `${REQUEST_DECISIONS[decision].label}` });
  for (const request of open) {
    const mode = ui.requestMode?.id === request.id ? ui.requestMode : null;
    const passable = relaySafeText(request.kind === "info" ? `يستفسر عن: ${request.topic}` : request.text);
    const forward = h("button", { type: "button", class: "os-btn secondary", "data-request-action": "forward", disabled: passable.length < 2 ? true : null }, ic("send"), `تمرير إلى ${request.otherLabel}`);
    forward.addEventListener("click", async () => {
      const yes = await confirmDialog({ title: `تمرير إلى ${request.otherLabel}؟`, text: `سيصله: «${passable}» — وسيظهر له أنها منقولة عن طريق الوسيط. أرقام الجوال والروابط تُحذف تلقائيًا.`, confirmLabel: "تمرير" });
      if (yes) decide(forward, request, "forward");
    });
    const writeButton = (decision, icon, label) => {
      const b = h("button", { type: "button", class: "os-btn secondary", "data-request-action": decision, "aria-expanded": String(mode?.decision === decision) }, ic(icon), label);
      b.addEventListener("click", () => { ui.requestMode = mode?.decision === decision ? null : { id: request.id, decision, text: decision === "rephrase" ? passable : "" }; ui.redraw(); });
      return b;
    };
    const dismiss = h("button", { type: "button", class: "os-btn ghost", "data-request-action": "dismiss" }, ic("x"), "عدم التمرير");
    dismiss.addEventListener("click", () => decide(dismiss, request, "dismiss"));
    const handled = h("button", { type: "button", class: "os-btn ghost", "data-request-action": "handled" }, ic("check"), "عالجتها داخل الصفقة");
    handled.addEventListener("click", () => decide(handled, request, "handled"));
    const dealLink = h("button", { type: "button", class: "os-btn ghost", "data-request-action": "deal", onClick: () => go(`journey/${jid}`) }, ic("contract"), "فتح الصفقة");
    let writer = null;
    if (mode) {
      const to = mode.decision === "reply" ? request.roleLabel : request.otherLabel;
      const box = h("textarea", { class: "os-textarea", maxlength: "500", name: "requestText", placeholder: `اكتب رسالتك إلى ${to}…`, "aria-label": `رسالة إلى ${to}` });
      box.value = mode.text || "";
      box.addEventListener("input", () => { mode.text = box.value; });
      const send = h("button", { type: "button", class: "os-btn primary", "data-request-send": mode.decision }, ic("send"), `إرسال إلى ${to}`);
      send.addEventListener("click", () => {
        if (box.value.trim().length < 2) { toast("اكتب الرسالة أولًا", "bad"); return; }
        decide(send, request, mode.decision, box.value);
      });
      writer = h("div", { class: "os-room-panel", "data-request-writer": mode.decision },
        h("small", { class: "os-sub", text: mode.decision === "reply" ? "يصل ردك إلى المرسل فقط." : `تصل رسالتك إلى ${to} باسمك أنت (الوسيط)، لا على لسان ${request.roleLabel}.` }),
        box, send);
    }
    append(card, h("article", { class: "os-request", "data-request": request.id, "data-request-role": request.role, "data-request-kind": request.kind },
      h("div", { class: "os-request-head" },
        h("b", { text: `${request.roleLabel} — ${request.kindLabel}${request.topic ? `: ${request.topic}` : ""}` }),
        h("small", { text: relativeAgo(request.at) || "" })),
      request.text ? h("p", { class: "os-request-text", dir: "auto", "data-request-text": "", text: request.text }) : request.kind === "intervention" ? h("p", { class: "os-request-text os-sub", text: "لم يكتب رسالة — يطلب تواصلك معه." }) : null,
      h("div", { class: "os-btn-row" }, forward, writeButton("rephrase", "edit", "إعادة صياغتها"), writeButton("reply", "reply", `الرد على ${request.roleLabel}`)),
      writer,
      h("div", { class: "os-btn-row" }, dismiss, handled, dealLink)));
  }
  return card;
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
  const text = h("textarea", { class: "os-textarea", maxlength: "500", name: "brokerMessage", placeholder: "اكتب رسالتك للطرف…", "aria-label": "رسالة الوسيط" });
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
  }, { success: "أُرسلت الرسالة إلى غرفة التفاوض" }));
  return h("section", { class: "os-session-actions os-session-composer", "aria-label": "رسالة الوسيط" },
    seg, h("div", { class: "os-session-typed" }, text, send),
    h("small", { class: "os-sub", style: { fontSize: ".78rem" }, text: "إذا اخترت طرفًا واحدًا فلن يرى الطرف الآخر الرسالة." }));
}

export function renderSession(container, { journeyId }) {
  let journey;
  let events = [];
  const draft = { audience: "", text: "" };
  const state = { links: null, requestMode: null, redraw: () => draw() };
  const loadLinks = () => api("/os/session/links", { officeId: session.officeId, journeyId }).then((res) => { state.links = res.links; draw(); }).catch(() => {});
  loadLinks();
  let deferred = false;
  let lastAwaiting = "";
  const draw = () => {
    // Never rebuild under the broker's cursor: a live update waits until typing stops.
    const active = document.activeElement;
    if (active && active.tagName === "TEXTAREA" && container.contains(active)) {
      if (!deferred) { deferred = true; active.addEventListener("blur", () => { deferred = false; setTimeout(draw, 150); }, { once: true }); }
      return;
    }
    const y = window.scrollY;
    clear(container);
    append(container, h("div", { class: "os-page-head" },
      h("button", { type: "button", class: "os-back", onClick: () => { rememberDeal(journeyId); back("tasks"); } }, ic("chev-right"), "رجوع"),
      h("h1", { class: "os-page-title", text: "غرفة التفاوض" }),
      h("button", { type: "button", class: "os-ref", onClick: () => go(`journey/${journeyId}`), text: "الفرصة" })));
    if (journey) append(container, dealFollowBar({ ...journey, journeyId }, { page: "session" }));
    if (journey === undefined) { append(container, h("div", { class: "os-skeleton" })); return; }
    if (!journey) { append(container, h("div", { class: "os-alert bad", text: "الصفقة غير موجودة." })); return; }
    const prices = sessionPrices(journey);
    const offer = journey.offerSummary || {};
    const cards = events.filter(isSessionEvent).map(brokerCard);
    const priceStatus = normalizePriceStatus(offer.priceStatus);
    const priv = journey.session?.privatePrices || {};
    const sideOf = (role) => ({ price: prices[role] || null, lastText: priv[role]?.price ? `للوسيط فقط: ${formatPrice(priv[role].price)}` : "" });
    const schema = roomSchema(journey);
    const ready = readiness(journey);
    const open = isOpenJourney(journey);
    // The reminder state of the links follows the negotiation: reload them when the awaited side changes.
    const awaiting = awaitingParties(journey).join(",");
    if (state.links && awaiting !== lastAwaiting) { lastAwaiting = awaiting; loadLinks(); } else lastAwaiting = awaiting;
    const record = recordById(journey.offerId) || {};
    const image = /^https?:\/\//.test(String(record.coverUrl || "")) ? record.coverUrl : "";
    const interventions = cards.filter((card) => card.intervention);
    append(container,
      roomPropertyCard({
        facts: propertyFacts(journey), image, propertyType: offer.propertyType,
        priceStatus, priceStatusLabel: PRICE_STATUS_LABEL[priceStatus], stageLabel: sessionStageLabel(journey),
        intervention: Boolean(journey.session?.intervention?.required), flagText: "تدخل مطلوب — راجع طلبات الطرفين أدناه"
      }),
      roomAgreedCard(roomAgreedItems(journey)),
      requestsCard(journey, state),
      h("section", { class: "os-card os-room-part os-deal-sides", "aria-label": "المالك مقابل العميل", "data-room-part": "versus", "data-room-family": schema.family, "data-room-deal": schema.deal },
        h("h2", { class: "os-h2 os-part-title" }, ic("swap"), "المالك مقابل العميل"),
        roomSidesCard({ sides: { owner: sideOf("owner"), client: sideOf("client") }, status: { owner: partyStatus(journey, "owner"), client: partyStatus(journey, "client") }, ready: { owner: ready.owner, client: ready.client }, viewer: "broker", priceLabel: schema.priceLabel }),
        h("div", { class: "os-room-block" },
          h("h3", {}, ic("clipboard"), `بنود الاتفاق — ${schema.familyLabel} · ${schema.dealLabel}`),
          roomTermsList(termRows(journey, "broker"), { viewer: "broker" }),
          h("small", { class: "os-sub", text: "البنود يتفق عليها الطرفان بالأزرار من رابطيهما. تدخّل برسالة عند الحاجة." }))),
      open ? linksCard(journey, state) : null,
      interventions.length ? h("details", { class: "os-card os-session-history os-deal-history", "data-broker-log": "" },
        h("summary", {}, ic("broker"), h("span", { text: "سجل تدخلات الوسيط" }), h("span", { class: "os-count", text: String(interventions.length) })),
        sessionEventList(interventions)) : null,
      historyDetails(cards, { emptyText: "لا توجد حركات بعد — أرسل الروابط للطرفين." }),
      open ? composer(journey, draft) : h("div", { class: "os-card" }, h("div", { class: "os-alert info", text: "أُغلقت الصفقة وتوقفت روابط الغرفة. السجل محفوظ." })));
    window.scrollTo({ top: y });
    if (state.requestMode) container.querySelector("textarea[name=requestText]")?.focus({ preventScroll: true });
  };
  const offs = [
    watchDoc(session.officeId, "journeys", journeyId, (doc) => { journey = doc; draw(); }, () => { journey = null; draw(); }),
    watchJourneyEvents(session.officeId, journeyId, (rows) => { events = rows; if (journey) draw(); })
  ];
  draw();
  return () => offs.forEach((off) => off && off());
}
