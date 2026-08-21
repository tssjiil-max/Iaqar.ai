/**
 * Opportunity bank workspace + needs-completion form — HTML only (no DOM).
 */

import {
  buildWorkspaceActivity,
  buildIncompleteFormFields,
  contactPartyLabel,
  sortMatchesForWorkspace,
  cooperationStatusLabel,
  activeWorkspaceCooperationRequests,
  mergeWorkspaceCooperationRequests
} from "./opportunity-workspace-domain.js";
import { officeShareStatusLabel,
  readyWorkspacePrimaryActions,
  partyContactActions,
  sendAndShareHubOptions,
  buildPublicListingAnnouncement
} from "./opportunity-ready-actions-domain.js";
import {
  buildOpportunityDetailsCoreHtml,
} from "./opportunity-details-ui.js";
import { activeFollowUpFromRecord, formatFollowUpAppointmentLine } from "./opportunity-followup-domain.js";
import {
  CONTACT_OUTCOME_LABELS,
  CONTACT_OUTCOME_ORDER,
  REFUSAL_REASON_OPTIONS,
  defaultContactFollowUpInput,
  defaultContactRetryInput,
  buildContactOutcomeSaveFooterHtml,
  shouldShowContactOutcomePanel
} from "./opportunity-contact-outcome-domain.js";
import { buildOfficeCooperationPanelHtml } from "./suitable-offices-ui.js";
import { currentCooperationShareStatusLabel } from "./office-cooperation-ui-domain.js";
import {
  buildWorkspaceSummaryStripHtml,
  buildWorkspaceNextStepHtml,
  resolveWorkspaceNextAction,
  buildWorkspaceSectionPreviews,
  wrapWorkspaceCollapsibleSection,
  buildWorkspaceSecondaryActionsHtml
} from "./opportunity-workspace-ux-ui.js";
import { evaluateMatchingReadiness } from "./opportunity-readiness-domain.js";

function esc(text = "") {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

const WORKSPACE_ACTION_KEYS = {
  search_matches: "workspace:search_matches",
  send_and_share: "workspace:send_and_share",
  contact_party: "workspace:contact_party",
  manage_opportunity: "workspace:manage_opportunity"
};

const HUB_OPTION_KEYS = {
  share_whatsapp_listing: "hub:share_whatsapp_listing",
  share_to_office: "hub:share_to_office",
  copy_listing_text: "hub:copy_listing_text"
};

export function buildWorkspaceCoopRowsHtml(cooperationRequests = [], options = {}) {
  const ownOfficeId = String(options.ownOfficeId || "").trim().toLowerCase();
  const rows = activeWorkspaceCooperationRequests(cooperationRequests);
  if (!rows.length) return "";
  return rows.map((row) => {
    const requestId = String(row.id || "").trim();
    const status = String(row.status || "").toUpperCase();
    const isOrigin = ownOfficeId && String(row.originatingOfficeId || "").trim().toLowerCase() === ownOfficeId;
    const peerName = isOrigin
      ? (row.targetOfficeName || row.targetOfficeId || "مكتب")
      : (row.originatingOfficeName || row.originatingOfficeId || "مكتب");
    const statusLabel = isOrigin ? currentCooperationShareStatusLabel(status) : officeShareStatusLabel(status);
    const sentAt = row.requestedAt || row.createdAt;
    const sentLabel = sentAt
      ? new Date(sentAt).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })
      : "";
    const actions = [];
    if (status === "ACCEPTED" && requestId) {
      actions.push(`<button type="button" class="bank-action iaqar-workflow-btn secondary" data-open-coop-room="${esc(requestId)}">فتح غرفة التعاون</button>`);
    }
    if (status === "PENDING" && isOrigin && requestId) {
      actions.push(`<button type="button" class="bank-action iaqar-workflow-btn secondary" data-cancel-coop-request="${esc(requestId)}">إلغاء الطلب</button>`);
    }
    return `
    <div class="bank-workspace-coop-row" data-coop-request-id="${esc(requestId)}" data-coop-target-id="${esc(row.targetOfficeId || "")}">
      <strong>${esc(peerName)}</strong>
      <span>${esc(statusLabel)}</span>
      ${sentLabel ? `<small>${esc(sentLabel)}</small>` : ""}
      ${actions.join("")}
    </div>`;
  }).join("");
}

