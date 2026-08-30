/**
 * Lightweight party-shell HTML. No broker chrome.
 */

import {
  PARTY_INVALID_COPY,
  PARTY_REPLY_RECORDED
} from "./party-session-domain.js";

function escapeHtml(value = "") {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

export function buildPartyErrorHtml(message = PARTY_INVALID_COPY) {
  return `<main class="party-shell" data-party-shell data-party-error>
    <section class="party-card">
      <p class="party-error">${escapeHtml(message)}</p>
    </section>
  </main>`;
}

export function buildPartyLoadingHtml() {
  return `<main class="party-shell" data-party-shell data-party-loading>
    <section class="party-card"><p class="party-muted">جارٍ تجهيز الصفحة...</p></section>
  </main>`;
}

function propertyRows(property = {}) {
  const rows = [
    ["نوع العقار", property.propertyType],
    ["الغرض", property.purposeLabel],
    ["المدينة", property.city],
    ["الحي", property.district ? `حي ${String(property.district).replace(/^حي\s+/, "")}` : ""],
    ["السعر", property.priceLabel],
    ["المساحة", property.areaLabel],
    ["المواصفات", property.specs],
    ["اتجاه الشارع", property.streetDirection],
    ["عرض الشارع", property.streetWidthLabel],
    ["الواجهة", property.facade],
    ["العمق", property.depthLabel],
    ["رقم القطعة", property.plotNumber],
    ["الوصف", property.description]
  ];
  if (!property.propertyType && !property.purposeLabel && property.typePurpose) {
    rows.unshift(["نوع العقار", property.typePurpose]);
  }
  return rows
    .filter(([, value]) => value)
    .map(([label, value]) => `<p class="party-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></p>`)
    .join("");
}

function galleryHtml(property = {}) {
  const photos = Array.isArray(property.photos) ? property.photos.filter(Boolean) : [];
  if (!photos.length) {
    return `<p class="party-no-photos">لا توجد صور مرفقة</p>`;
  }
  const images = photos.map((url, index) => (
    `<img class="party-photo${index === 0 ? " is-hero" : ""}" src="${escapeHtml(url)}" alt="">`
  )).join("");
  return `<div class="party-photos">${images}</div>`;
}

function locationBlock(property = {}) {
  const loc = property.locationView || {};
  if (!loc.mode || loc.mode === "none") return "";
  if (loc.mode === "exact" && loc.map?.locationUrl) {
    return `<p class="party-location-wrap"><a class="party-location" href="${escapeHtml(loc.map.locationUrl)}" target="_blank" rel="noopener noreferrer">عرض الموقع</a></p>`;
  }
  if (loc.mode === "approximate" && loc.map) {
    return `<div class="party-approx-location" data-testid="party-approx-location">
      <p class="party-section-label">${escapeHtml(loc.title || "الموقع التقريبي")}</p>
      <p class="party-muted">${escapeHtml(loc.areaLabel || "")}</p>
      <p class="party-muted">نطاق تقريبي ~${escapeHtml(String(loc.map.radiusMeters || 400))} م</p>
    </div>`;
  }
  if (loc.areaLabel) {
    return `<p class="party-muted">${escapeHtml(loc.areaLabel)}</p>`;
  }
  return "";
}

function locationButtonHtml(property = {}) {
  const loc = property.locationView || {};
  if (loc.mode === "exact" && loc.map?.locationUrl) {
    return `<p class="party-location-wrap"><a class="party-location" href="${escapeHtml(loc.map.locationUrl)}" target="_blank" rel="noopener noreferrer">عرض الموقع</a></p>`;
  }
  return "";
}

function actionButtons(actions = []) {
  return (actions || []).map((action) => (
    `<button type="button" class="party-action" data-party-action="${escapeHtml(action.id)}" data-testid="party-${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>`
  )).join("");
}

function appointmentBlock(appointment = {}) {
  const phase = String(appointment.phase || "none");
  if (phase === "none") return "";
  const taken = appointment.takenMessage
    ? `<p class="party-error" data-testid="party-taken-message">${escapeHtml(appointment.takenMessage)}</p>`
    : "";
  const selected = appointment.selected || {};
  if (phase === "confirmed") {
    return `<div class="party-appointment" data-testid="party-appointment-confirmed">
      <p class="party-prompt">${escapeHtml(appointment.confirmedCopy || "تم تأكيد المعاينة")}</p>
      ${selected.dayLabel ? `<p class="party-row"><span>اليوم</span><strong>${escapeHtml(selected.dayLabel)}</strong></p>` : ""}
      ${selected.dateLabel ? `<p class="party-row"><span>التاريخ</span><strong>${escapeHtml(selected.dateLabel)}</strong></p>` : ""}
      ${selected.timeLabel ? `<p class="party-row"><span>الوقت</span><strong>${escapeHtml(selected.timeLabel)}</strong></p>` : ""}
    </div>`;
  }
  if (phase === "pick_slot") {
    const slots = (appointment.slots || []).map((slot) => (
      `<button type="button" class="party-action" data-party-slot="${escapeHtml(slot.id)}" data-testid="party-slot">${escapeHtml(slot.buttonLabel)}</button>`
    )).join("");
    return `<div class="party-appointment" data-testid="party-pick-slot">
      <p class="party-prompt">اختر موعد المعاينة</p>
      ${taken}
      <div class="party-actions">${slots}</div>
    </div>`;
  }
  if (phase === "wait_owner") {
    return `<div class="party-appointment" data-testid="party-wait-owner">
      <p class="party-prompt">بانتظار تأكيد المالك للموعد</p>
      ${selected.timeLabel ? `<p class="party-row"><span>الوقت المقترح</span><strong>${escapeHtml(selected.timeLabel)}</strong></p>` : ""}
    </div>`;
  }
  if (phase === "proposed") {
    return `<div class="party-appointment" data-testid="party-proposed-slot">
      <p class="party-prompt">تم اقتراح موعد المعاينة</p>
      ${selected.dayLabel ? `<p class="party-row"><span>اليوم</span><strong>${escapeHtml(selected.dayLabel)}</strong></p>` : ""}
      ${selected.dateLabel ? `<p class="party-row"><span>التاريخ</span><strong>${escapeHtml(selected.dateLabel)}</strong></p>` : ""}
      ${selected.timeLabel ? `<p class="party-row"><span>الوقت</span><strong>${escapeHtml(selected.timeLabel)}</strong></p>` : ""}
      ${taken}
      <div class="party-actions">
        <button type="button" class="party-action" data-party-appointment="confirm" data-testid="party-confirm-appointment">تأكيد الموعد</button>
        <button type="button" class="party-action" data-party-appointment="rechoose" data-testid="party-choose-another-slot">اختيار وقت آخر</button>
      </div>
    </div>`;
  }
  if (phase === "wait_client_slot") {
    return `<p class="party-prompt" data-testid="party-wait-client-slot">بانتظار اختيار العميل لموعد المعاينة</p>`;
  }
  if (phase === "wait_property") {
    return `<p class="party-prompt" data-testid="party-wait-property">بانتظار تأكيد توفر العقار</p>`;
  }
  return taken;
}

function chipOptions(options = [], field = "", type = "multi") {
  return (options || []).map((opt) => {
    const inputType = type === "single" ? "radio" : "checkbox";
    const nameAttr = type === "single" ? `name="${escapeHtml(field)}"` : "";
    return `<label class="party-chip" data-party-chip>
      <input type="${inputType}" ${nameAttr} data-package-field="${escapeHtml(field)}" value="${escapeHtml(opt.value)}">
      <span>${opt.icon ? `<span class="party-chip-icon" aria-hidden="true">${escapeHtml(opt.icon)}</span> ` : ""}${escapeHtml(opt.label)}</span>
    </label>`;
  }).join("");
}

function decisionPackageBlock(pkg = {}, view = {}) {
  if (!pkg || pkg.mode !== "decision_package_v1") return "";
  if (pkg.submitted) {
    return `<div class="party-coordination" data-testid="party-bundle-recorded">
      <p class="party-recorded">${escapeHtml(view.submitSuccessCopy || PARTY_REPLY_RECORDED)}</p>
      <p class="party-reply">${escapeHtml(pkg.bundleSummary || "")}</p>
    </div>`;
  }
  const party = pkg.party || "client";
  const viewingChoices = () => `<p class="party-muted">اليوم</p>
    <div class="party-chip-grid">${chipOptions(pkg.dayOptions, "viewingDays")}</div>
    <p class="party-muted">الفترة</p>
    <div class="party-chip-grid">${chipOptions(pkg.periodOptions, "viewingPeriods")}</div>`;
  if (party === "client" && pkg.workflowStep === "client_viewing") {
    return `<div class="party-coordination" data-party-decision-package data-party-coordination-form data-workflow-step="client_viewing">
      <p class="party-section-label">إدارة المفاوضات</p>
      <div class="party-package-section"><p class="party-section-label">اختر أوقات المعاينة المناسبة</p>${viewingChoices()}</div>
      <button type="button" class="party-action party-package-submit" data-party-bundle-submit>إرسال الرد</button>
    </div>`;
  }
  if (party === "client") {
    if (pkg.negotiationResponseRequest) {
      const preferenceLabels = {
        fixed: "السعر ثابت",
        slight: "مجال بسيط للتخفيض",
        discount_2: "تخفيض 2%",
        discount_5: "تخفيض 5%",
        discuss_at_viewing: "يُناقش عند المعاينة"
      };
      const counterPrice = Number(pkg.negotiationResponseRequest.counterPrice || 0);
      const ownerReply = counterPrice
        ? `عرض المالك: ${counterPrice.toLocaleString("en-US")} ر.س`
        : (preferenceLabels[pkg.negotiationResponseRequest.ownerPreference] || "المالك قدّم ردًا تفاوضيًا");
      return `<div class="party-coordination" data-party-decision-package data-party-coordination-form data-workflow-step="client_price_response">
        <div class="party-package-section">
          <p class="party-section-label">رد المالك</p>
          <p class="party-muted">${escapeHtml(ownerReply)}</p>
          <div class="party-chip-grid party-chip-grid--single">${chipOptions([
            { value: "accept", label: "مناسب، أوافق" },
            { value: "viewing", label: "أفضل المعاينة أولًا" },
            { value: "reject", label: "ما زال غير مناسب" }
          ], "negotiationResponse", "single")}</div>
          <div data-package-section="responseViewing" hidden>${viewingChoices()}</div>
        </div>
        <button type="button" class="party-action party-package-submit" data-party-bundle-submit>إرسال الرد</button>
      </div>`;
    }
    const detailSection = (pkg.detailOptions || []).length
      ? `<div class="party-package-section" data-package-section="requestedDetailKeys" hidden>
      <p class="party-section-label">ما المعلومات التي تحتاجها؟</p>
      <div class="party-chip-grid">${chipOptions(pkg.detailOptions, "requestedDetailKeys")}</div>
    </div>`
      : "";
    const viewingSection = `<div class="party-package-section" data-package-section="viewing" hidden>
      <p class="party-section-label">أوقات المعاينة المفضلة</p>
      <p class="party-muted">اليوم</p>
      <div class="party-chip-grid">${chipOptions(pkg.dayOptions, "viewingDays")}</div>
      <p class="party-muted">الفترة</p>
      <div class="party-chip-grid">${chipOptions(pkg.periodOptions, "viewingPeriods")}</div>
    </div>`;
    const priceSection = `<div class="party-package-section" data-package-section="priceNegotiation" hidden>
      <p class="party-section-label">خيارات التفاوض على السعر</p>
      ${pkg.hasCanonicalPrice
        ? `<p class="party-row"><span>السعر الحالي</span><strong>${escapeHtml(Number(pkg.canonicalPrice).toLocaleString("en-US"))} ر.س</strong></p>`
        : `<p class="party-muted">السعر الحالي غير متوفر، لذلك لن تُعرض قيم محسوبة.</p>`}
      <div class="party-chip-grid">${chipOptions(pkg.priceOptions, "priceNegotiation", "single")}</div>
    </div>`;
    const rejectionSection = `<div class="party-package-section" data-package-section="rejection" hidden>
      <p class="party-section-label">ما سبب عدم الاهتمام؟</p>
      <div class="party-chip-grid">
        ${chipOptions([
          ...(pkg.rejectionOptions || []),
          { value: "payment_terms", label: "شروط الدفع غير مناسبة", icon: "💳" },
          { value: "other", label: "سبب آخر", icon: "➕" }
        ], "rejectionReason", "single")}
      </div>
      <p class="party-section-label">هل يمكن إعادة النظر إذا تغير الشرط؟</p>
      <div class="party-chip-grid party-chip-grid--single">
        ${chipOptions([
          { value: "negotiable", label: "قد أهتم إذا تغير الشرط" },
          { value: "final", label: "غير مناسب نهائيًا" }
        ], "rejectionDisposition", "single")}
      </div>
      <div class="party-package-section" data-package-section="negotiationPreference" hidden>
        <p class="party-section-label">ما التعديل الذي يجعلك تعيد النظر؟</p>
        <div class="party-chip-grid">${chipOptions([
          { value: "ask_owner", label: "اسأل المالك عن مجال التخفيض" },
          { value: "installments", label: "تقسيم الدفعات" },
          { value: "lower_deposit", label: "تخفيض التأمين أو الدفعة" },
          { value: "payment_date", label: "تعديل موعد السداد" },
          { value: "lease_term", label: "مدة مختلفة" },
          { value: "maintenance", label: "تنفيذ الصيانة" },
          { value: "readiness", label: "تجهيز العقار" },
          { value: "spec_adjustment", label: "تعديل قابل للتنفيذ" }
        ], "negotiationPreference", "single")}</div>
      </div>
    </div>`;
    return `<div class="party-coordination" data-party-decision-package data-party-coordination-form data-question-set="${escapeHtml(pkg.questionSetVersion || "")}">
      <p class="party-section-label">إدارة المفاوضات</p>
      <div class="party-package-section">
        <p class="party-section-label">ما قرارك؟</p>
        <div class="party-chip-grid">
          ${chipOptions([
            { value: "interested", label: "مهتم" },
            { value: "viewing", label: "أرغب في المعاينة" },
            { value: "details", label: "أحتاج معلومات" },
            { value: "price", label: "السعر غير مناسب" },
            { value: "not_suitable", label: "غير مناسب" }
          ], "clientDecision", "single")}
        </div>
      </div>
      ${detailSection}
      ${viewingSection}
      ${priceSection}
      ${rejectionSection}
      <button type="button" class="party-action party-package-submit" data-party-bundle-submit data-testid="party-bundle-submit">
        <span class="party-send-icon" aria-hidden="true">➤</span> إرسال الرد
      </button>
    </div>`;
  }
  if (pkg.workflowStep === "owner_availability") {
    return `<div class="party-coordination" data-party-decision-package data-party-coordination-form data-workflow-step="owner_availability">
      <p class="party-section-label">إدارة المفاوضات</p>
      <p class="party-section-label">توفر العقار</p><div class="party-chip-grid party-chip-grid--single">${chipOptions([
        { value: "available", label: "العقار متاح" }, { value: "not_available", label: "غير متاح" }
      ], "propertyAvailability", "single")}</div>
      <button type="button" class="party-action party-package-submit" data-party-bundle-submit>إرسال الرد</button>
    </div>`;
  }
  if (pkg.workflowStep === "owner_details") {
    const fields = (pkg.ownerDetailFields || []).map((field) => `<div class="party-package-field">
      <p class="party-row"><span>${escapeHtml(field.label)}</span><strong>${escapeHtml(field.hasValue ? field.currentValue : "غير متوفر حاليًا")}</strong></p>
      <div class="party-chip-grid party-chip-grid--single">${chipOptions([
        ...(field.hasValue ? [{ value: "confirm", label: "صحيح" }] : []),
        { value: "needs_update", label: "يحتاج تحديث" }
      ], `detailStatus_${field.key}`, "single")}</div></div>`).join("");
    return `<div class="party-coordination" data-party-decision-package data-party-coordination-form data-workflow-step="owner_details">
      <p class="party-section-label">إدارة المفاوضات</p>
      <p class="party-section-label">التفاصيل المطلوبة من العميل</p>${fields}
      <button type="button" class="party-action party-package-submit" data-party-bundle-submit>إرسال الرد</button>
    </div>`;
  }
  if (pkg.workflowStep === "owner_price") {
    const request = pkg.negotiationRequest || {};
    const options = [
      { value: "accept_discount", label: "أوافق" },
      { value: "fixed", label: "أتمسك بالسعر" },
      ...(request.midpointPrice ? [{ value: "slight", label: `${Number(request.midpointPrice).toLocaleString("en-US")} ر.س — حل وسط` }] : []),
      { value: "discuss_at_viewing", label: "نناقشه عند المعاينة" }
    ];
    return `<div class="party-coordination" data-party-decision-package data-party-coordination-form data-workflow-step="owner_price">
      <p class="party-section-label">إدارة المفاوضات</p>
      <p class="party-row"><span>السعر الحالي</span><strong>${Number(pkg.canonicalPrice || 0).toLocaleString("en-US")} ر.س</strong></p>
      ${request.proposedPrice ? `<p class="party-row"><span>طلب العميل</span><strong>${Number(request.proposedPrice).toLocaleString("en-US")} ر.س</strong></p>` : ""}
      <div class="party-chip-grid">${chipOptions(options, "ownerPriceDecision", "single")}</div>
      <button type="button" class="party-action party-package-submit" data-party-bundle-submit>إرسال الرد</button>
    </div>`;
  }
  if (pkg.workflowStep === "owner_viewing") {
    return `<div class="party-coordination" data-party-decision-package data-party-coordination-form data-workflow-step="owner_viewing">
      <p class="party-section-label">إدارة المفاوضات</p>
      <p class="party-section-label">المعاينة</p><div class="party-chip-grid party-chip-grid--single">${chipOptions([
        { value: "yes", label: "ممكنة" }, { value: "needs_coordination", label: "تحتاج تنسيق مسبق" }, { value: "no", label: "غير ممكنة" }
      ], "viewingAllowed", "single")}</div><div data-package-section="ownerAvailability" hidden>${viewingChoices()}</div>
      <button type="button" class="party-action party-package-submit" data-party-bundle-submit>إرسال الرد</button>
    </div>`;
  }
  const ownerPriceOptions = [
    { value: "confirmed", label: "السعر صحيح" },
    { value: "slight", label: "أقبل مجالًا بسيطًا للتفاوض" },
    ...(pkg.negotiationRequest ? [{ value: "accept_discount", label: "أوافق على التخفيض المقترح" }] : []),
    { value: "fixed", label: "أتمسك بالسعر" },
    { value: "discuss_at_viewing", label: "نناقشه عند المعاينة" }
  ];
  const priceBlock = pkg.hasCanonicalPrice
    ? `<p class="party-row"><span>السعر المطلوب</span><strong>${escapeHtml(String(pkg.canonicalPrice))} ريال</strong></p>
      <div class="party-chip-grid">
        ${chipOptions(ownerPriceOptions, "ownerPriceDecision", "single")}
      </div>
      </div>`
    : `<p class="party-muted">السعر غير مثبت، لذلك لا تُعرض قيمة رقمية.</p>
      <div class="party-chip-grid">
        ${chipOptions(ownerPriceOptions.filter((option) => option.value !== "confirmed"), "ownerPriceDecision", "single")}
      </div>`;
  const ownerDetailFields = (pkg.ownerDetailFields || []).map((field) => {
    const key = field.key || "";
    const label = field.label || key;
    if (field.hasValue && field.currentValue) {
      return `<div class="party-package-field" data-owner-detail="${escapeHtml(key)}">
        <p class="party-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(field.currentValue)}</strong></p>
        <div class="party-chip-grid party-chip-grid--single">
          ${chipOptions([
            { value: "confirm", label: "صحيح" },
            { value: "needs_update", label: "يحتاج تحديث" }
          ], `detailStatus_${key}`, "single")}
        </div>
      </div>`;
    }
    return `<div class="party-package-field" data-owner-detail="${escapeHtml(key)}">
      <p class="party-row"><span>${escapeHtml(label)}</span><strong>غير متوفر حاليًا</strong></p>
      <p class="party-muted">يتطلب استكماله عن طريق الوسيط.</p>
    </div>`;
  }).join("");
  return `<div class="party-coordination" data-party-decision-package data-party-coordination-form data-question-set="${escapeHtml(pkg.questionSetVersion || "")}">
    <p class="party-section-label">إدارة المفاوضات</p>
    <div class="party-package-section">
      <p class="party-section-label">توفر العقار</p>
      <div class="party-chip-grid party-chip-grid--single">
        ${chipOptions([
          { value: "available", label: "العقار متاح" },
          { value: "not_available", label: "غير متاح" }
        ], "propertyAvailability", "single")}
      </div>
    </div>
    <div class="party-package-section" data-package-section="price" hidden>
      <p class="party-section-label">السعر</p>
      ${priceBlock}
    </div>
    <div class="party-package-section" data-package-section="photos" hidden>
      <p class="party-section-label">الصور</p>
      <p class="party-warning">الصور التي ترفعها ستُشارك مع العميل وتُضاف للعقار. تأكد أنها لا تحتوي على رقم جوال أو بيانات تواصل خاصة.</p>
      <label class="party-chip party-chip--toggle">
        <input type="checkbox" data-package-bool="mediaAdded">
        <span>إضافة صور</span>
      </label>
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple class="party-file" data-package-photos hidden>
      <div class="party-photo-preview" data-package-photo-preview></div>
    </div>
    <div class="party-package-section" data-package-section="location" hidden>
      <label class="party-chip party-chip--toggle">
        <input type="checkbox" data-package-bool="locationShare" ${pkg.hasLocation ? "checked" : ""}>
        <span>مشاركة موقع العقار</span>
      </label>
    </div>
    <div class="party-package-section" data-package-section="ownerSpecs" hidden>
      <p class="party-section-label">التفاصيل المطلوبة من العميل</p>
      ${ownerDetailFields}
    </div>
    <div class="party-package-section" data-package-section="ownerViewing" hidden>
      <p class="party-section-label">المعاينة</p>
      <div class="party-chip-grid party-chip-grid--single">
        ${chipOptions([
          { value: "yes", label: "ممكنة" },
          { value: "needs_coordination", label: "تحتاج تنسيق مسبق" }
        ], "viewingAllowed", "single")}
      </div>
      <div data-package-section="ownerAvailability" hidden>
        <p class="party-muted">اليوم</p>
        <div class="party-chip-grid">${chipOptions(pkg.dayOptions, "viewingDays")}</div>
        <p class="party-muted">الفترة</p>
        <div class="party-chip-grid">${chipOptions(pkg.periodOptions, "viewingPeriods")}</div>
      </div>
    </div>
    <button type="button" class="party-action party-package-submit" data-party-bundle-submit data-testid="party-bundle-submit">
      <span class="party-send-icon" aria-hidden="true">➤</span> إرسال الرد
    </button>
  </div>`;
}

function coordinationFormBlock(form = {}) {
  return decisionPackageBlock(form, {});
}

export function buildPartyShellHtml(view = {}) {
  const property = view.property || {};
  const details = propertyRows(property);
  const logo = view.officeLogoUrl
    ? `<img class="party-logo" src="${escapeHtml(view.officeLogoUrl)}" alt="" onerror="this.remove()">`
    : (view.officeProfileUrl
      ? `<img class="party-logo" src="${escapeHtml(view.officeProfileUrl)}" alt="" onerror="this.remove()">`
      : "");
  const officeNotice = view.officeCoordinationNotice
    ? `<p class="party-office-notice">${escapeHtml(view.officeCoordinationNotice)}</p>`
    : "";
  const privacyNotice = view.privacyNotice
    ? `<p class="party-privacy-notice">${escapeHtml(view.privacyNotice)}</p>`
    : "";
  const ownerStatus = view.ownerClientStatus
    ? `<p class="party-client-status">${escapeHtml(view.ownerClientStatus)}</p>`
    : "";
  const prompt = view.promptLine
    ? `<p class="party-prompt">${escapeHtml(view.promptLine)}</p>`
    : "";
  const revealed = view.revealedDetail?.value
    ? `<div class="party-revealed"><p>${escapeHtml(view.revealedDetail.label || "")}</p><strong>${escapeHtml(view.revealedDetail.value)}</strong></div>`
    : "";
  const primaryActions = actionButtons(view.actions);
  const followUp = actionButtons(view.followUpActions);
  const decisionPackage = decisionPackageBlock(view.decisionPackage, view);
  const appointment = appointmentBlock(view.appointment || {});
  let replyBlock = "";
  if (decisionPackage) {
    replyBlock = `<div class="party-reply-block">${prompt}${decisionPackage}</div>`;
  } else if (appointment) {
    replyBlock = `<div class="party-reply-block">${appointment}</div>`;
  } else if (view.replied) {
    const nextPrompt = view.replyLabel === "أحتاج تفاصيل أكثر" && followUp
      ? `<p class="party-prompt">ما التفاصيل التي تحتاجها؟</p>`
      : (view.replyLabel === "مهتم" && followUp
        ? `<p class="party-prompt" data-testid="party-next-step">هل ترغب بمعاينة العقار؟</p>`
        : "");
    replyBlock = `<div class="party-reply-block">
      <p class="party-recorded">${PARTY_REPLY_RECORDED}</p>
      <p class="party-reply">${escapeHtml(view.replyLabel || "")}</p>
      ${view.followUpLabel ? `<p class="party-followup-choice">${escapeHtml(view.followUpLabel)}</p>` : ""}
      ${revealed}
      ${nextPrompt}
      ${followUp ? `<div class="party-actions party-followup">${followUp}</div>` : ""}
    </div>`;
  } else if (primaryActions) {
    replyBlock = `<div class="party-reply-card-inner">${prompt}<div class="party-actions">${primaryActions}</div></div>`;
  }
  return `<main class="party-shell" data-party-shell data-party="${escapeHtml(view.party || "client")}">
    <header class="party-brand">
      ${logo}
      <p class="party-office">${escapeHtml(view.officeName || "المكتب العقاري")}</p>
      ${officeNotice}
      ${privacyNotice}
    </header>
    <section class="party-card party-property-card">
      <h1>${escapeHtml(view.title || "")}</h1>
      ${ownerStatus}
      ${galleryHtml(property)}
      ${details}
      ${locationBlock(property)}
      ${locationButtonHtml(property)}
    </section>
    <section class="party-card party-reply-card">
      ${replyBlock}
      <p class="party-status" id="partyStatus" hidden></p>
    </section>
  </main>`;
}

export function partyShellHasBrokerChrome(html) {
  return /أنا عميل|أنا مالك|تسجيل دخول مكتب|المهام اليومية|العروض والطلبات/.test(String(html || ""));
}
