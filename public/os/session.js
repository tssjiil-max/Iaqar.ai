/**
 * غرفة التفاوض — the page behind /s#<token> for the owner or the client of ONE deal.
 * No account: the token (URL fragment, never sent to Hosting) is the key.
 *
 * Three parts: بيانات العقار · ما تم الاتفاق عليه · المالك مقابل العميل. What is shown and what
 * can be negotiated comes from the room rules of this property and deal (the server sends them).
 * A side answers with fixed buttons only; the typed values are a price in digits and — with
 * «طلب تدخل الوسيط» — a note that goes to the broker alone, never to the other side.
 * The page refreshes itself while open, so moves from the other side appear directly.
 */

import { h, ic, clear, append } from "./core/dom.js";
import { workerBase } from "./core/runtime.js";
import { formatDateTime, formatNumber, formatPrice } from "./domain/format-domain.js";
import { historyDetails, roomAgreedCard, roomPropertyCard, roomSidesCard, roomTermsList } from "./views/session-parts.js";

const root = document.getElementById("session-root");
const token = String(location.hash || "").replace(/^#/, "").trim();
const pageSession = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 20);
const POLL_MS = 5000;

let current = null;
let version = "";
// What the visitor has open right now. While anything is open the page is not redrawn under their hands.
let open = { typed: "", value: "", day: "", term: "", extra: "", note: "" };
const closed = () => ({ typed: "", value: "", day: "", term: "", extra: "", note: "" });
const anythingOpen = () => Boolean(open.typed || open.term || open.extra);
let busy = false;
let seq = 0;
// Why the last press was refused — kept across the redraw that follows, so the visitor reads it.
let flash = "";
// The room's main photo, fetched with this link (no record address in the page).
const photo = { version: "", url: "", loading: "" };

async function loadPhoto(version) {
  if (!version || photo.version === version || photo.loading === version) return;
  photo.loading = version;
  try {
    const response = await fetch(`${workerBase()}/os/session/image`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), referrerPolicy: "no-referrer" });
    if (!response.ok || !/^image\//.test(response.headers.get("content-type") || "")) return;
    const blob = await response.blob();
    if (photo.url) URL.revokeObjectURL(photo.url);
    photo.url = URL.createObjectURL(blob);
    photo.version = version;
    if (!anythingOpen()) render();
  } catch (_) {
    /* the room works without its photo */
  } finally {
    photo.loading = "";
  }
}

