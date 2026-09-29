/**
 * Lightweight reply page. Reads the token from the URL fragment, asks the Worker
 * for this proposal's public view (office identity + what this recipient needs to
 * see, nothing about the other party), and saves the chosen reply server-side.
 */

import { h, ic, clear, append } from "./core/dom.js";
import { workerBase } from "./core/runtime.js";
import { formatDateTime, formatNumber } from "./domain/format-domain.js";

const root = document.getElementById("reply-root");
const token = String(location.hash || "").replace(/^#/, "").trim();
const pageSession = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 24);

async function call(path, body) {
  const response = await fetch(`${workerBase()}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), referrerPolicy: "no-referrer"
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

function officeCard(office = {}) {
  const logo = office.logoUrl ? h("img", { src: office.logoUrl, alt: "" }) : ic("building");
  return h("div", { class: "os-public-hero", style: { paddingTop: "8px" } },
    h("div", { class: "os-public-logo", style: { width: "72px", height: "72px" } }, logo),
    h("h1", { class: "os-public-title", style: { fontSize: "1.35rem" }, text: office.officeName || "المكتب العقاري" }),
    h("div", { class: "os-license" },
      office.brokerName ? h("span", { text: `الوسيط: ${office.brokerName}` }) : null,
      office.licenseNumber ? h("span", { text: `رخصة فال: ${office.licenseNumber}` }) : null));
}

function page(...children) {
  clear(root);
  append(root, h("main", { class: "os-app", style: { maxWidth: "560px" } }, ...children));
}

function stateView(data) {
  const tone = data.state === "SUPERSEDED" ? "info" : data.state === "LOCKED" ? "ok" : "warn";
  page(officeCard(data.office),
    h("div", { class: "os-card" },
      h("div", { class: `os-alert ${tone}`, text: data.message || "هذا الرابط غير متاح." }),
      data.reply ? h("p", { class: "os-sub", style: { marginTop: "10px" }, text: `ردك المسجّل: ${data.reply.label}` }) : null));
}

function savedView(data, view) {
  page(officeCard(view.office),
    h("div", { class: "os-card", style: { textAlign: "center" } },
      h("div", { class: "os-task-icon", style: { margin: "0 auto 8px", background: "var(--ok-tint)", color: "var(--ok)" } }, ic("check-circle")),
      h("h2", { class: "os-h2", style: { justifyContent: "center" }, text: "تم حفظ ردك" }),
      h("p", { style: { margin: "6px 0" } }, h("b", { text: data.reply?.label || "" })),
      h("p", { class: "os-sub", text: "وصل ردك إلى الوسيط، وسيتواصل معك. ردك مبدئي ولا يُعد التزامًا نهائيًا." }),
      data.editable ? h("button", { type: "button", class: "os-btn ghost", onClick: () => formView({ ...view, reply: data.reply }) }, ic("edit"), "تعديل الرد") : null));
}

function formView(view) {
  const proposal = view.proposal;
  let chosen = null;
  const extra = h("div", { class: "os-field", hidden: true });
  const extraInput = h("input", { class: "os-input", name: "text", maxlength: "300" });
  const extraLabel = h("span");
  append(extra, extraLabel, extraInput);
  const status = h("div", { class: "os-alert bad", role: "alert", hidden: true });
  const submit = h("button", { type: "button", class: "os-btn primary block", disabled: true }, ic("send"), "إرسال الرد");
  const options = h("div", { class: "os-options", role: "group", "aria-label": "خيارات الرد" });
  const ICON = { positive: "check-circle", negative: "x-circle", neutral: "clock" };
  for (const option of proposal.options) {
    const b = h("button", { type: "button", class: `os-option ${option.tone || ""}`, "aria-pressed": "false", "data-option": option.id }, ic(ICON[option.tone] || "check"), option.label);
    b.addEventListener("click", () => {
      chosen = option;
      options.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      extra.hidden = !option.needsText;
      extraLabel.textContent = option.textLabel || "اكتب ردك";
      extraInput.inputMode = option.textKind === "price" ? "numeric" : "text";
      extraInput.placeholder = option.textKind === "price" ? "مثال: 1,150,000" : "";
      submit.disabled = false;
      if (option.needsText) extraInput.focus();
    });
    append(options, b);
  }
  extraInput.addEventListener("blur", () => { if (chosen?.textKind === "price" && extraInput.value) extraInput.value = formatNumber(extraInput.value) || extraInput.value; });
  let sending = false;
  submit.addEventListener("click", async () => {
    if (!chosen || sending) return;
    sending = true;
    status.hidden = true;
    submit.setAttribute("aria-busy", "true");
    try {
      const { status: code, payload } = await call("/os/reply/submit", {
        token, optionId: chosen.id, text: chosen.needsText ? extraInput.value : "", submissionId: `${pageSession}${chosen.id.replace(/[^A-Za-z0-9]/g, "")}`.slice(0, 64)
      });
      if (payload.ok && payload.state === "SAVED") { savedView(payload, view); return; }
      if (payload.state && payload.state !== "ACTIVE") { stateView({ ...payload, office: view.office }); return; }
      status.textContent = payload.message || (code === 429 ? "طلبات كثيرة — حاول بعد قليل." : "تعذر حفظ الرد — حاول مجددًا.");
      status.hidden = false;
    } catch (_) {
      status.textContent = "تعذر الاتصال — تحقق من الإنترنت وحاول مجددًا. لن يُفقد اختيارك.";
      status.hidden = false;
    } finally {
      sending = false;
      submit.removeAttribute("aria-busy");
    }
  });
  page(officeCard(view.office),
    h("div", { class: "os-card" },
      h("span", { class: "os-badge", text: proposal.label }),
      h("h2", { class: "os-task-title", text: proposal.propertyLine }),
      h("div", { class: "os-form", style: { marginTop: "8px" } }, proposal.lines.map((line) => h("div", { class: "os-meta-row" }, ic(line.label.includes("موعد") ? "calendar" : line.label.includes("السعر") ? "coins" : "note"), h("span", {}, `${line.label}: `, h("b", { text: line.value })))))),
    h("div", { class: "os-card" },
      h("h3", { class: "os-h2", style: { marginBottom: "10px" }, text: view.reply ? "عدّل ردك" : "اختر ردك" }),
      view.reply ? h("p", { class: "os-sub", style: { marginBottom: "8px" }, text: `ردك الحالي: ${view.reply.label}` }) : null,
      options, h("div", { style: { marginTop: "10px" } }, extra), status, h("div", { style: { marginTop: "12px" } }, submit),
      h("p", { class: "os-sub", style: { fontSize: ".82rem", marginTop: "8px", textAlign: "center" }, text: `الرد مبدئي، وسيؤكد معك الوسيط أي التزام.${proposal.expiresAt ? ` صالح حتى ${formatDateTime(proposal.expiresAt)}.` : ""}` })));
}

async function start() {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    stateView({ state: "INVALID", message: "هذا الرابط غير صالح. تواصل مع المكتب للحصول على رابط جديد." });
    return;
  }
  try {
    const { payload } = await call("/os/reply/view", { token });
    if (!payload.ok || payload.state !== "ACTIVE") { stateView(payload); return; }
    formView(payload);
  } catch (_) {
    page(h("div", { class: "os-card" }, h("div", { class: "os-alert warn", text: "تعذر تحميل المقترح — تحقق من الاتصال ثم أعد المحاولة." }),
      h("button", { type: "button", class: "os-btn secondary block", style: { marginTop: "10px" }, onClick: start }, ic("refresh"), "إعادة المحاولة")));
  }
}

// A second reply link opened in the same tab changes only the fragment: reload so the
// page always shows the proposal of the link the recipient actually opened.
window.addEventListener("hashchange", () => location.reload());

start();
