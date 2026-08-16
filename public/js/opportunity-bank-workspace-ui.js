/**
 * Ready Opportunity Workspace — HTML builders (no DOM).
 */

import {
  buildBestNextAction,
  buildWorkspaceHeader,
  buildWorkspaceActivity,
  cooperationStatusLabel,
  missingFieldEditorRows,
  workspaceSmartActions,
  sortMatchesForWorkspace
} from "./opportunity-workspace-domain.js";
import { missingFieldLabelsArabic } from "./opportunity-readiness-domain.js";
import { activeFollowUpFromRecord, formatFollowUpAppointmentLine } from "./opportunity-followup-domain.js";

function esc(text = "") {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function workspaceActionButton(action) {
  return `<button type="button" class="bank-workspace-action" data-workspace-action="${esc(action.id)}">${esc(action.label)}</button>`;
}

export function buildNeedsCompletionDetailHtml(id, record, readiness = {}) {
  const missingNames = missingFieldLabelsArabic(readiness.matchingReadinessMissing || []);
  const rows = missingFieldEditorRows(record);
  const fieldBlocks = rows.map((row) => {
    const selector = row.key === "contactPhone" ? "advertiserPhoneLocal"
      : row.key === "advertiserRole" ? "advertiserRole"
      : row.key === "priceOrBudget" ? "priceOrBudget"
      : row.key;
    if (row.key === "advertiserRole") {
      return `<label>${esc(row.label)}
        <select name="advertiserRole">
          <option value="">اختر</option>
          <option value="OWNER" ${record.advertiserRole === "OWNER" ? "selected" : ""}>مالك</option>
          <option value="DELEGATE" ${record.advertiserRole === "DELEGATE" ? "selected" : ""}>مفوض</option>
          <option value="BROKER" ${record.advertiserRole === "BROKER" ? "selected" : ""}>وسيط</option>
          <option value="CLIENT" ${record.advertiserRole === "CLIENT" ? "selected" : ""}>عميل</option>
        </select>
      </label>`;
    }
    if (row.key === "purpose") {
      return `<label>${esc(row.label)}
        <input name="propertyType" class="arabic-suggest-input" value="${esc(record.propertyType || "")}">
      </label>`;
    }
    const type = row.key === "priceOrBudget" || row.key === "area" || row.key === "rooms" ? "number" : "text";
    return `<label>${esc(row.label)}
      <input name="${esc(selector)}" type="${type}" value="${esc(String(row.value ?? ""))}">
    </label>`;
  }).join("");

  return `
    <div class="bank-detail-head">
      <h3>استكمال الفرصة</h3>
      <button type="button" class="settings-close" id="bankDetailClose" aria-label="إغلاق">×</button>
    </div>
    <section class="bank-missing-banner is-incomplete" aria-live="polite">
      <strong>ينقص: ${esc(missingNames.join("، "))}</strong>
    </section>
    <form id="bankUnifiedForm" class="bank-unified-form bank-incomplete-form" autocomplete="off">
      <div class="bank-edit-grid">${fieldBlocks}</div>
      <label>اسم أو وصف المعلن
        <input type="text" name="advertiserDisplayName" maxlength="120" value="${esc(record.advertiserDisplayName || record.contactName || "")}">
      </label>
      ${(readiness.matchingReadinessMissing || []).includes("contactPhone")
        ? `<label>رقم الجوال
            <input name="advertiserPhoneLocal" type="tel" inputmode="numeric" maxlength="10" placeholder="05XXXXXXXX"
              value="${esc(record.advertiserPhoneNormalized || record.contactPhone || "")}">
          </label>`
        : ""}
    </form>
    <div class="bank-unified-save-wrap">
      <button type="button" class="bank-action-primary" id="bankUnifiedSaveBtn">حفظ واستكمال الفرصة</button>
      <p class="section-status" id="bankUnifiedSaveStatus" role="status"></p>
    </div>`;
}

export function buildReadyWorkspaceHtml(id, record, bundle = {}) {
  const header = buildWorkspaceHeader(record);
  const matches = sortMatchesForWorkspace(bundle.matches || [], id);
  const suggestions = bundle.suggestions || [];
  const bestNext = buildBestNextAction({
    record,
    matches,
    suggestions,
    followUp: bundle.followUp || activeFollowUpFromRecord(record)
  });
  const actions = workspaceSmartActions(record);
  const activity = buildWorkspaceActivity(record, bundle.cooperationRequests || []);
  const followUp = bundle.followUp || activeFollowUpFromRecord(record);
  const archived = record.lifecycleStatus === "ARCHIVED" || Boolean(record.archivedAt);

  const stats = [
    header.priceText ? `<div class="bank-stat"><span class="bank-stat-label">السعر</span><strong>${esc(header.priceText)}</strong></div>` : "",
    header.areaText ? `<div class="bank-stat"><span class="bank-stat-label">المساحة</span><strong>${esc(header.areaText)}</strong></div>` : "",
    header.roomsText ? `<div class="bank-stat"><span class="bank-stat-label">الغرف</span><strong>${esc(header.roomsText)}</strong></div>` : ""
  ].filter(Boolean).join("");

  const matchRows = matches.slice(0, 8).map((match) => {
    const counterpartId = match.opportunityId === id ? match.counterpartOpportunityId : match.opportunityId;
    const reason = (match.reasons || []).slice(0, 2).join(" — ");
    return `<button type="button" class="bank-workspace-match-row" data-match-id="${esc(match.matchId)}" data-counterpart-id="${esc(counterpartId)}">
      <span class="bank-workspace-match-score">${esc(String(match.score))}%</span>
      <span class="bank-workspace-match-body">
        <strong>${esc(match.propertyType || "مطابقة")} — ${esc(match.district || "")}</strong>
        <small>${esc(reason)}</small>
      </span>
    </button>`;
  }).join("");

  const suggestionRows = suggestions.map((row) => `
    <div class="bank-workspace-office-row">
      <strong>${esc(row.officeName || row.officeId)}</strong>
      <span>${esc(row.neighborhoodLabel || row.reason || "")}</span>
      ${row.matchScore ? `<span>${esc(String(row.matchScore))}%</span>` : ""}
      <span class="bank-note">${row.hasOppositeOpportunity ? "فرصة معاكسة" : "بدون فرصة معاكسة"}</span>
      <button type="button" class="bank-action" data-cooperation-request="${esc(row.officeId)}">مشاركة</button>
    </div>`).join("");

  const coopRows = (bundle.cooperationRequests || []).map((row) => `
    <div class="bank-workspace-coop-row">
      <strong>${esc(row.targetOfficeName || row.targetOfficeId)}</strong>
      <span>${esc(cooperationStatusLabel(row.status))}</span>
      ${String(row.status).toUpperCase() === "ACCEPTED"
        ? `<button type="button" class="bank-action" data-open-coop-room="${esc(row.id)}">فتح غرفة التعاون</button>`
        : ""}
    </div>`).join("");

  const activityRows = activity.map((row) =>
    `<li><time>${esc(new Date(row.at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }))}</time> ${esc(row.text)}</li>`
  ).join("");

  const followUpLabel = followUp?.at ? formatFollowUpAppointmentLine(followUp.at) : "";

  return `
    <div class="bank-workspace-layout">
      <div class="bank-workspace-main">
        <div class="bank-detail-head">
          <button type="button" class="settings-close" id="bankDetailClose" aria-label="إغلاق">×</button>
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

        <section class="bank-workspace-section" id="bankWorkspaceBestNext">
          <h4>الإجراء الأفضل الآن</h4>
          <button type="button" class="bank-workspace-best-next" data-workspace-action="${esc(bestNext.action)}">
            ${esc(bestNext.label)}
          </button>
        </section>

        <section class="bank-workspace-section bank-workspace-panel-mobile" id="bankWorkspaceActionsMobile" hidden>
          <h4>إجراءات ذكية</h4>
          <div class="bank-workspace-actions">${actions.map(workspaceActionButton).join("")}</div>
        </section>

        <section class="bank-workspace-section" id="bankWorkspaceMatchesSection" hidden>
          <h4>المطابقات</h4>
          <div class="bank-workspace-match-list">${matchRows || "<p class='bank-note'>لا توجد مطابقات محفوظة.</p>"}</div>
        </section>

        <section class="bank-workspace-section" id="bankWorkspaceOfficesSection" hidden>
          <h4>مكاتب مقترحة</h4>
          <div class="bank-workspace-office-list">
            ${suggestionRows || "<p class='bank-note'>لا توجد مكاتب متخصصة مناسبة حاليًا</p>"}
          </div>
        </section>

        <section class="bank-workspace-section" id="bankWorkspaceShareSection" hidden>
          <h4>مشاركة مع وسيط</h4>
          <form id="bankDirectShareForm" class="bank-share-form" autocomplete="off">
            <label>ابحث عن مكتب
              <input type="search" id="bankDetailOfficeSearch" placeholder="اسم المكتب أو المدينة" autocomplete="off">
            </label>
            <input type="hidden" name="targetOfficeId" id="bankDetailScopeTarget">
            <div class="bank-office-search-results" id="bankDetailScopeSearchResults" hidden></div>
            <p class="bank-share-selected-office" id="bankDetailScopeSelectedLabel" hidden></p>
            <label>رسالة اختيارية
              <textarea id="bankCooperationMessage" maxlength="500" placeholder="رسالة خاصة للمكتب المستهدف"></textarea>
            </label>
            <button type="submit" class="bank-action-primary">إرسال طلب تعاون</button>
            <p class="bank-share-status section-status" id="bankShareStatus" role="status"></p>
            <p class="bank-note">ملخص خاص — بدون بيانات تواصل قبل الموافقة.</p>
          </form>
        </section>

        <section class="bank-workspace-section" id="bankWorkspaceCoopSection">
          <h4>حالة التعاون</h4>
          ${coopRows || "<p class='bank-note'>لا توجد طلبات تعاون نشطة.</p>"}
        </section>

        <section class="bank-workspace-section" id="bankWorkspaceFollowUpSection">
          <h4>المتابعة والنشاط</h4>
          ${followUpLabel ? `<p class="bank-workspace-followup-card">الموعد القادم: ${esc(followUpLabel)}</p>` : ""}
          <div class="bank-followup-quick" id="bankFollowUpQuick">
            <button type="button" class="bank-action" data-followup-days="0">اليوم</button>
            <button type="button" class="bank-action" data-followup-days="1">غدًا</button>
            <button type="button" class="bank-action" data-followup-days="2">بعد غد</button>
            <label>تاريخ ووقت
              <input type="datetime-local" id="bankCustomFollowUp">
            </label>
            <button type="button" class="bank-action" id="bankSaveFollowUpCustom">حفظ موعد المتابعة</button>
          </div>
          <ul class="bank-workspace-activity">${activityRows}</ul>
        </section>

        <section class="bank-workspace-section" id="bankWorkspaceCloseSection" hidden>
          <h4>إنهاء الفرصة</h4>
          <p class="bank-note">اختر سبب الإنهاء من الإجراءات الذكية.</p>
        </section>

        <div id="bankCooperationRoomPanel" class="bank-cooperation-room" hidden></div>
        <div id="bankMatchComparisonPanel" class="bank-match-comparison" hidden></div>
      </div>

      <aside class="bank-workspace-side" id="bankWorkspaceActionsSide">
        <h4>إجراءات ذكية</h4>
        <div class="bank-workspace-actions">${actions.map(workspaceActionButton).join("")}</div>
      </aside>
    </div>
    <div id="bankContactOutcomesWrap" hidden>
      <div class="bank-contact-outcomes" id="bankContactOutcomes">
        <button type="button" class="bank-action" data-contact-outcome="NO_RESPONSE">لم يرد</button>
        <button type="button" class="bank-action" data-contact-outcome="INTERESTED">مهتم</button>
        <button type="button" class="bank-action" data-contact-outcome="REFUSED">غير مهتم</button>
        <button type="button" class="bank-action" data-contact-outcome="FOLLOW_UP">طلب متابعة</button>
        <button type="button" class="bank-action" data-contact-outcome="AGREED">تم الاتفاق</button>
      </div>
    </div>
    ${archived ? "" : `<div id="bankCloseFormHost" hidden></div>`}`;
}

export function buildMatchComparisonHtml(sourceRecord, counterpart = {}, match = {}) {
  const reasons = (match.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("");
  const warnings = (match.warnings || []).map((r) => `<li>${esc(r)}</li>`).join("");
  return `
    <div class="bank-detail-head">
      <h3>مقارنة المطابقة</h3>
      <button type="button" class="settings-close" id="bankMatchComparisonClose" aria-label="إغلاق">×</button>
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
    <div class="bank-detail-head">
      <h3>غرفة التعاون</h3>
      <button type="button" class="settings-close" id="bankCoopRoomClose" aria-label="إغلاق">×</button>
    </div>
    <p><strong>المكتب الأصلي:</strong> ${esc(cooperation.originatingOfficeName || cooperation.originatingOfficeId)}</p>
    <p><strong>المكتب المتعاون:</strong> ${esc(cooperation.targetOfficeName || cooperation.targetOfficeId)}</p>
    <p><strong>الحالة:</strong> ${esc(cooperationStatusLabel(cooperation.status))}</p>
    <p class="bank-note">ملخص آمن: ${esc(room.summaryPropertyType || "")} — ${esc(room.summaryCity || "")} — ${esc(room.summaryDistrict || "")}</p>
    <div class="bank-workspace-actions">
      <button type="button" class="bank-action danger" data-workspace-action="end_cooperation">إنهاء التعاون</button>
    </div>`;
}
