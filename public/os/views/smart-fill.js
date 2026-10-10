/**
 * «تعبئة ذكية | تعبئة يدوية» — one switch above the existing form (public page and office app).
 * Smart: paste → «تحليل وترتيب البيانات» → the central service (Worker) → the found values go into the SAME
 * form fields, marked; a short review card says what was found and what is missing. Nothing is saved here:
 * the person reviews and presses the form's own save/send. Manual: the same form as is.
 * Switching keeps everything (one form, one text box).
 */

import { h, ic } from "../core/dom.js";
import { runAction } from "../core/ui.js";
import { formatNumber } from "../domain/format-domain.js";
import { PURPOSES } from "../domain/records-domain.js";
import { FILL_MODE, FILL_MODE_LABEL, SMART_FILL_LIMITS, URGENCY_LABEL, listingTitle } from "../domain/smart-fill-domain.js";

const PURPOSE_LABEL = Object.fromEntries([...PURPOSES.OFFER, ...PURPOSES.REQUEST].map((p) => [p.id, p.label]));
export const SMART_EXAMPLE = "مثال: مطلوب عمارة في شوران أو الهجرة أو الرانوناء، الميزانية مليونين، شراء، مستعجل.";

function setValue(root, name, value) {
  const el = root.querySelector(`[name="${name}"]`);
  if (!el || value === undefined || value === null || value === "") return false;
  el.value = String(value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.closest(".os-field")?.classList.add("os-smart-filled");
  return true;
}

/** Put one analysed ad into the form that is already on the page. Returns what was filled. */
export function applyListing(root, listing, { officeCity = "" } = {}) {
  const filled = [];
  root.querySelectorAll(".os-smart-filled").forEach((el) => el.classList.remove("os-smart-filled"));
  if (listing.purpose) {
    const label = PURPOSE_LABEL[listing.purpose];
    const button = [...root.querySelectorAll('[aria-label="الغرض"] button')].find((b) => b.textContent.trim() === label);
    if (button) { const wrap = button.closest(".os-field"); button.click(); wrap?.classList.add("os-smart-filled"); filled.push("purpose"); }
  }
  if (setValue(root, "propertyType", listing.propertyType)) filled.push("propertyType");
  if (listing.city) { if (setValue(root, "city", listing.city)) filled.push("city"); }
  else if (officeCity && !root.querySelector('[name="city"]')?.value) setValue(root, "city", officeCity);
  if (listing.districts.length && setValue(root, "district", listing.districts.join("، "))) filled.push("district");
  if (listing.price && setValue(root, "price", formatNumber(listing.price))) filled.push("price");
  if (listing.area && setValue(root, "area", listing.area)) filled.push("area");
  if (listing.rooms && setValue(root, "rooms", listing.rooms)) filled.push("rooms");
  const notes = [listing.features.join("، "), listing.notes].filter(Boolean).join(" — ");
  const notesEl = root.querySelector('[name="notes"]');
  if (notes && notesEl && !notesEl.value.includes(notes)) { setValue(root, "notes", [notesEl.value.trim(), notes].filter(Boolean).join(" — ").slice(0, 900)); filled.push("features"); }
  if (listing.urgent !== null) {
    root.querySelector(`[data-validity-option="${listing.urgent ? "yes" : "no"}"]`)?.click();
    filled.push("urgent");
  }
  if (listing.phone && !root.querySelector('[name="contactPhone"]')?.value && setValue(root, "contactPhone", listing.phone)) filled.push("phone");
  return filled;
}

/** «راجع بياناتك»: what was understood (✓) and what is still needed (•), in the order of the spec. */
export function reviewCard(listing, { roleLabel = "", cityFromOffice = false } = {}) {
  const priceLabel = listing.kind === "REQUEST" ? "الميزانية" : "السعر";
  const rows = [
    ["صفة مقدم المشاركة", roleLabel, true],
    ["عرض أو طلب", listing.kind === "OFFER" ? "عرض (لدي عقار)" : listing.kind === "REQUEST" ? "طلب (أبحث عن عقار)" : ""],
    ["نوع العملية", PURPOSE_LABEL[listing.purpose] || ""],
    ["نوع العقار", listing.propertyType + (listing.notes && /أنواع/.test(listing.notes) ? ` (${listing.notes.replace("أنواع مقبولة: ", "")})` : "")],
    ["المدينة", listing.city || (cityFromOffice ? "" : "")],
    [listing.districts.length > 1 ? "الأحياء" : "الحي", listing.districts.join("، ")],
    ["المساحة", listing.area ? `${formatNumber(listing.area)} م²` : "", true],
    [priceLabel, listing.price ? `${formatNumber(listing.price)} ريال` : ""],
    ["المواصفات", listing.features.join("، "), true],
    ["درجة الاستعجال", listing.urgent === null ? "" : URGENCY_LABEL[listing.urgent ? "yes" : "no"], true],
    ["رقم الجوال", listing.phone, true]
  ];
  const found = rows.filter(([, value]) => value);
  const needed = rows.filter(([, value, optional]) => !value && !optional);
  return h("div", { class: "os-smart-review", "data-smart-review": "", role: "status" },
    h("div", { class: "os-smart-review-head" }, ic("check-circle"), h("b", { text: "راجع البيانات المستخرجة" })),
    h("p", { class: "os-smart-review-title", text: listingTitle(listing) }),
    h("ul", { class: "os-smart-list" },
      found.map(([label, value]) => h("li", { class: "is-found", "data-found": label }, h("span", { text: label }), h("b", { text: value }))),
      needed.map(([label]) => h("li", { class: "is-missing", "data-missing": label }, h("span", { text: label }), h("b", { text: label === "المدينة" && cityFromOffice ? "لم تُذكر — اقترحنا مدينة المكتب، تأكد منها" : "لم يُذكر — أكمله في النموذج" })))),
    listing.questions.length ? h("p", { class: "os-smart-ask", "data-smart-question": "" }, ic("info"), ` ${listing.questions[0]}`) : null,
    h("small", { class: "os-sub", text: "عدّل أي خانة قبل الحفظ. لا يُحفظ شيء ولا تبدأ المطابقة قبل تأكيدك." }));
}

/**
 * The switch + the smart box. `formBox` is the existing form (hidden in smart mode until an analysis fills it).
 * `analyze(text)` → normalized analysis; `onListing(listing)` puts it in the form and returns review options.
 */
export function fillModes({ formBox, analyze, onListing, initialText = "", start = FILL_MODE.SMART, several = "", intro = "" }) {
  let mode = start;
  let analyzed = false;
  const tabs = h("div", { class: "os-seg os-fill-modes", role: "tablist", "aria-label": "طريقة التعبئة" });
  const textarea = h("textarea", { class: "os-textarea os-smart-text", name: "smartText", maxlength: String(SMART_FILL_LIMITS.maxChars), rows: "5", placeholder: SMART_EXAMPLE, "aria-label": "الصق إعلانك أو اكتب التفاصيل", text: initialText });
  const analyzeBtn = h("button", { type: "button", class: "os-btn primary block", "data-smart-analyze": "" }, ic("sparkles"), "تحليل وترتيب البيانات");
  const result = h("div", { "data-smart-result": "" });
  const alert = h("div", { class: "os-alert", role: "alert", hidden: true });
  const smartBox = h("div", { class: "os-smart-box", "data-smart-box": "" },
    intro ? h("div", { class: "os-alert warn", "data-kind-notice": "", text: intro }) : "",
    h("label", { class: "os-field" }, h("span", { text: "الصق إعلانك أو اكتب التفاصيل" }), textarea),
    analyzeBtn, alert);
  const setMode = (next) => {
    mode = next;
    tabs.querySelectorAll("button").forEach((b) => { const on = b.dataset.fillMode === mode; b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-selected", String(on)); });
    smartBox.hidden = mode !== FILL_MODE.SMART;
    result.hidden = mode !== FILL_MODE.SMART;
    formBox.hidden = mode === FILL_MODE.SMART && !analyzed;
  };
  for (const id of [FILL_MODE.SMART, FILL_MODE.MANUAL]) {
    tabs.append(h("button", { type: "button", role: "tab", "data-fill-mode": id, onClick: () => setMode(id) }, ic(id === FILL_MODE.SMART ? "sparkles" : "edit"), FILL_MODE_LABEL[id]));
  }
  const showAlert = (message, { manual = false, tone = "bad" } = {}) => {
    alert.className = `os-alert ${tone}`;
    alert.replaceChildren(h("span", { text: message }), manual ? h("button", { type: "button", class: "os-link-btn", "data-go-manual": "", onClick: () => setMode(FILL_MODE.MANUAL), text: "أكمل بالتعبئة اليدوية" }) : "");
    alert.hidden = false;
  };
  analyzeBtn.addEventListener("click", async () => {
    alert.hidden = true;
    const text = textarea.value.trim();
    if (text.length < SMART_FILL_LIMITS.minChars) { showAlert("اكتب تفاصيل أكثر أو الصق الإعلان كاملًا"); textarea.focus(); return; }
    let failure = "";
    const analysis = await runAction(analyzeBtn, () => analyze(text), { onError: (error) => { failure = error?.message || ""; } });
    if (!analysis?.ok) {
      // The text stays as written; the manual form is one press away.
      showAlert(`${failure || "تعذر التحليل الآن"} — نصك محفوظ كما هو.`, { manual: true });
      return;
    }
    if (analysis.notRealEstate || !analysis.listings.length) {
      showAlert("لم نجد في النص بيانات عقار (النوع، الحي، السعر…). أضف التفاصيل أو استخدم التعبئة اليدوية.", { manual: true, tone: "warn" });
      return;
    }
    const listing = analysis.listings[0];
    const review = onListing(listing, analysis) || {};
    if (review.abort) return;
    analyzed = true;
    result.replaceChildren(
      analysis.several && several ? h("div", { class: "os-alert warn", text: several }) : "",
      review.notice ? h("div", { class: "os-alert warn", "data-kind-notice": "", text: review.notice }) : "",
      reviewCard(listing, review));
    setMode(FILL_MODE.SMART);
    result.scrollIntoView?.({ block: "start", behavior: "smooth" });
  });
  setMode(mode);
  return {
    el: h("div", { class: "os-fill", "data-fill": "" }, tabs, smartBox, result),
    setMode,
    text: () => textarea.value,
    markAnalyzed: () => { analyzed = true; setMode(mode); }
  };
}
