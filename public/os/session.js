/**
 * جلسة التفاوض — the page behind /s#<token> for the owner or the client.
 * No account: the token (URL fragment, never sent to Hosting) is the key. Only fixed
 * buttons; the only typed value is a price in digits (or a viewing time).
 * The page refreshes itself while open, so moves from the other side appear directly.
 */

import { h, ic, clear, append } from "./core/dom.js";
import { workerBase } from "./core/runtime.js";
import { formatDateTime, formatNumber, formatPrice } from "./domain/format-domain.js";
import { sessionEventList, sessionSummary } from "./views/session-parts.js";

const root = document.getElementById("session-root");
const token = String(location.hash || "").replace(/^#/, "").trim();
const pageSession = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 20);
const POLL_MS = 5000;

let current = null;
let version = "";
let open = { typed: "", value: "" };
let busy = false;
let seq = 0;

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
    h("header", { class: "os-session-head" }, h("h1", { class: "os-page-title", text: "جلسة التفاوض" })),
    h("div", { class: "os-card" }, h("div", { class: `os-alert ${tone}`, text: message }))));
}

function head(office = {}, session = {}) {
  const logo = office.logoUrl ? h("img", { src: office.logoUrl, alt: "" }) : ic("building");
  return h("header", { class: "os-session-head" },
    h("div", { class: "os-session-office" }, h("span", { class: "logo" }, logo), h("span", { text: office.officeName || "المكتب العقاري" })),
    h("h1", { class: "os-page-title", text: "جلسة التفاوض" }),
    h("span", { class: "os-ref", text: `أنت: ${session.roleLabel || ""}` }));
}

const ICON = { accept: "check-circle", minus2: "chev-down", minus5: "chev-down", plus2: "chev-up", plus5: "chev-up", compromise: "swap", manual: "edit", to_broker: "send", intervention: "alert", viewing_ok: "check-circle", viewing_other: "calendar" };

function actionButton(action, onPick) {
  const b = h("button", { type: "button", class: `os-option os-session-act${action.id === "intervention" ? " alert" : ""}`, "data-session-action": action.id },
    ic(ICON[action.id] || action.icon || "check"),
    h("span", { text: action.label }),
    action.price ? h("small", { text: formatPrice(action.price) }) : null);
  b.addEventListener("click", () => onPick(action));
  return b;
}

function typedPanel(action, onSend) {
  const isDate = action.id === "viewing_other";
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

function actionsBar(session) {
  const bar = h("section", { class: "os-session-actions", "aria-label": "الإجراءات المتاحة الآن" });
  const status = h("div", { class: "os-alert bad", role: "alert", hidden: true });
  const pick = async (action) => {
    if (action.typed) {
      open = { typed: open.typed === action.id ? "" : action.id, value: "" };
      render();
      return;
    }
    await submit(action, "", status);
  };
  const primary = session.actions.filter((a) => !a.secondary);
  const secondary = session.actions.filter((a) => a.secondary);
  if (session.note) append(bar, h("p", { class: "os-session-note", text: session.note }));
  if (session.phase === "VIEWING" && session.viewingAt) append(bar, h("div", { class: "os-meta-row" }, ic("calendar"), h("span", {}, "الموعد المقترح: ", h("b", { text: formatDateTime(session.viewingAt) }))));
  if (primary.length) append(bar, h("div", { class: `os-session-buttons n${Math.min(primary.length, 5)}` }, primary.map((a) => actionButton(a, pick))));
  if (secondary.length) {
    append(bar, h("div", { class: "os-session-secondary" }, secondary.map((a) => {
      const b = h("button", { type: "button", class: "os-btn soft", "aria-expanded": String(open.typed === a.id), "data-session-action": a.id }, ic(ICON[a.id]), a.label);
      b.addEventListener("click", () => pick(a));
      return b;
    })));
  }
  const typed = session.actions.find((a) => a.id === open.typed && a.typed);
  if (typed) append(bar, typedPanel(typed, (action, value) => submit(action, value, status)));
  append(bar, status);
  return bar;
}

async function submit(action, value, status) {
  if (busy) return;
  busy = true;
  status.hidden = true;
  root.querySelectorAll(".os-session-actions button").forEach((b) => { b.disabled = true; });
  try {
    seq += 1;
    const body = { token, action: action.id, submissionId: `${pageSession}${seq}${action.id.replace(/[^a-z0-9]/gi, "")}`.slice(0, 64) };
    if (action.id === "viewing_other") body.viewingAt = value;
    else if (action.typed) body.price = value;
    const { status: code, payload } = await call("/os/session/act", body);
    if (payload.ok) {
      open = { typed: "", value: "" };
      await refresh(true);
      return;
    }
    if (payload.state && payload.state !== "ACTIVE") { stateView(payload.message || "هذا الرابط لم يعد يعمل."); return; }
    status.textContent = payload.message || (code === 429 ? "طلبات كثيرة — حاول بعد قليل." : "تعذر الإرسال — حاول مجددًا.");
    status.hidden = false;
    if (code === 409) await refresh(true);
  } catch (_) {
    status.textContent = "تعذر الاتصال — تحقق من الإنترنت وحاول مجددًا.";
    status.hidden = false;
  } finally {
    busy = false;
    root.querySelectorAll(".os-session-actions button").forEach((b) => { b.disabled = false; });
  }
}

function render() {
  if (!current) return;
  const { office, session } = current;
  const y = window.scrollY;
  clear(root);
  const main = h("main", { class: "os-app os-session-app" },
    head(office, session),
    sessionSummary({
      propertyType: session.property.propertyType, district: session.property.district,
      currentPrice: session.currentPrice, agreedPrice: session.agreedPrice, stageLabel: session.stageLabel, intervention: session.intervention
    }),
    h("section", { class: "os-card os-session-history", "aria-label": "سجل الجلسة" },
      h("h2", { class: "os-h2" }, ic("clock"), "سجل الجلسة"),
      sessionEventList(session.events, { emptyText: "لا توجد حركات بعد — ابدأ بالرد على السعر." }),
      h("p", { class: "os-sub os-session-privacy", text: "لا تظهر بيانات التواصل أو الأسماء بين الطرفين. ردودك مبدئية ويؤكدها الوسيط." })),
    current.state === "CLOSED"
      ? h("div", { class: "os-card" }, h("div", { class: "os-alert info", text: current.message || "انتهت جلسة التفاوض." }))
      : actionsBar(session));
  append(root, main);
  window.scrollTo({ top: y });
}

async function refresh(force = false) {
  const { payload } = await call("/os/session/view", { token });
  if (!payload.ok) { stateView(payload.message || "هذا الرابط غير صالح.", payload.state === "REPLACED" ? "info" : "warn"); return false; }
  const next = `${payload.state}|${payload.session?.version}|${JSON.stringify(payload.session?.actions || [])}`;
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
      h("div", { class: "os-alert warn", text: "تعذر تحميل الجلسة — تحقق من الاتصال ثم أعد المحاولة." }),
      h("button", { type: "button", class: "os-btn secondary block", style: { marginTop: "10px" }, onClick: start }, ic("refresh"), "إعادة المحاولة"))));
    return;
  }
  // Live: the other side's moves appear without reloading (only while the page is visible).
  setInterval(() => {
    if (document.visibilityState === "visible" && !busy && !open.typed && current?.state === "ACTIVE") refresh().catch(() => {});
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !open.typed) refresh().catch(() => {}); });
}

window.addEventListener("hashchange", () => location.reload());
start();
