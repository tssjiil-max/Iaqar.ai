/**
 * «أدوات المكتب» screens: النماذج · الدليل · الخدمات · الحاسبة · السوق.
 * («ملفاتي» opens the existing office library.) Everything shown comes from the office's own
 * profile and records; nothing is sent anywhere by these screens.
 */

import { h, ic, clear, append, emptyState } from "../core/dom.js";
import { back, go } from "../core/nav.js";
import { session } from "../core/session.js";
import { state, subscribe } from "../core/state.js";
import { openWhatsApp, toast } from "../core/ui.js";
import { formatPrice } from "../domain/format-domain.js";
import {
  CALC_DEFAULTS, CALC_KINDS, GUIDE_STEPS, OFFICIAL_SERVICES, TEMPLATE_GROUPS,
  calculateDeal, formatMoney, marketSnapshot, officeToolById, templatesFor
} from "../domain/office-tools-domain.js";
import { officePublicLink } from "./shell.js";

function pageHead(title) {
  return h("div", { class: "os-page-head" },
    h("button", { type: "button", class: "os-back", onClick: () => back("office") }, ic("chev-right"), "رجوع"),
    h("h1", { class: "os-page-title", text: title }), h("span"));
}

function sectionTitle(text, sub = "") {
  return h("div", { class: "os-tool-heading" }, h("h2", { class: "os-h2", text }), sub ? h("p", { class: "os-sub", text: sub }) : null);
}

// ------------------------------------------------------------------ النماذج

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("تم نسخ النص", "ok");
  } catch (_) {
    toast("تعذر النسخ — حدّد النص وانسخه يدويًا", "bad");
  }
}

async function shareText(text) {
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (error) { if (error?.name === "AbortError") return; }
  }
  // The broker chooses the recipient inside WhatsApp; the system never sends by itself.
  openWhatsApp(`https://wa.me/?text=${encodeURIComponent(text)}`);
}

function renderForms(container) {
  const office = session.office || {};
  const context = {
    officeName: office.officeName || "مكتبنا العقاري",
    brokerName: office.brokerName || session.member?.displayName || "الوسيط",
    licenseNumber: office.licenseNumber || office.falLicenseNumber || "",
    officeLink: officePublicLink()
  };
  let group = TEMPLATE_GROUPS[0].id;
  const tabs = h("div", { class: "os-seg", role: "group", "aria-label": "نوع النموذج" });
  const list = h("div", { class: "os-tool-list", "data-tool-templates": "" });
  const draw = () => {
    clear(tabs);
    for (const item of TEMPLATE_GROUPS) {
      tabs.append(h("button", { type: "button", "aria-pressed": String(group === item.id), "data-template-group": item.id, text: item.label, onClick: () => { group = item.id; draw(); } }));
    }
    clear(list);
    for (const template of templatesFor(context).filter((t) => t.group === group)) {
      const text = h("textarea", { class: "os-textarea os-template-text", rows: "6", "aria-label": template.title, "data-template-text": template.id });
      text.value = template.text;
      list.append(h("article", { class: "os-card os-template", "data-template": template.id },
        h("h3", { class: "os-h2", text: template.title }),
        text,
        h("div", { class: "os-btn-row" },
          h("button", { type: "button", class: "os-btn primary", "data-template-share": "", onClick: () => shareText(text.value.trim()) }, ic("whatsapp"), "مشاركة"),
          h("button", { type: "button", class: "os-btn secondary", "data-template-copy": "", onClick: () => copyText(text.value.trim()) }, ic("clipboard"), "نسخ"))));
    }
  };
  append(container, pageHead("النماذج"),
    h("p", { class: "os-sub os-tool-intro", text: "رسائل جاهزة باسم مكتبك. عدّل النص كما تشاء ثم انسخه أو شاركه — لا يُرسل شيء تلقائيًا." }),
    tabs, list);
  draw();
  return null;
}

// ------------------------------------------------------------------- الدليل