async function call(path, body) {
  const response = await fetch(`${workerBase()}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), referrerPolicy: "no-referrer"
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

function stateView(message, tone = "warn") {
  clear(root);
  append(root, h("main", { class: "os-app os-session-app" },
    h("header", { class: "os-session-head" }, h("h1", { class: "os-page-title", text: "غرفة التفاوض" })),
    h("div", { class: "os-card" }, h("div", { class: `os-alert ${tone}`, text: message }))));
}

function head(office = {}, session = {}) {
  const logo = office.logoUrl ? h("img", { src: office.logoUrl, alt: "" }) : h("img", { src: "/icons/iaqar-logo.png", alt: "iAqar.ai", class: "os-site-logo" });
  return h("header", { class: "os-session-head" },
    h("div", { class: "os-session-office" }, h("span", { class: "logo" }, logo), h("span", { text: office.officeName || "المكتب العقاري" })),
    h("h1", { class: "os-page-title", text: "غرفة التفاوض" }),
    h("span", { class: "os-ref", text: `أنت: ${session.roleLabel || ""}` }));
}

const ICON = { accept: "check-circle", minus2: "chev-down", minus5: "chev-down", plus2: "chev-up", plus5: "chev-up", compromise: "swap", manual: "edit", to_broker: "send", intervention: "alert", viewing_ok: "check-circle", viewing_other: "calendar", viewing_pick: "calendar", accept_fixed: "check-circle", decline_fixed: "x-circle", reject: "x-circle", adjust: "edit" };

function actionButton(action, onPick) {
  const b = h("button", { type: "button", class: `os-option os-session-act${action.id === "intervention" ? " alert" : ""}`, "data-session-action": action.id },
    ic(ICON[action.id] || action.icon || "check"),
    h("span", { text: action.label }),
    action.price ? h("small", { text: formatPrice(action.price) }) : null);
  b.addEventListener("click", () => onPick(action));
  return b;
}

const DAY_FMT = new Intl.DateTimeFormat("ar-SA", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Riyadh" });
const TIME_FMT = new Intl.DateTimeFormat("ar-SA", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Riyadh" });

/** Free 60-minute slots from the broker's calendar: pick a day, then an hour. No typing. */
function slotPanel(action, slots, onPick) {
  if (!slots.length) return h("p", { class: "os-sub", text: "لا توجد أوقات متاحة حاليًا — اضغط «طلب تدخل الوسيط» وسيتواصل معك." });
  const day = slots.find((d) => d.day === open.day) || slots[0];
  const days = h("div", { class: "os-slot-days", role: "group", "aria-label": "اليوم" }, slots.map((d) => {
    const b = h("button", { type: "button", class: "os-chip", "aria-pressed": String(d.day === day.day), "data-slot-day": d.day, text: DAY_FMT.format(new Date(d.slots[0])) });
    b.addEventListener("click", () => { open = { ...open, day: d.day }; render(); });
    return b;
  }));
  const times = h("div", { class: "os-slot-times", role: "group", "aria-label": "الساعة" }, day.slots.map((iso) => {
    const b = h("button", { type: "button", class: "os-option os-slot", "data-slot": iso, text: TIME_FMT.format(new Date(iso)) });
    b.addEventListener("click", () => onPick(action, iso));
    return b;
  }));
  return h("div", { class: "os-slot-picker" }, days, times);
}

function typedPanel(action, onSend) {
  const isDate = false;
  const input = isDate
    ? h("input", { class: "os-input", type: "datetime-local", name: "viewingAt", "aria-label": "الموعد المناسب لك" })
    : h("input", { class: "os-input", type: "text", inputmode: "numeric", name: "price", maxlength: "15", autocomplete: "off", placeholder: "مثال: 1,150,000", "aria-label": "السعر بالأرقام" });
  input.value = open.typed === action.id ? open.value : "";
  input.addEventListener("input", () => {
    if (!isDate) input.value = input.value.replace(/[^\d,٠-٩]/g, "");
    open.value = input.value;
  });
  input.addEventListener("blur", () => { if (!isDate && input.value) input.value = formatNumber(input.value) || input.value; });
  const send = h("button", { type: "button", class: "os-btn primary", "data-session-send": action.id }, ic("send"), action.id === "to_broker" ? "إرسال للوسيط" : "إرسال");
  send.addEventListener("click", () => onSend(action, input.value));
  return h("div", { class: `os-session-typed${isDate ? " is-date" : ""}` },
    h("label", { class: "os-field" }, h("span", { text: isDate ? "الموعد المناسب لك" : action.id === "to_broker" ? "السعر (يراه الوسيط فقط)" : "السعر بالأرقام فقط" }), input),
    send);
}

/** The step that is open for this side now (price or viewing) — the bar stays within reach. */
function actionsBar(session) {
  const bar = h("section", { class: "os-session-actions", "aria-label": "الإجراء المطلوب منك الآن" });
  const status = h("div", { class: "os-alert bad", role: "alert", hidden: true, "data-room-error": "" });
  const pick = async (action) => {
    if (action.typed || action.toggle) {
      open = { ...closed(), typed: open.typed === action.id ? "" : action.id };
      render();
      return;
    }
    await submit({ action: action.id }, status);
  };
  const usable = session.actions.filter((a) => a.id !== "intervention");
  const main = usable.filter((a) => a.group === "main" || (!a.group && !a.secondary));
  const adjust = usable.filter((a) => a.group === "adjust");
  if (session.note) append(bar, h("p", { class: "os-session-note", text: session.note }));
  if (session.viewingAt && (session.dealPhase === "VIEWING_SCHEDULING" || session.dealPhase === "VIEWING")) {
    append(bar, h("div", { class: "os-meta-row" }, ic("calendar"), h("span", {}, "الموعد المقترح: ", h("b", { text: formatDateTime(session.viewingAt) }))));
  }
  if (main.length) {
    append(bar, h("div", { class: `os-session-buttons n${Math.min(main.length, 3)}` }, main.map((a) => {
      const b = actionButton(a, pick);
      if (a.toggle || a.typed) b.setAttribute("aria-expanded", String(open.typed === a.id));
      return b;
    })));
  }
  const adjustOpen = open.typed === "adjust" || adjust.some((a) => a.id === open.typed);
  if (adjustOpen && adjust.length) {
    append(bar, h("div", { class: `os-session-buttons n${Math.min(adjust.filter((a) => !a.typed).length, 5) || 1}` },
      adjust.filter((a) => !a.typed).map((a) => actionButton(a, pick))));
    append(bar, h("div", { class: "os-session-secondary" }, adjust.filter((a) => a.typed).map((a) => {
      const b = h("button", { type: "button", class: "os-btn soft", "aria-expanded": String(open.typed === a.id), "data-session-action": a.id }, ic(ICON[a.id]), a.label);
      b.addEventListener("click", () => pick(a));
      return b;
    })));
  }
  const typedSlot = usable.find((a) => a.id === open.typed && a.typed === "slot");
  if (typedSlot) append(bar, slotPanel(typedSlot, session.slots || [], (action, iso) => submit({ action: action.id, viewingAt: iso }, status)));
  const typed = usable.find((a) => a.id === open.typed && a.typed && a.typed !== "slot");
  if (typed) append(bar, typedPanel(typed, (action, value) => submit({ action: action.id, price: value }, status)));
  append(bar, status);
  return main.length || session.note ? bar : null;
}

/**
 * Part 3 — «المالك مقابل العميل»: the two sides facing each other, then the terms of this
 * property (buttons only), then: طلب معلومات · جاهز للاتفاق · طلب تدخل الوسيط.
 */
function versusCard(session, live) {
  const room = session.room || {};
  const status = h("div", { class: "os-alert bad", role: "alert", hidden: true, "data-room-error": "" });
  const card = h("section", { class: "os-card os-room-part os-deal-sides", "aria-label": "المالك مقابل العميل", "data-room-part": "versus" },
    h("h2", { class: "os-h2 os-part-title" }, ic("swap"), "المالك مقابل العميل"),
    roomSidesCard({
      sides: session.sides || {}, status: room.status || {}, viewer: session.role, priceLabel: room.priceLabel || "السعر",
      ready: { [session.role]: room.ready?.mine, [session.role === "owner" ? "client" : "owner"]: room.ready?.other }
    }));
  if (room.terms?.length) {
    append(card, h("div", { class: "os-room-block" },
      h("h3", {}, ic("clipboard"), `بنود الاتفاق — ${room.familyLabel || "العقار"} · ${room.dealLabel || ""}`),
      roomTermsList(room.terms, {
        viewer: session.role, openTerm: open.term,
        onToggle: live ? (id) => { open = { ...closed(), term: open.term === id ? "" : id }; render(); } : null,
        onAction: live ? (action, row, optionId) => submit({ action, termId: row.id, optionId }, status) : null
      })));
  }
  if (live) {
    const toggle = (name) => { open = { ...closed(), extra: open.extra === name ? "" : name, note: open.note }; render(); };
    const info = room.infoTopics?.length ? h("button", { type: "button", class: "os-btn soft", "data-room-extra": "info", "aria-expanded": String(open.extra === "info") }, ic("question"), "طلب معلومات") : null;
    info?.addEventListener("click", () => toggle("info"));
    const ready = room.canReady ? h("button", { type: "button", class: "os-btn soft", "data-room-extra": "ready" }, ic("handshake"), "جاهز للاتفاق") : null;
    ready?.addEventListener("click", () => submit({ action: "ready" }, status));
    const broker = h("button", { type: "button", class: "os-btn soft", "data-room-extra": "broker", "aria-expanded": String(open.extra === "broker"), disabled: room.canRequest ? null : true }, ic("alert"), "طلب تدخل الوسيط");
    broker.addEventListener("click", () => toggle("broker"));
    const block = h("div", { class: "os-room-block" }, h("div", { class: "os-room-extra" }, info, ready, broker));
    if (open.extra === "info") {
      append(block, h("div", { class: "os-room-panel", "data-room-panel": "info" },
        h("small", { class: "os-sub", text: "اختر المعلومة التي تحتاجها. يصل طلبك إلى الوسيط، وهو من يرد عليك." }),
        h("div", { class: "os-term-options", role: "group", "aria-label": "المعلومة المطلوبة" }, room.infoTopics.map((topic) => {
          const b = h("button", { type: "button", class: "os-chip", "data-info-topic": topic.id, text: topic.label });
          b.addEventListener("click", () => submit({ action: "info_request", topicId: topic.id }, status));
          return b;
        }))));
    }
    if (open.extra === "broker") {
      const note = h("textarea", { class: "os-textarea", maxlength: "500", name: "brokerNote", placeholder: "اكتب ما تريد إيصاله للوسيط (اختياري)…", "aria-label": "رسالتك للوسيط" });
      note.value = open.note || "";
      note.addEventListener("input", () => { open.note = note.value; });
      const send = h("button", { type: "button", class: "os-btn primary", "data-room-send": "broker" }, ic("send"), "إرسال للوسيط");
      send.addEventListener("click", () => submit({ action: "intervention", message: note.value }, status));
      append(block, h("div", { class: "os-room-panel", "data-room-panel": "broker" },
        h("small", { class: "os-sub", text: "تصل رسالتك إلى الوسيط فقط. لا تُرسل للطرف الآخر إلا إذا رأى الوسيط ذلك." }),
        note, send));
    }
    if (!room.canRequest) append(block, h("small", { class: "os-sub", text: "لديك طلبات لدى الوسيط لم تُعالج بعد — سيتابعها معك." }));
    append(card, block);
  }
  if (room.requests?.length) {
    append(card, h("div", { class: "os-room-block" },
      h("h3", {}, ic("broker"), "طلباتك للوسيط"),
      h("ul", { class: "os-room-requests", "data-room-requests": "" }, room.requests.map((item) => h("li", { "data-room-request": item.id, "data-request-open": String(item.open) },
        h("b", { text: item.topic ? `${item.kindLabel}: ${item.topic}` : item.kindLabel }),
        item.text ? h("span", { text: item.text, dir: "auto" }) : null,
        h("small", { text: item.statusLabel }))))));
  }
  append(card, status);
  return card;
}

async function submit(fields, status) {
  if (busy) return;
  busy = true;
  status.hidden = true;
  const lock = (on) => root.querySelectorAll(".os-session-actions button, [data-room-part] button").forEach((b) => { if (on) b.dataset.locked = b.disabled ? "keep" : "1"; if (b.dataset.locked !== "keep") b.disabled = on; });
  lock(true);
  try {
    seq += 1;
    const body = { token, ...fields, submissionId: `${pageSession}${seq}${String(fields.action).replace(/[^a-z0-9]/gi, "")}`.slice(0, 64) };
    const { status: code, payload } = await call("/os/session/act", body);
    if (payload.ok) {
      open = closed();
      flash = "";
      await refresh(true);
      return;
    }
    if (payload.state && payload.state !== "ACTIVE") { stateView(payload.message || "هذا الرابط لم يعد يعمل."); return; }
    const message = payload.message || (code === 429 ? "طلبات كثيرة — حاول بعد قليل." : "تعذر الإرسال — حاول مجددًا.");
    status.textContent = message;
    status.hidden = false;
    if (code === 409) {
      // The room changed under this page: show the current state and say why the press was refused. A typed note is kept.
      flash = message;
      open = fields.action === "intervention" ? { ...closed(), extra: "broker", note: open.note } : closed();
      await refresh(true);
    }
  } catch (_) {
    status.textContent = "تعذر الاتصال — تحقق من الإنترنت وحاول مجددًا.";
    status.hidden = false;
  } finally {
    busy = false;
    lock(false);
  }
}

function render() {
  if (!current) return;
  const { office, session } = current;
  const room = session.room || {};
  const live = current.state !== "CLOSED";
  const y = window.scrollY;
  clear(root);
  loadPhoto(room.imageVersion || "");
  const notice = flash ? h("div", { class: "os-alert bad", role: "alert", "data-room-flash": "" }, h("span", { text: flash })) : null;
  if (notice) {
    const dismiss = h("button", { type: "button", class: "os-icon-btn", "aria-label": "إخفاء التنبيه" }, ic("x"));
    dismiss.addEventListener("click", () => { flash = ""; notice.remove(); });
    notice.append(dismiss);
  }
  const main = h("main", { class: "os-app os-session-app os-room", "data-room-family": room.family || "", "data-room-deal": room.deal || "" },
    head(office, session),
    notice,
    roomPropertyCard({
      facts: room.facts || [], image: room.imageVersion && photo.version === room.imageVersion ? photo.url : "", propertyType: session.property?.propertyType,
      priceStatus: session.property?.priceStatus, priceStatusLabel: session.property?.priceStatusLabel,
      description: session.property?.description, stageLabel: session.stageLabel, intervention: session.intervention
    }),
    roomAgreedCard(room.agreed || []),
    versusCard(session, live),
    historyDetails(session.events, { emptyText: "لا توجد حركات بعد.", note: "لا تظهر بيانات التواصل أو الأسماء بين الطرفين. كل خطوة تُحفظ في السجل." }),
    live ? actionsBar(session) : h("div", { class: "os-card" }, h("div", { class: "os-alert info", text: current.message || "انتهت غرفة التفاوض لهذه الصفقة." })));
  append(root, main);
  window.scrollTo({ top: y });
  if (open.extra === "broker") root.querySelector("textarea[name=brokerNote]")?.focus({ preventScroll: true });
}

async function refresh(force = false) {
  const { payload } = await call("/os/session/view", { token });
  if (!payload.ok) {
    // A busy or failing server is not an invalid link: keep the room on screen and try again at the next refresh.
    if (!payload.state && current) return true;
    version = "";
    stateView(payload.message || "هذا الرابط غير صالح.", payload.state === "REPLACED" ? "info" : "warn");
    return false;
  }
  const room = payload.session?.room || {};
  const next = `${payload.state}|${payload.session?.version}|${JSON.stringify([payload.session?.actions || [], room.terms || [], room.agreed || [], room.status || {}, room.ready || {}, room.requests || [], room.canReady, room.canRequest])}`;
  if (force || next !== version) {
    version = next;
    current = payload;
    render();
  }
  return true;
}

async function start() {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { stateView("هذا الرابط غير صالح. تواصل مع المكتب للحصول على رابط جديد."); return; }
  try {
    if (!(await refresh(true))) return;
  } catch (_) {
    clear(root);
    append(root, h("main", { class: "os-app os-session-app" }, h("div", { class: "os-card" },
      h("div", { class: "os-alert warn", text: "تعذر تحميل غرفة التفاوض — تحقق من الاتصال ثم أعد المحاولة." }),
      h("button", { type: "button", class: "os-btn secondary block", style: { marginTop: "10px" }, onClick: start }, ic("refresh"), "إعادة المحاولة"))));
    return;
  }
  // Live: the other side's moves appear without reloading (only while the page is visible).
  setInterval(() => {
    if (document.visibilityState === "visible" && !busy && !anythingOpen() && current?.state === "ACTIVE") refresh().catch(() => {});
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !anythingOpen()) refresh().catch(() => {}); });
}

window.addEventListener("hashchange", () => location.reload());
start();