export function buildWorkspaceCoopEmptyHintHtml() {
  return `<p class="bank-note bank-workspace-coop-empty" id="bankWorkspaceCoopHint">لا توجد مشاركات حتى الآن.</p>`;
}

function partyActionBrokerKey(actionId = "") {
  const id = String(actionId || "").trim();
  if (id === "party_whatsapp") return "party:whatsapp";
  if (id === "party_call") return "party:call";
  return id ? `party:${id}` : "";
}

function renderFieldBlock(field) {
  const placeholder = field.placeholder ? ` placeholder="${esc(field.placeholder)}"` : "";
  switch (field.type) {
    case "phone":
      return `<label>${esc(field.label)}
        <input name="advertiserPhoneLocal" type="tel" inputmode="numeric" maxlength="14"
          placeholder="05XXXXXXXX أو +9665XXXXXXXX" value="${esc(field.value)}"
          aria-label="رقم الجوال الكامل" autocomplete="off">
        <small class="bank-advertiser-phone-error" id="bankAdvertiserPhoneError" hidden></small>
      </label>`;
    case "number":
      return `<label>${esc(field.label)}
        <input name="${esc(field.name)}" type="number" value="${esc(String(field.value ?? ""))}" autocomplete="off">
      </label>`;
    case "select": {
      const options = (field.options || []).map((option) => {
        const selected = option.value === field.value ? " selected" : "";
        return `<option value="${esc(option.value)}"${selected}>${esc(option.label)}</option>`;
      }).join("");
      const placeholder = field.value
        ? ""
        : `<option value="" selected disabled hidden>اختر صفة المعلن</option>`;
      return `<label>${esc(field.label)}
        <select name="${esc(field.name || field.key)}" aria-label="${esc(field.label)}">${placeholder}${options}</select>
      </label>`;
    }
    default:
      return `<label>${esc(field.label)}
        <input name="${esc(field.name || field.key)}" type="text" value="${esc(String(field.value ?? ""))}" autocomplete="off"${placeholder}>
      </label>`;
  }
}

export function buildNeedsCompletionDetailHtml(id, record, readiness = {}) {
  const fields = buildIncompleteFormFields(record, readiness);
  const fieldBlocks = fields.map(renderFieldBlock).join("");
  const { html: detailsHtml } = buildOpportunityDetailsCoreHtml(id, record, readiness);
  const nextAction = resolveWorkspaceNextAction(record, {});

  return `
    <div class="bank-detail-head iaqar-workflow-head">
      <h3>تفاصيل الفرصة</h3>
      <button type="button" class="settings-close iaqar-workflow-close" id="bankDetailClose" aria-label="إغلاق">×</button>
    </div>
    ${buildWorkspaceSummaryStripHtml(id, record, readiness)}
    ${buildWorkspaceNextStepHtml(nextAction)}
    ${detailsHtml}
    <section class="bank-incomplete-edit" id="bankIncompleteEditSection" aria-label="تعديل البيانات الناقصة" hidden>
      <form id="bankUnifiedForm" class="bank-unified-form bank-incomplete-form iaqar-workflow-form" autocomplete="off">
        <div class="bank-edit-grid">${fieldBlocks}</div>
      </form>
    </section>
    <div class="bank-unified-save-wrap" id="bankUnifiedSaveWrap" hidden>
      <button type="button" class="bank-action-primary iaqar-workflow-btn success" id="bankUnifiedSaveBtn">حفظ</button>
      <p class="bank-unified-save-note">بعد الحفظ سيتم فحص البيانات تلقائيًا.</p>
      <p class="section-status" id="bankUnifiedSaveStatus" role="status"></p>
    </div>`;
}