function renderGuide(container) {
  const steps = GUIDE_STEPS.filter((step) => !step.managerOnly || session.isManager);
  append(container, pageHead("الدليل"),
    h("p", { class: "os-sub os-tool-intro", text: "مسار العمل في مكتبك خطوة بخطوة. اضغط أي خطوة لتنتقل إلى مكانها." }),
    h("ol", { class: "os-guide", "data-tool-guide": "" }, steps.map((step, index) =>
      h("li", { class: "os-card os-guide-step", "data-guide-step": step.id },
        h("span", { class: "os-guide-num", text: String(index + 1) }),
        h("div", { class: "os-guide-copy" }, h("b", { text: step.title }), h("p", { class: "os-sub", text: step.text })),
        h("button", { type: "button", class: "os-btn secondary", onClick: () => go(step.route) }, h("span", { text: step.action }), ic("chev-left"))))));
  return null;
}

// ------------------------------------------------------------------ الخدمات

function renderServices(container) {
  append(container, pageHead("الخدمات"),
    h("p", { class: "os-sub os-tool-intro", text: "روابط المنصات الرسمية. تُفتح خارج التطبيق، ولا يتبادل المكتب معها أي بيانات." }),
    h("section", { class: "os-card os-set-list", "data-tool-services": "" }, OFFICIAL_SERVICES.map((service) =>
      h("a", { class: "os-set-row os-service-row", href: service.url, target: "_blank", rel: "noopener noreferrer", "data-service": service.id },
        h("span", { class: "os-set-icon" }, ic("link")),
        h("span", { class: "os-set-text" }, h("b", { text: service.name }), h("small", { text: service.hint })),
        ic("chev-left")))));
  return null;
}

// ------------------------------------------------------------------ الحاسبة

function renderCalculator(container) {
  let kind = CALC_KINDS[0].id;
  const tabs = h("div", { class: "os-seg", role: "group", "aria-label": "نوع الصفقة" });
  const amount = h("input", { class: "os-input", name: "amount", inputmode: "numeric", dir: "ltr", placeholder: "0", "aria-label": "المبلغ" });
  const rate = (name, value) => { const el = h("input", { class: "os-input", name, inputmode: "decimal", dir: "ltr" }); el.value = String(value); return el; };
  const commission = rate("commissionPercent", CALC_DEFAULTS.commissionPercent);
  const vat = rate("vatPercent", CALC_DEFAULTS.vatPercent);
  const transfer = rate("transferTaxPercent", CALC_DEFAULTS.transferTaxPercent);
  const amountLabel = h("span");
  const transferField = h("label", { class: "os-field" }, h("span", { text: "ضريبة التصرفات العقارية %" }), transfer);
  const error = h("small", { class: "os-field-error", role: "alert", "data-calc-error": "" });
  const result = h("section", { class: "os-card os-calc-result", "data-calc-result": "", "aria-live": "polite" });

  const draw = () => {
    clear(tabs);
    for (const item of CALC_KINDS) {
      tabs.append(h("button", { type: "button", "aria-pressed": String(kind === item.id), "data-calc-kind": item.id, text: item.label, onClick: () => { kind = item.id; draw(); } }));
    }
    amountLabel.textContent = CALC_KINDS.find((k) => k.id === kind).amountLabel;
    transferField.hidden = kind !== "sale";
    const calc = calculateDeal({ kind, amount: amount.value, commissionPercent: commission.value, vatPercent: vat.value, transferTaxPercent: transfer.value });
    clear(result);
    error.textContent = amount.value.trim() && !calc.ok ? calc.errors.amount || "" : "";
    if (!calc.ok) {
      result.append(h("p", { class: "os-sub", text: "اكتب المبلغ لتظهر التفاصيل." }));
      return;
    }
    for (const row of calc.rows) {
      result.append(h("div", { class: `os-calc-row${row.strong ? " strong" : ""}`, "data-calc-row": row.id }, h("span", { text: row.label }), h("b", { dir: "ltr", text: formatMoney(row.value) })));
    }
  };
  for (const el of [amount, commission, vat, transfer]) el.addEventListener("input", draw);

  append(container, pageHead("الحاسبة"),
    h("p", { class: "os-sub os-tool-intro", text: "حساب تقديري للسعي والضريبة. النِّسب قابلة للتعديل، والأرقام النهائية تُعتمد من الجهات الرسمية." }),
    tabs,
    h("section", { class: "os-card os-form" },
      h("label", { class: "os-field" }, amountLabel, amount, error),
      h("div", { class: "os-row2" },
        h("label", { class: "os-field" }, h("span", { text: "نسبة السعي %" }), commission),
        h("label", { class: "os-field" }, h("span", { text: "ضريبة القيمة المضافة %" }), vat)),
      transferField),
    result);
  draw();
  return null;
}

