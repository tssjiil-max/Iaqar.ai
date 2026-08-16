/**
 * Opportunity bank workspace + needs-completion form — HTML only (no DOM).
 */

import {
  buildWorkspaceHeader,
  buildWorkspaceActivity,
  buildIncompleteFormFields,
  contactPartyLabel,
  sortMatchesForWorkspace
} from "./opportunity-workspace-domain.js";
import { officeShareStatusLabel,
  readyWorkspacePrimaryActions,
  partyContactActions,
  sendAndShareHubOptions,
  buildPublicListingAnnouncement
} from "./opportunity-ready-actions-domain.js";
import { cooperationStatusLabel } from "./opportunity-workspace-domain.js";
import { missingFieldLabelsArabic } from "./opportunity-readiness-domain.js";
import { activeFollowUpFromRecord, formatFollowUpAppointmentLine } from "./opportunity-followup-domain.js";
import {
  CONTACT_OUTCOME_LABELS,
  CONTACT_OUTCOME_ORDER,
  REFUSAL_REASON_OPTIONS,
  defaultContactFollowUpInput,
  defaultContactRetryInput,
  shouldShowContactOutcomePanel
} from "./opportunity-contact-outcome-domain.js";
import { buildSuitableOfficesShareSectionHtml } from "./suitable-offices-ui.js";