function workspaceActionButton(action) {
  const key = WORKSPACE_ACTION_KEYS[action.id] || "";
  const brokerAttr = key ? ` data-broker-action="${esc(key)}"` : "";
  return `<button type="button" class="bank-workspace-action iaqar-workflow-btn secondary" data-workspace-action="${esc(action.id)}"${brokerAttr}>${esc(action.label)}</button>`;
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
        <input type="datetime-local" class="iaqar-workflow-field" id="${esc(inputId)}" value="${esc(defaultValue)}">
      </label>
    </div>`;
}

export function buildContactOutcomeActionHtml(outcome = "", options = {}) {
  const key = String(outcome || "").toUpperCase();
  const retryDefault = options.retryDefault || defaultContactRetryInput();
  const followDefault = options.followDefault || defaultContactFollowUpInput();
  const saveFooter = buildContactOutcomeSaveFooterHtml();
  let body = "";
  switch (key) {
    case "NO_RESPONSE":
      body = `
        <p class="bank-note iaqar-workflow-note">تحديد محاولة اتصال جديدة</p>
        ${buildFollowUpQuickPickHtml("bankContactRetryAt", retryDefault)}`;
      break;
    case "INTERESTED":
      body = `
        <div class="bank-contact-outcome-actions-row iaqar-workflow-actions">
          <button type="button" class="bank-action iaqar-workflow-btn secondary" id="bankContactInterestedFollowUp">تحديد متابعة</button>
          <button type="button" class="bank-action iaqar-workflow-btn secondary" id="bankContactInterestedWhatsApp">تواصل واتساب</button>
        </div>
        <label>ملاحظة قصيرة (اختياري)
          <textarea id="bankContactOutcomeNote" class="iaqar-workflow-field" maxlength="200" rows="2" placeholder="ملاحظة اختيارية"></textarea>
        </label>
        <div id="bankContactInterestedFollowUpPanel" class="bank-contact-outcome-subpanel" hidden>
          ${buildFollowUpQuickPickHtml("bankContactInterestedFollowUpAt", followDefault)}
        </div>`;
      break;
    case "REFUSED":
      const reasons = REFUSAL_REASON_OPTIONS.map((row) =>
        `<button type="button" class="bank-action bank-refusal-reason iaqar-workflow-btn secondary" data-refusal-reason="${esc(row.key)}">${esc(row.label)}</button>`
      ).join("");
      body = `
        <p class="bank-note iaqar-workflow-note">سبب عدم الاهتمام — بعد الحفظ ستُكمَل إنهاء الفرصة من إدارة الفرصة.</p>
        <div class="bank-contact-refusal-reasons iaqar-workflow-actions iaqar-outcome-actions">${reasons}</div>
        <label>ملاحظة (اختياري)
          <textarea id="bankContactOutcomeNote" class="iaqar-workflow-field" maxlength="200" rows="2" placeholder="تفاصيل إضافية"></textarea>
        </label>`;
      break;
    case "FOLLOW_UP":
      body = `
        <p class="bank-note iaqar-workflow-note">اختر موعد المتابعة</p>
        ${buildFollowUpQuickPickHtml("bankContactFollowUpAt", followDefault)}`;
      break;
    case "AGREED":
      body = `
        <p class="bank-note iaqar-workflow-note">بعد الحفظ ستُوجّه لإتمام الصفقة من المطابقة — لن تُغلق الفرصة تلقائيًا.</p>`;
      break;
    default:
      return "";
  }
  return `${body}${saveFooter}`;
}

export function buildContactOutcomesInnerHtml(record = {}, options = {}) {
  const retryDefault = defaultContactRetryInput();
  const followDefault = defaultContactFollowUpInput();
  const outcomeButtons = CONTACT_OUTCOME_ORDER.map((key) =>
    `<button type="button" class="bank-action bank-contact-outcome-btn iaqar-workflow-btn secondary" data-contact-outcome="${esc(key)}" data-broker-action="contact:outcome:${esc(key)}" aria-pressed="false">${esc(CONTACT_OUTCOME_LABELS[key])}</button>`
  ).join("");
  return `
      <p class="bank-contact-outcome-selected-badge" id="bankContactOutcomeSelectedBadge" hidden role="status">
        <span class="bank-contact-outcome-selected-icon" aria-hidden="true">✓</span>
        <span id="bankContactOutcomeSelectedLabel"></span>
      </p>
      <p class="bank-contact-outcome-hint" id="bankContactOutcomeSelectionHint" hidden role="status"></p>
      <div class="bank-contact-outcomes iaqar-workflow-actions iaqar-outcome-actions" id="bankContactOutcomes">${outcomeButtons}</div>
      <div id="bankContactOutcomeActionPanel" class="bank-contact-outcome-action-panel" hidden></div>
      <p class="section-status" id="bankContactOutcomeStatus" role="status"></p>`;
}

export function buildContactOutcomesSectionHtml(record = {}, options = {}) {
  const show = options.show === true || shouldShowContactOutcomePanel(record);
  return `
    <section class="bank-workspace-section iaqar-workflow-step" id="bankWorkspaceContactSection" ${show ? "" : "hidden"}>
      <h4>نتيجة التواصل</h4>
      ${buildContactOutcomesInnerHtml(record, options)}
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
  const readiness = evaluateMatchingReadiness(record);
  const { html: detailsHtml } = buildOpportunityDetailsCoreHtml(id, record, readiness);
  const matches = sortMatchesForWorkspace(bundle.matches || [], id);
  const actions = readyWorkspacePrimaryActions(record);
  const partyActions = partyContactActions(record);
  const hubOptions = sendAndShareHubOptions();
  const ownOfficeId = String(options.ownOfficeId || record.officeId || "").trim();
  const cooperationRequests = mergeWorkspaceCooperationRequests(
    record,
    bundle.cooperationRequests || [],
    ownOfficeId
  );
  const activity = buildWorkspaceActivity(record, cooperationRequests);
  const followUp = bundle.followUp || activeFollowUpFromRecord(record);
  const archived = record.lifecycleStatus === "ARCHIVED" || Boolean(record.archivedAt);
  const contactOutcomesInner = archived ? "" : buildContactOutcomesInnerHtml(record);
  const listingPreview = buildPublicListingAnnouncement(record, options.officeProfile || {}, {
    origin: options.origin || ""
  });
  const nextAction = resolveWorkspaceNextAction(record, bundle);
  const previews = buildWorkspaceSectionPreviews(id, record, {
    ...bundle,
    cooperationRequests
  });

  const matchRows = buildWorkspaceMatchRowsHtml(id, matches);

  const coopRows = buildWorkspaceCoopRowsHtml(cooperationRequests, { ownOfficeId });
  const coopEmpty = coopRows ? "" : buildWorkspaceCoopEmptyHintHtml();

  const partyActionButtons = partyActions.map((action) => {
    const key = partyActionBrokerKey(action.id);
    const brokerAttr = key ? ` data-broker-action="${esc(key)}"` : "";
    return `<button type="button" class="bank-workspace-party-action iaqar-workflow-btn secondary" data-party-action="${esc(action.id)}"${brokerAttr}>${esc(action.label)}</button>`;
  }).join("");

  const hubButtons = hubOptions.map((opt) => {
    const key = HUB_OPTION_KEYS[opt.id] || "";
    const brokerAttr = key ? ` data-broker-action="${esc(key)}"` : "";
    return `<button type="button" class="bank-workspace-hub-option iaqar-workflow-btn secondary" data-send-share-option="${esc(opt.id)}"${brokerAttr}>${esc(opt.label)}</button>`;
  }).join("");

  const activityRows = activity.map((row) =>
    `<li><time>${esc(new Date(row.at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }))}</time> ${esc(row.text)}</li>`
  ).join("");

  const followUpLabel = followUp?.at ? formatFollowUpAppointmentLine(followUp.at) : "";

  const coopBody = `
    ${archived ? "" : buildOfficeCooperationPanelHtml()}
    <div class="bank-coop-current-wrap">
      <p class="bank-coop-current-title">المشاركات الحالية</p>
      <p class="bank-note iaqar-workflow-note" id="bankWorkspaceCoopStatus" role="status" hidden></p>
      <div id="bankWorkspaceCoopList">${coopRows || coopEmpty}</div>
    </div>`;

  return `
    <div class="bank-workspace-layout">
      <div class="bank-workspace-main">
        <div class="bank-detail-head iaqar-workflow-head">
          <h3>تفاصيل الفرصة</h3>
          <button type="button" class="settings-close iaqar-workflow-close" id="bankDetailClose" aria-label="إغلاق">×</button>
        </div>
        ${buildWorkspaceSummaryStripHtml(id, record, readiness)}
        ${buildWorkspaceNextStepHtml(nextAction)}
        ${detailsHtml}

        <section class="bank-workspace-section iaqar-workflow-step bank-workspace-ux-actions-wrap" id="bankWorkspacePrimaryActions">
          ${buildWorkspaceSecondaryActionsHtml(actions)}
        </section>

        ${wrapWorkspaceCollapsibleSection({
          id: "bankWorkspaceSendShareHub",
          title: "إرسال ومشاركة",
          preview: "واتساب — مكتب — نسخ الإعلان",
          hidden: true,
          collapsed: true,
          body: `<div class="bank-workspace-hub-options iaqar-workflow-actions">${hubButtons}</div>`
        })}

        ${wrapWorkspaceCollapsibleSection({
          id: "bankWorkspaceWhatsAppListing",
          title: "معاينة إعلان واتساب",
          preview: "مشاركة يدوية عبر واتساب",
          hidden: true,
          collapsed: true,
          body: `
          <pre class="bank-listing-preview" id="bankListingPreviewText">${esc(listingPreview)}</pre>
          <div class="bank-workspace-actions iaqar-workflow-actions">
            <button type="button" class="bank-action-primary iaqar-workflow-btn success" id="bankOpenWhatsAppListingBtn" data-broker-action="hub:share_whatsapp_listing">فتح واتساب</button>
            <button type="button" class="bank-action iaqar-workflow-btn secondary" id="bankCopyListingBtn" data-broker-action="hub:copy_listing_text">نسخ الإعلان</button>
          </div>
          <p class="section-status" id="bankListingShareStatus" role="status"></p>
          <p class="bank-note iaqar-workflow-note">اختر المستلم بنفسك في واتساب — لا يُدرج رقم المالك أو العميل.</p>`
        })}

        ${wrapWorkspaceCollapsibleSection({
          id: "bankWorkspaceMatchesSection",
          title: "المطابقة",
          preview: previews.matches,
          hidden: true,
          collapsed: true,
          body: `
          <p class="bank-note iaqar-workflow-note" id="bankMatchesStatus" role="status"></p>
          <div class="bank-workspace-match-list">${matchRows || "<p class='bank-note'>لا توجد مطابقات محفوظة.</p>"}</div>`
        })}

        ${wrapWorkspaceCollapsibleSection({
          id: "bankWorkspacePartySection",
          title: isOwnerPartyLabel(record),
          preview: "اتصال — واتساب — معاينة",
          hidden: true,
          collapsed: true,
          body: `<div class="bank-workspace-party-actions iaqar-workflow-actions">${partyActionButtons}</div>`
        })}

        ${wrapWorkspaceCollapsibleSection({
          id: "bankWorkspaceCoopSection",
          title: "التعاون مع المكاتب",
          preview: previews.coop,
          collapsed: false,
          body: coopBody
        })}

        ${contactOutcomesInner ? wrapWorkspaceCollapsibleSection({
          id: "bankWorkspaceContactSection",
          title: "نتيجة التواصل",
          preview: "تسجيل نتيجة التواصل",
          hidden: !shouldShowContactOutcomePanel(record),
          collapsed: true,
          body: contactOutcomesInner
        }) : ""}

        ${wrapWorkspaceCollapsibleSection({
          id: "bankWorkspaceFollowUpSection",
          title: "المتابعة والنشاط",
          preview: followUpLabel ? previews.followUp : previews.activity,
          hidden: true,
          collapsed: true,
          body: `
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
          <ul class="bank-workspace-activity">${activityRows}</ul>`
        })}

        ${wrapWorkspaceCollapsibleSection({
          id: "bankWorkspaceCloseSection",
          title: "إنهاء الفرصة",
          preview: previews.close,
          hidden: true,
          collapsed: true,
          extraClass: "bank-workspace-collapsible--muted",
          body: `
          <p class="bank-note iaqar-workflow-note">سجّل نتيجة التواصل أولًا، ثم أكمل الإغلاق والأرشفة.</p>
          <div class="bank-workspace-actions iaqar-workflow-actions">
            <button type="button" class="bank-action iaqar-workflow-btn secondary" data-workspace-action="open_lifecycle_close">إنهاء وأرشفة الفرصة</button>
          </div>`
        })}

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