// -------------------------------------------------------------------- السوق

function renderMarket(container) {
  const body = h("div", { "data-tool-market": "" });
  const stat = (label, value, id) => h("div", { class: "os-market-stat", "data-market-stat": id }, h("b", { text: String(value) }), h("small", { text: label }));
  const draw = () => {
    clear(body);
    if (!state.recordsReady) { append(body, h("div", { class: "os-skeleton" }), h("div", { class: "os-skeleton" })); return; }
    const snap = marketSnapshot(state.records);
    if (!snap.total) {
      append(body, h("div", { class: "os-card" }, emptyState("chart-up", "لا توجد بيانات بعد", "أضف عروضًا وطلبات لتظهر مؤشرات مكتبك هنا.",
        h("button", { type: "button", class: "os-btn secondary", onClick: () => go("repo") }, ic("plus-circle"), "إضافة عرض أو طلب"))));
      return;
    }
    append(body,
      h("section", { class: "os-card os-market-stats" }, stat("سجل نشط", snap.total, "total"), stat("عرض", snap.offers, "offers"), stat("طلب", snap.requests, "requests")),
      h("section", { class: "os-card" }, sectionTitle("متوسط الأسعار حسب النوع", "متوسط سعر العروض ومتوسط ميزانية الطلبات"),
        h("div", { class: "os-market-table", role: "table" },
          h("div", { class: "os-market-row head", role: "row" }, h("span", { text: "النوع" }), h("span", { text: "العروض" }), h("span", { text: "الطلبات" })),
          snap.byType.map((row) => h("div", { class: "os-market-row", role: "row", "data-market-type": row.key },
            h("span", {}, h("b", { text: row.propertyType }), h("small", { text: row.txLabel })),
            h("span", {}, h("b", { text: row.avgOffer ? formatPrice(row.avgOffer) : "—" }), h("small", { text: `${row.offers} عرض` })),
            h("span", {}, h("b", { text: row.avgBudget ? formatPrice(row.avgBudget) : "—" }), h("small", { text: `${row.requests} طلب` })))))),
      h("section", { class: "os-card" }, sectionTitle("طلبات بلا عرض مطابق", "أحياء فيها طلب لدى مكتبك ولا يوجد عرض نشط من النوع نفسه"),
        snap.gaps.length
          ? h("ul", { class: "os-list os-market-gaps" }, snap.gaps.slice(0, 12).map((gap) => h("li", { "data-market-gap": gap.key }, ic("pin"),
            h("span", {}, h("b", { text: `${gap.propertyType} · حي ${gap.district}` }),
              h("small", { text: [`${gap.txLabel}`, `${gap.requests} طلب`, gap.avgBudget ? `متوسط الميزانية ${formatPrice(gap.avgBudget)}` : ""].filter(Boolean).join(" · ") })))))
          : h("p", { class: "os-sub", text: "كل الطلبات النشطة لها عرض من النوع نفسه في الحي نفسه." })),
      h("section", { class: "os-card" }, sectionTitle("الأحياء الأكثر نشاطًا"),
        h("ul", { class: "os-list os-market-districts" }, snap.byDistrict.slice(0, 10).map((d) => h("li", {}, ic("pin"),
          h("span", {}, h("b", { text: [d.city, `حي ${d.district}`].filter(Boolean).join(" - ") }), h("small", { text: `${d.offers} عرض · ${d.requests} طلب` })))))));
  };
  append(container, pageHead("السوق"),
    h("p", { class: "os-sub os-tool-intro", text: "مؤشرات محسوبة من العروض والطلبات النشطة في مكتبك فقط — ليست مؤشرات السوق العام." }),
    body);
  draw();
  return subscribe((kind) => { if (kind === "records") draw(); });
}

const TOOL_VIEWS = { forms: renderForms, guide: renderGuide, services: renderServices, calculator: renderCalculator, market: renderMarket };

/** #/tools/<id> — unknown ids fall back to the office page instead of a blank screen. */
export function renderOfficeTool(container, { tool = "" } = {}) {
  const run = TOOL_VIEWS[tool];
  if (!run || !officeToolById(tool)) { go("office"); return null; }
  return run(container);
}