function esc(text = "") {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function renderFieldBlock(field) {
  switch (field.type) {
    case "purpose_select":
      const opts = (field.options || []).map((opt) =>
        `<option value="${esc(opt.value)}" ${field.value === opt.value ? "selected" : ""}>${esc(opt.label)}</option>`
      ).join("");
      return `<label>${esc(field.label)}
        <select name="purpose" required>
          <option value="">اختر الغرض</option>
          ${opts}
        </select>
      </label>`;
    case "propertyType":
      return `<label>${esc(field.label)}
        <input name="propertyType" class="arabic-suggest-input" autocomplete="off" value="${esc(field.value)}">
      </label>`;
    case "district":
      return `<label>${esc(field.label)}
        <input name="district" class="arabic-suggest-input" autocomplete="off" value="${esc(field.value)}">
      </label>`;
    case "advertiserRole":
      return `<label>${esc(field.label)}
        <select name="advertiserRole">
          <option value="">اختر</option>
          <option value="OWNER" ${field.value === "OWNER" ? "selected" : ""}>مالك</option>
          <option value="DELEGATE" ${field.value === "DELEGATE" ? "selected" : ""}>مفوض</option>
          <option value="BROKER" ${field.value === "BROKER" ? "selected" : ""}>وسيط</option>
          <option value="CLIENT" ${field.value === "CLIENT" ? "selected" : ""}>عميل</option>
        </select>
      </label>`;
    case "phone":
      return `<label>${esc(field.label)}
        <input name="advertiserPhoneLocal" type="tel" inputmode="numeric" maxlength="14"
          placeholder="05XXXXXXXX أو +9665XXXXXXXX" value="${esc(field.value)}"
          aria-label="رقم الجوال الكامل">
        <small class="bank-advertiser-phone-error" id="bankAdvertiserPhoneError" hidden></small>
      </label>`;
    case "number":
      return `<label>${esc(field.label)}
        <input name="${esc(field.name)}" type="number" value="${esc(String(field.value ?? ""))}">
      </label>`;
    default:
      return `<label>${esc(field.label)}
        <input name="${esc(field.name || field.key)}" type="text" value="${esc(String(field.value ?? ""))}">
      </label>`;
  }
}

export function buildNeedsCompletionDetailHtml(id, record, readiness = {}) {
  const missingNames = missingFieldLabelsArabic(readiness.matchingReadinessMissing || []);
  const fields = buildIncompleteFormFields(record, readiness);
  const fieldBlocks = fields.map(renderFieldBlock).join("");
  const party = contactPartyLabel(record);

  return `
    <div class="bank-detail-head iaqar-workflow-head">
      <h3>استكمال الفرصة</h3>
      <button type="button" class="settings-close iaqar-workflow-close" id="bankDetailClose" aria-label="إغلاق">×</button>
    </div>
    <section class="bank-missing-banner is-incomplete" aria-live="polite">
      <strong>ينقص: ${esc(missingNames.join("، "))}</strong>
    </section>
    <p class="bank-note iaqar-workflow-note bank-incomplete-party">جهة التواصل: ${esc(party)}</p>
    <form id="bankUnifiedForm" class="bank-unified-form bank-incomplete-form iaqar-workflow-form" autocomplete="off">
      <div class="bank-edit-grid">${fieldBlocks}</div>
    </form>
    <div class="bank-unified-save-wrap">
      <button type="button" class="bank-action-primary iaqar-workflow-btn success" id="bankUnifiedSaveBtn">حفظ واستكمال الفرصة</button>
      <p class="section-status" id="bankUnifiedSaveStatus" role="status"></p>
    </div>`;
}

function workspaceActionButton(action) {
  return `<button type="button" class="bank-workspace-action iaqar-workflow-btn secondary" data-workspace-action="${esc(action.id)}">${esc(action.label)}</button>`;
}

function isOwnerPartyLabel(record = {}) {
  const actions = readyWorkspacePrimaryActions(record);
  const party = actions.find((row) => row.id === "contact_party");
  return party?.label || "إجراء مع الجهة";
}

function buildFollowUpQuickPickHtml(inputId, defaultValue = "") {
  return `
    <div class="bank-followup-quick bank-contact-schedule-quick iaqar-workflow-actions">
      <button type="button" class="bank-action iaqar-workflow-btn secondary" data-contact-schedule-days="0">اليوم</button>
      <button type="button" class="bank-action iaqar-workflow-btn secondary" data-contact-schedule-days="1">غدًا</button>
      <button type="button" class="bank-action iaqar-workflow-btn secondary" data-contact-schedule-days="2">بعد غد</button>
      <label>تاريخ ووقت
        <input type="datetime-local" id="${esc(inputId)}" value="${esc(defaultValue)}">
      </label>
    </div>`;
}

export function buildContactOutcomeActionHtml(outcome = "", options = {}) {
  const key = String(outcome || "").toUpperCase();
  const retryDefault = options.retryDefault || defaultContactRetryInput();
  const followDefault = options.followDefault || defaultContactFollowUpInput();
  switch (key) {
    case "NO_RESPONSE":
      return `
        <p class="bank-note iaqar-workflow-note">تحديد محاولة اتصال جديدة</p>
        ${buildFollowUpQuickPickHtml("bankContactRetryAt", retryDefault)}`;
    case "INTERESTED":
      return `
        <div class="bank-contact-outcome-actions-row iaqar-workflow-actions">
          <button type="button" class="bank-action iaqar-workflow-btn secondary" id="bankContactInterestedFollowUp">تحديد متابعة</button>
          <button type="button" class="bank-action iaqar-workflow-btn secondary" id="bankContactInterestedWhatsApp">تواصل واتساب</button>
        </div>
        <label>ملاحظة قصيرة (اختياري)
          <textarea id="bankContactOutcomeNote" maxlength="200" rows="2" placeholder="ملاحظة اختيارية"></textarea>
        </label>
        <div id="bankContactInterestedFollowUpPanel" class="bank-contact-outcome-subpanel" hidden>
          ${buildFollowUpQuickPickHtml("bankContactInterestedFollowUpAt", followDefault)}
        </div>`;
    case "REFUSED":
      const reasons = REFUSAL_REASON_OPTIONS.map((row) =>
        `<button type="button" class="bank-action bank-refusal-reason iaqar-workflow-btn secondary" data-refusal-reason="${esc(row.key)}">${esc(row.label)}</button>`
      ).join("");
      return `
        <p class="bank-note iaqar-workflow-note">سبب عدم الاهتمام</p>
        <div class="bank-contact-refusal-reasons iaqar-workflow-actions iaqar-outcome-actions">${reasons}</div>
        <label>ملاحظة (اختياري)
          <textarea id="bankContactOutcomeNote" maxlength="200" rows="2" placeholder="تفاصيل إضافية"></textarea>
        </label>
        <button type="button" class="bank-action danger iaqar-workflow-btn danger" id="bankContactRefusedArchive">إنهاء وأرشفة الفرصة</button>`;
    case "FOLLOW_UP":
      return `
        <p class="bank-note iaqar-workflow-note">اختر موعد المتابعة</p>
        ${buildFollowUpQuickPickHtml("bankContactFollowUpAt", followDefault)}`;
    case "AGREED":
      return `
        <button type="button" class="bank-action-primary iaqar-workflow-btn success" id="bankContactAgreedDeal">تسجيل الاتفاق والانتقال للصفقة</button>
        <p class="bank-note iaqar-workflow-note">لن تُنهى الفرصة تلقائيًا — أكمل تسجيل بيانات الاتفاق.</p>`;
    default:
      return "";
  }
}

export function buildContactOutcomesSectionHtml(record = {}, options = {}) {
  const show = options.show === true || shouldShowContactOutcomePanel(record);
  const retryDefault = defaultContactRetryInput();
  const followDefault = defaultContactFollowUpInput();
  const outcomeButtons = CONTACT_OUTCOME_ORDER.map((key) =>
    `<button type="button" class="bank-action bank-contact-outcome-btn iaqar-workflow-btn secondary" data-contact-outcome="${esc(key)}">${esc(CONTACT_OUTCOME_LABELS[key])}</button>`
  ).join("");
  return `
    <section class="bank-workspace-section iaqar-workflow-step" id="bankWorkspaceContactSection" ${show ? "" : "hidden"}>
      <h4>نتيجة التواصل</h4>
      <div class="bank-contact-outcomes iaqar-workflow-actions iaqar-outcome-actions" id="bankContactOutcomes">${outcomeButtons}</div>
      <div id="bankContactOutcomeActionPanel" class="bank-contact-outcome-action-panel" hidden></div>
      <button type="button" class="bank-action-primary iaqar-workflow-btn success" id="bankSaveContactOutcomeBtn" hidden>حفظ النتيجة والإجراء القادم</button>
      <p class="section-status" id="bankContactOutcomeStatus" role="status"></p>
    </section>`;
}

export function buildWorkspaceMatchRowsHtml(opportunityId, matches = []) {
  const sorted = sortMatchesForWorkspace(matches, opportunityId);
  return sorted.slice(0, 12).map((match) => {
    const counterpartId = match.opportunityId === opportunityId
      ? match.counterpartOpportunityId
      : match.opportunityId;
    const reason = (match.reasons || []).slice(0, 2).join(" — ");
    const warning = (match.warnings || []).slice(0, 2).join(" — ");
    const diffLine = warning ? `اختلافات: ${warning}` : "";
    return `<button type="button" class="bank-workspace-match-row" data-match-id="${esc(match.matchId)}" data-counterpart-id="${esc(counterpartId)}">
      <span class="bank-workspace-match-score">${esc(String(match.score))}%</span>
      <span class="bank-workspace-match-body">
        <strong>${esc(match.propertyType || "مطابقة")} — ${esc(match.district || "")}</strong>
        <small>${esc(reason)}</small>
        ${diffLine ? `<small class="bank-workspace-match-warning">${esc(diffLine)}</small>` : ""}
      </span>
    </button>`;
  }).join("") || "<p class='bank-note'>لا توجد مطابقات محفوظة.</p>";
}

function buildOpportunityBriefPreview(record = {}) {
  const parts = [
    record.propertyType,
    record.district,
    record.city,
    record.priceOrBudget != null && record.priceOrBudget !== "" ? `${record.priceOrBudget} ريال` : ""
  ].filter(Boolean);
  return parts.join(" — ") || "ملخص الفرصة";
}

export function buildReadyWorkspaceHtml(id, record, bundle = {}, options = {}) {
  const header = buildWorkspaceHeader(record);
  const matches = sortMatchesForWorkspace(bundle.matches || [], id);
  const actions = readyWorkspacePrimaryActions(record);
  const partyActions = partyContactActions(record);
  const hubOptions = sendAndShareHubOptions();
  const activity = buildWorkspaceActivity(record, bundle.cooperationRequests || []);
  const followUp = bundle.followUp || activeFollowUpFromRecord(record);
  const archived = record.lifecycleStatus === "ARCHIVED" || Boolean(record.archivedAt);
  const contactOutcomesSection = archived ? "" : buildContactOutcomesSectionHtml(record);
  const listingPreview = buildPublicListingAnnouncement(record, options.officeProfile || {}, {
    origin: options.origin || ""
  });

  const stats = [
    header.priceText ? `<div class="bank-stat"><span class="bank-stat-label">السعر</span><strong>${esc(header.priceText)}</strong></div>` : "",
    header.areaText ? `<div class="bank-stat"><span class="bank-stat-label">المساحة</span><strong>${esc(header.areaText)}</strong></div>` : "",
    header.roomsText ? `<div class="bank-stat"><span class="bank-stat-label">الغرف</span><strong>${esc(header.roomsText)}</strong></div>` : ""
  ].filter(Boolean).join("");

  const matchRows = buildWorkspaceMatchRowsHtml(id, matches);

  const coopRows = (bundle.cooperationRequests || []).map((row) => `
    <div class="bank-workspace-coop-row" data-coop-request-id="${esc(row.id || "")}">
      <strong>${esc(row.targetOfficeName || row.targetOfficeId)}</strong>
      <span>${esc(officeShareStatusLabel(row.status))}</span>
      ${String(row.status).toUpperCase() === "ACCEPTED"
        ? `<button type="button" class="bank-action iaqar-workflow-btn secondary" data-open-coop-room="${esc(row.id)}">فتح غرفة التعاون</button>`
        : ""}
    </div>`).join("");

  const partyActionButtons = partyActions.map((action) =>
    `<button type="button" class="bank-workspace-party-action iaqar-workflow-btn secondary" data-party-action="${esc(action.id)}">${esc(action.label)}</button>`
  ).join("");

  const hubButtons = hubOptions.map((opt) =>
    `<button type="button" class="bank-workspace-hub-option iaqar-workflow-btn secondary" data-send-share-option="${esc(opt.id)}">${esc(opt.label)}</button>`
  ).join("");

  const activityRows = activity.map((row) =>
    `<li><time>${esc(new Date(row.at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }))}</time> ${esc(row.text)}</li>`
  ).join("");

  const followUpLabel = followUp?.at ? formatFollowUpAppointmentLine(followUp.at) : "";

  return `
    <div class="bank-workspace-layout">
      <div class="bank-workspace-main">
        <div class="bank-detail-head iaqar-workflow-head">
          <h3>تفاصيل الفرصة</h3>
          <button type="button" class="settings-close iaqar-workflow-close" id="bankDetailClose" aria-label="إغلاق">×</button>
        </div>
        <header class="bank-workspace-header">
          <div class="bank-row-header">
            <span class="bank-kind-badge">${esc(header.kindBadge)}</span>
            <h3 class="bank-row-title">${esc(header.title)}</h3>
            <span class="bank-readiness-badge is-ready">${esc(header.headerStatus)}</span>
          </div>
          ${header.location ? `<p class="bank-row-location">${esc(header.location)}</p>` : ""}
          ${stats ? `<div class="bank-row-stats">${stats}</div>` : ""}
          ${header.contactMarkup ? `<p class="bank-row-contact">${header.contactMarkup}</p>` : ""}
        </header>

        <section class="bank-workspace-section iaqar-workflow-step" id="bankWorkspacePrimaryActions">
          <h4>إجراءات الفرصة</h4>
          <div class="bank-workspace-actions iaqar-workflow-actions">${actions.map(workspaceActionButton).join("")}</div>
        </section>

        <section class="bank-workspace-section iaqar-workflow-step" id="bankWorkspaceSendShareHub" hidden>
          <h4>إرسال ومشاركة</h4>
          <div class="bank-workspace-hub-options iaqar-workflow-actions">${hubButtons}</div>
        </section>

        <section class="bank-workspace-section iaqar-workflow-step" id="bankWorkspaceWhatsAppListing" hidden>
          <h4>معاينة إعلان واتساب</h4>
          <pre class="bank-listing-preview" id="bankListingPreviewText">${esc(listingPreview)}</pre>
          <div class="bank-workspace-actions iaqar-workflow-actions">
            <button type="button" class="bank-action-primary iaqar-workflow-btn success" id="bankOpenWhatsAppListingBtn">فتح واتساب</button>
            <button type="button" class="bank-action iaqar-workflow-btn secondary" id="bankCopyListingBtn">نسخ الإعلان</button>
          </div>
          <p class="section-status" id="bankListingShareStatus" role="status"></p>
          <p class="bank-note iaqar-workflow-note">اختر المستلم بنفسك في واتساب — لا يُدرج رقم المالك أو العميل.</p>
        </section>

        <section class="bank-workspace-section iaqar-workflow-step" id="bankWorkspaceMatchesSection" hidden>
          <h4>نتائج المطابقة</h4>
          <p class="bank-note iaqar-workflow-note" id="bankMatchesStatus" role="status"></p>
          <div class="bank-workspace-match-list">${matchRows || "<p class='bank-note'>لا توجد مطابقات محفوظة.</p>"}</div>
        </section>

        <section class="bank-workspace-section iaqar-workflow-step" id="bankWorkspaceShareSection" hidden>
          ${buildSuitableOfficesShareSectionHtml()}
        </section>

        <section class="bank-workspace-section iaqar-workflow-step" id="bankWorkspacePartySection" hidden>
          <h4>${esc(isOwnerPartyLabel(record))}</h4>
          <div class="bank-workspace-party-actions iaqar-workflow-actions">${partyActionButtons}</div>
        </section>

        <section class="bank-workspace-section iaqar-workflow-step" id="bankWorkspaceCoopSection">
          <h4>مشاركات المكاتب</h4>
          <div id="bankWorkspaceCoopList">${coopRows || "<p class='bank-note'>لا توجد مشاركات نشطة.</p>"}</div>
        </section>

        ${contactOutcomesSection}

        <section class="bank-workspace-section iaqar-workflow-step" id="bankWorkspaceFollowUpSection" hidden>
          <h4>المتابعة والنشاط</h4>
          ${followUpLabel ? `<p class="bank-workspace-followup-card">الموعد القادم: ${esc(followUpLabel)}</p>` : ""}
          <div class="bank-followup-quick iaqar-workflow-actions" id="bankFollowUpQuick">
            <button type="button" class="bank-action iaqar-workflow-btn secondary" data-followup-days="0">اليوم</button>
            <button type="button" class="bank-action iaqar-workflow-btn secondary" data-followup-days="1">غدًا</button>
            <button type="button" class="bank-action iaqar-workflow-btn secondary" data-followup-days="2">بعد غد</button>
            <label>تاريخ ووقت
              <input type="datetime-local" id="bankCustomFollowUp">
            </label>
            <button type="button" class="bank-action iaqar-workflow-btn success" id="bankSaveFollowUpCustom">حفظ موعد المتابعة</button>
          </div>
          <ul class="bank-workspace-activity">${activityRows}</ul>
        </section>

        <section class="bank-workspace-section iaqar-workflow-step" id="bankWorkspaceCloseSection" hidden>
          <h4>إنهاء الفرصة</h4>
          <p class="bank-note iaqar-workflow-note">استخدم إدارة الفرصة لإنهاء وأرشفة الفرصة.</p>
        </section>

        <div id="bankCooperationRoomPanel" class="bank-cooperation-room iaqar-workflow-step" hidden></div>
        <div id="bankMatchComparisonPanel" class="bank-match-comparison iaqar-workflow-step" hidden></div>
      </div>
    </div>
    ${archived ? "" : `<div id="bankCloseFormHost" hidden></div>`}`;
}

export function buildMatchComparisonHtml(sourceRecord, counterpart = {}, match = {}) {
  const reasons = (match.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("");
  const warnings = (match.warnings || []).map((r) => `<li>${esc(r)}</li>`).join("");
  return `
    <div class="bank-detail-head iaqar-workflow-head">
      <h3>مقارنة المطابقة</h3>
      <button type="button" class="settings-close iaqar-workflow-close" id="bankMatchComparisonClose" aria-label="إغلاق">×</button>
    </div>
    <div class="bank-match-compare-grid">
      <article>
        <h4>الفرصة الحالية</h4>
        <p>${esc(sourceRecord.propertyType || "")} — ${esc(sourceRecord.district || "")}</p>
        <p>${esc(sourceRecord.city || "")}</p>
      </article>
      <article>
        <h4>الفرصة المطابقة</h4>
        <p>${esc(counterpart.propertyType || "")} — ${esc(counterpart.district || "")}</p>
        <p>${esc(counterpart.city || "")}</p>
      </article>
    </div>
    <div>
      <h4>أسباب المطابقة (${esc(String(match.score || 0))}%)</h4>
      <ul>${reasons || "<li>—</li>"}</ul>
      ${warnings ? `<h4>تعارضات أو نقص</h4><ul>${warnings}</ul>` : ""}
    </div>`;
}

export function buildCooperationRoomHtml(room = {}, cooperation = {}) {
  return `
    <div class="bank-detail-head iaqar-workflow-head">
      <h3>غرفة التعاون</h3>
      <button type="button" class="settings-close iaqar-workflow-close" id="bankCoopRoomClose" aria-label="إغلاق">×</button>
    </div>
    <p><strong>المكتب الأصلي:</strong> ${esc(cooperation.originatingOfficeName || cooperation.originatingOfficeId)}</p>
    <p><strong>المكتب المتعاون:</strong> ${esc(cooperation.targetOfficeName || cooperation.targetOfficeId)}</p>
    <p><strong>الحالة:</strong> ${esc(cooperationStatusLabel(cooperation.status))}</p>
    <p class="bank-note iaqar-workflow-note">ملخص آمن: ${esc(room.summaryPropertyType || "")} — ${esc(room.summaryCity || "")} — ${esc(room.summaryDistrict || "")}</p>
    <div class="bank-workspace-actions iaqar-workflow-actions">
      <button type="button" class="bank-action danger iaqar-workflow-btn danger" data-workspace-action="end_cooperation">إنهاء التعاون</button>
    </div>`;
}
