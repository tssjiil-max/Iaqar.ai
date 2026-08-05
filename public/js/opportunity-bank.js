/**
 * Phase 3 — Opportunity Bank UI controller.
 * Accessible only from Office Settings → بنك الفرص.
 */

import {
  BANK_PAGE_SIZE,
  LIFECYCLE,
  SHARE_REQUEST_STATUS,
  bankDetailView,
  bankListItem,
  buildArchivePatch,
  buildBankSharingScope,
  buildCooperationRequest,
  buildEditPatch,
  buildRestorePatch,
  buildSoftDeletePatch,
  cooperationStateFromShareStatus,
  cooperationStatusLabel,
  phase3BoundaryGuarantees,
  validateOwnedOpportunityIds
} from "./opportunity-bank-domain.js";
import {
  phase4BoundaryGuarantees,
  requestOpportunityRematch
} from "./matching-domain.js";
import {
  phase5BoundaryGuarantees,
  requestCooperationOperationSync,
  requestMissingDataOperationSync
} from "./operations-domain.js";
import {
  phase6BoundaryGuarantees,
  cooperationModeAllowsExplicitRequest,
  cooperationModeAllowsAccept,
  normalizeCooperationMode,
  requestCooperationLifecycle,
  requestScopeRevoke,
  FIVE_ARABIC_COOPERATION_STATUSES
} from "./cooperation-phase6-domain.js";
import { DEFAULT_COOPERATION_MODE } from "./office-domain.js";

function $(id) {
  return document.getElementById(id);
}

function toast(message) {
  const node = $("toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  window.clearTimeout(toast._timer);
  toast._timer = window.setTimeout(() => node.classList.remove("show"), 2800);
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function officeRuntime() {
  return window.IAQAR?.office || null;
}

function authUser() {
  try {
    return window.firebase?.auth?.()?.currentUser || null;
  } catch {
    return null;
  }
}

function officeId() {
  return officeRuntime()?.officeId || "";
}

function setStatus(message, tone = "") {
  const node = $("opportunityBankStatus");
  if (!node) return;
  node.textContent = message || "";
  node.classList.remove("is-error", "is-done");
  if (tone) node.classList.add(tone);
}

const state = {
  filter: "active", // active | archived
  unsubscribe: null,
  records: new Map(),
  selected: new Set(),
  activeId: null,
  sourceCache: new Map(),
  lastDoc: null,
  hasMore: false,
  busy: false
};

function stopListener() {
  if (state.unsubscribe) {
    try { state.unsubscribe(); } catch (_) {}
    state.unsubscribe = null;
  }
}

function isVisibleForFilter(record) {
  if (record.deletedAt || record.lifecycleStatus === LIFECYCLE.DELETED) return false;
  if (state.filter === "archived") {
    return record.lifecycleStatus === LIFECYCLE.ARCHIVED || Boolean(record.archivedAt);
  }
  // active
  if (record.lifecycleStatus === LIFECYCLE.ARCHIVED) return false;
  if (record.archivedAt && record.lifecycleStatus !== LIFECYCLE.ACTIVE) return false;
  return true;
}

function renderList() {
  const list = $("opportunityBankList");
  if (!list) return;
  const rows = [...state.records.entries()]
    .filter(([, record]) => isVisibleForFilter(record))
    .map(([id, record]) => bankListItem(id, record));

  if (!rows.length) {
    list.innerHTML = "";
    return;
  }

  list.innerHTML = rows.map((row) => `
    <article class="bank-row" data-opportunity-id="${escapeHtml(row.id)}">
      <label class="bank-select">
        <input type="checkbox" data-select-id="${escapeHtml(row.id)}" ${state.selected.has(row.id) ? "checked" : ""}>
        <span class="visually-hidden">تحديد</span>
      </label>
      <button type="button" class="bank-row-main" data-open-id="${escapeHtml(row.id)}">
        <h3>${escapeHtml(row.kindLabel)} — ${escapeHtml(row.propertyType)}</h3>
        <dl>
          <dt>الغرض</dt><dd>${escapeHtml(row.purpose)}</dd>
          <dt>الموقع</dt><dd>${escapeHtml(row.location)}</dd>
          <dt>${escapeHtml(row.amountLabel)}</dt><dd>${escapeHtml(row.amountText)}</dd>
          ${row.attributes.length ? `<dt>المواصفات</dt><dd>${escapeHtml(row.attributes.join(" • "))}</dd>` : ""}
          <dt>تاريخ الإضافة</dt><dd>${escapeHtml(row.dateAdded)}</dd>
          <dt>حالة التعاون</dt><dd>${escapeHtml(row.cooperationStatus)}</dd>
        </dl>
      </button>
    </article>
  `).join("");
}

async function lazyLoadSource(record) {
  if (!record?.sourceReference) return null;
  if (state.sourceCache.has(record.sourceReference)) {
    return state.sourceCache.get(record.sourceReference);
  }
  const runtime = officeRuntime();
  if (!runtime?.db) return null;
  const snap = await runtime.db.collection("offices").doc(officeId())
    .collection("opportunitySources").doc(record.sourceReference).get();
  const data = snap.exists ? snap.data() : null;
  state.sourceCache.set(record.sourceReference, data);
  return data;
}

async function renderDetail(id) {
  const panel = $("opportunityBankDetail");
  if (!panel) return;
  const record = state.records.get(id);
  if (!record) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }

  setStatus("جارٍ تجهيز التفاصيل…");
  const source = await lazyLoadSource(record);
  const detail = bankDetailView(id, record, { includeSource: true, source });
  state.activeId = id;
  panel.hidden = false;

  const archived = record.lifecycleStatus === LIFECYCLE.ARCHIVED || Boolean(record.archivedAt);
  panel.innerHTML = `
    <div class="bank-detail-head">
      <h3>تفاصيل الفرصة</h3>
      <button type="button" class="settings-close" id="bankDetailClose" aria-label="إغلاق التفاصيل">×</button>
    </div>
    <dl class="bank-detail-grid">
      <dt>النوع</dt><dd>${escapeHtml(detail.opportunityKind)}</dd>
      <dt>الغرض</dt><dd>${escapeHtml(detail.purpose)}</dd>
      <dt>نوع العقار</dt><dd>${escapeHtml(detail.propertyType)}</dd>
      <dt>المدينة</dt><dd>${escapeHtml(detail.city)}</dd>
      <dt>الحي</dt><dd>${escapeHtml(detail.district)}</dd>
      <dt>السعر / الميزانية</dt><dd>${escapeHtml(detail.priceOrBudget)}</dd>
      <dt>المساحة</dt><dd>${detail.area == null ? "—" : escapeHtml(detail.area)}</dd>
      <dt>الغرف</dt><dd>${detail.rooms == null ? "—" : escapeHtml(detail.rooms)}</dd>
      <dt>تاريخ الإضافة</dt><dd>${escapeHtml(detail.dateAdded)}</dd>
      <dt>حالة التعاون</dt><dd>${escapeHtml(detail.cooperationStatus)}</dd>
      ${detail.contactName ? `<dt>الاسم</dt><dd>${escapeHtml(detail.contactName)}</dd>` : ""}
    </dl>
    ${detail.sourcePreview ? `
      <div class="bank-source-preview">
        <strong>المصدر</strong>
        <p>${escapeHtml(detail.sourcePreview.sourceType)} ${detail.sourcePreview.fileName ? "— " + escapeHtml(detail.sourcePreview.fileName) : ""}</p>
        ${detail.sourcePreview.url ? `<p><a href="${escapeHtml(detail.sourcePreview.url)}" target="_blank" rel="noopener">فتح الرابط</a></p>` : ""}
        ${detail.sourcePreview.text ? `<p class="bank-source-text">${escapeHtml(detail.sourcePreview.text)}</p>` : ""}
      </div>` : ""}

    <form id="bankEditForm" class="bank-edit-form" autocomplete="off">
      <h4>تعديل الحقول المسموحة</h4>
      <div class="bank-edit-grid">
        <label>نوع العقار<input name="propertyType" value="${escapeHtml(record.propertyType || "")}"></label>
        <label>المدينة<input name="city" value="${escapeHtml(record.city || "")}"></label>
        <label>الحي<input name="district" value="${escapeHtml(record.district || "")}"></label>
        <label>السعر / الميزانية<input name="priceOrBudget" type="number" value="${record.priceOrBudget ?? record.price ?? ""}"></label>
        <label>المساحة<input name="area" type="number" value="${record.area ?? ""}"></label>
        <label>الغرف<input name="rooms" type="number" value="${record.rooms ?? ""}"></label>
      </div>
      <button type="submit" class="bank-action-primary">حفظ التعديلات</button>
    </form>

    <div class="bank-actions">
      ${archived
        ? `<button type="button" class="bank-action" id="bankRestoreBtn">استعادة</button>`
        : `<button type="button" class="bank-action" id="bankArchiveBtn">أرشفة</button>`}
      <button type="button" class="bank-action" id="bankShareBtn">طلب تعاون</button>
      ${record.activeCooperationId
        ? `<button type="button" class="bank-action" id="bankRevokeBtn">إنهاء التعاون</button>`
        : ""}
      <button type="button" class="bank-action danger" id="bankDeleteBtn">حذف</button>
    </div>
    <div id="bankDeleteConfirm" class="bank-confirm" hidden>
      <p>تأكيد الحذف الآمن؟ سيُحفظ سجل التدقيق ولن يُعرض في القوائم العادية.</p>
      <button type="button" class="bank-action danger" id="bankDeleteConfirmBtn">تأكيد الحذف</button>
      <button type="button" class="bank-action" id="bankDeleteCancelBtn">إلغاء</button>
    </div>
    <form id="bankShareForm" class="bank-share-form" hidden autocomplete="off">
      <label>معرّف المكتب المستهدف
        <input name="targetOfficeId" required placeholder="office-...">
      </label>
      <button type="submit" class="bank-action-primary">إرسال طلب التعاون</button>
      <p class="bank-note">الافتراضي: قراءة فقط، بدون بيانات تواصل، والملكية تبقى لهذا المكتب.</p>
    </form>
  `;

  setStatus(`${rowsCountLabel()} — تم فتح التفاصيل`);
  wireDetailHandlers(id, record);
}

function rowsCountLabel() {
  const count = [...state.records.values()].filter(isVisibleForFilter).length;
  return state.filter === "archived"
    ? `${count} فرصة مؤرشفة`
    : (count ? `${count} فرصة نشطة` : "لا توجد فرص في هذا التصفية");
}

function wireDetailHandlers(id, record) {
  $("bankDetailClose")?.addEventListener("click", () => {
    state.activeId = null;
    const panel = $("opportunityBankDetail");
    if (panel) {
      panel.hidden = true;
      panel.innerHTML = "";
    }
  });

  $("bankEditForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = Object.fromEntries(new FormData(form).entries());
    await saveEdit(id, record, input);
  });

  $("bankArchiveBtn")?.addEventListener("click", () => void archiveOpportunity(id, record));
  $("bankRestoreBtn")?.addEventListener("click", () => void restoreOpportunity(id, record));
  $("bankDeleteBtn")?.addEventListener("click", () => {
    const box = $("bankDeleteConfirm");
    if (box) box.hidden = false;
  });
  $("bankDeleteCancelBtn")?.addEventListener("click", () => {
    const box = $("bankDeleteConfirm");
    if (box) box.hidden = true;
  });
  $("bankDeleteConfirmBtn")?.addEventListener("click", () => void softDeleteOpportunity(id, record));
  $("bankShareBtn")?.addEventListener("click", () => {
    const form = $("bankShareForm");
    if (form) form.hidden = !form.hidden;
  });
  $("bankShareForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const targetOfficeId = new FormData(event.currentTarget).get("targetOfficeId");
    await createShareRequest({ opportunityIds: [id], targetOfficeId, scopeType: "single" });
  });
  $("bankRevokeBtn")?.addEventListener("click", () => void revokeCooperation(id, record));
}

async function patchOpportunity(id, patch) {
  const runtime = officeRuntime();
  const user = authUser();
  if (!runtime?.db || !user) throw new Error("auth_required");
  // Phase 3 bank domain itself never creates matches; Phase 4 rematch is a separate Worker call.
  const boundaries = phase3BoundaryGuarantees();
  if (boundaries.createsMatch) {
    throw new Error("phase_boundary_violation");
  }
  await runtime.db.collection("offices").doc(officeId())
    .collection("opportunities").doc(id)
    .set({
      ...patch,
      officeId: officeId(),
      updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
}

function workerBaseUrl() {
  if (window.IAQAR && typeof window.IAQAR.resolveWorkerBase === "function") {
    return window.IAQAR.resolveWorkerBase();
  }
  if (window.IAQAR?.workerBase || window.IAQAR?.office?.workerBase) {
    return String(window.IAQAR.workerBase || window.IAQAR.office.workerBase).replace(/\/$/, "");
  }
  try {
    const host = String(window.location?.hostname || "").toLowerCase();
    if (host.includes("--staging") || host.startsWith("staging.") || window.IAQAR?.deploymentEnvironment === "staging") {
      return "https://iaqar-intake-staging.iaqar-ai.workers.dev";
    }
  } catch (_) { /* ignore */ }
  return "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
}

async function syncCooperationOperation(cooperationId) {
  const user = authUser();
  if (!user?.getIdToken || !officeId() || !cooperationId) return { ok: false };
  try {
    const token = await user.getIdToken();
    return await requestCooperationOperationSync({
      workerBase: workerBaseUrl(),
      idToken: token,
      officeId: officeId(),
      cooperationId
    });
  } catch (error) {
    console.warn("[iaqar] cooperation operation sync", error);
    return { ok: false, error: "cooperation_ops_failed" };
  }
}

async function readOfficeCooperationMode() {
  const runtime = officeRuntime();
  if (!runtime?.db || !officeId()) return DEFAULT_COOPERATION_MODE;
  try {
    const snap = await runtime.db.collection("offices").doc(officeId())
      .collection("officeSettings").doc("cooperation").get();
    if (!snap.exists) return DEFAULT_COOPERATION_MODE;
    return normalizeCooperationMode(snap.data()?.mode);
  } catch (_) {
    return DEFAULT_COOPERATION_MODE;
  }
}

async function runTrustedCooperationLifecycle(cooperationId, action, reason = "") {
  const user = authUser();
  if (!user?.getIdToken || !officeId() || !cooperationId) {
    return { ok: false, error: "auth_required" };
  }
  const token = await user.getIdToken();
  return requestCooperationLifecycle({
    workerBase: workerBaseUrl(),
    idToken: token,
    officeId: officeId(),
    cooperationId,
    action,
    reason
  });
}

async function rematchOpportunity(id, { reason = "edit" } = {}) {
  const user = authUser();
  if (!user?.getIdToken || !officeId()) return { ok: false, skipped: true };
  try {
    const token = await user.getIdToken();
    const workerBase = workerBaseUrl();
    const result = await requestOpportunityRematch({
      workerBase,
      idToken: token,
      officeId: officeId(),
      opportunityId: id,
      notify: true
    });
    const missingData = await requestMissingDataOperationSync({
      workerBase,
      idToken: token,
      officeId: officeId(),
      opportunityId: id
    });
    window.dispatchEvent(new CustomEvent("iaqar:opportunity-rematched", {
      detail: {
        opportunityId: id,
        reason,
        matchCount: Number(result.matchCount || 0),
        createsOperation: Boolean(result.createsOperation || missingData.created),
        ...phase4BoundaryGuarantees(),
        ...phase5BoundaryGuarantees()
      }
    }));
    return result;
  } catch (error) {
    console.warn("[iaqar] bank rematch", error);
    return { ok: false, error: "rematch_failed" };
  }
}

async function saveEdit(id, existing, input) {
  const user = authUser();
  const result = buildEditPatch(existing, input, { actorUid: user?.uid || "" });
  if (!result.ok) {
    setStatus(result.error === "ownership_fields_protected"
      ? "لا يمكن تعديل حقول الملكية"
      : "لا توجد حقول قابلة للحفظ", "is-error");
    return;
  }
  setStatus("جارٍ الحفظ…");
  try {
    await patchOpportunity(id, result.patch);
    await rematchOpportunity(id, { reason: "edit" });
    setStatus("تم حفظ التعديلات", "is-done");
    toast("تم حفظ الفرصة");
  } catch (error) {
    console.warn("[iaqar] bank edit", error);
    setStatus("تعذر حفظ التعديلات", "is-error");
  }
}

async function archiveOpportunity(id, existing) {
  const user = authUser();
  const result = buildArchivePatch(existing, { actorUid: user?.uid || "" });
  if (!result.ok) {
    setStatus("لا يمكن أرشفة هذه الفرصة", "is-error");
    return;
  }
  if (result.idempotent) {
    setStatus("الفرصة مؤرشفة مسبقًا", "is-done");
    return;
  }
  setStatus("جارٍ الأرشفة…");
  try {
    await patchOpportunity(id, result.patch);
    await rematchOpportunity(id, { reason: "archive" });
    setStatus("تمت الأرشفة", "is-done");
    toast("تمت أرشفة الفرصة");
  } catch (error) {
    console.warn("[iaqar] bank archive", error);
    setStatus("تعذرت الأرشفة", "is-error");
  }
}

async function restoreOpportunity(id, existing) {
  const user = authUser();
  const result = buildRestorePatch(existing, { actorUid: user?.uid || "" });
  if (!result.ok) {
    setStatus("لا يمكن استعادة هذه الفرصة", "is-error");
    return;
  }
  if (result.idempotent) {
    setStatus("الفرصة نشطة مسبقًا", "is-done");
    return;
  }
  setStatus("جارٍ الاستعادة…");
  try {
    await patchOpportunity(id, result.patch);
    await rematchOpportunity(id, { reason: "restore" });
    setStatus("تمت الاستعادة", "is-done");
    toast("تمت استعادة الفرصة");
  } catch (error) {
    console.warn("[iaqar] bank restore", error);
    setStatus("تعذرت الاستعادة", "is-error");
  }
}

async function softDeleteOpportunity(id, existing) {
  const user = authUser();
  const result = buildSoftDeletePatch(existing, { actorUid: user?.uid || "", reason: "broker_confirmed" });
  if (result.idempotent) {
    setStatus("الفرصة محذوفة مسبقًا", "is-done");
    return;
  }
  setStatus("جارٍ الحذف الآمن…");
  try {
    await patchOpportunity(id, result.patch);
    await rematchOpportunity(id, { reason: "delete" });
    setStatus("تم الحذف الآمن مع حفظ التدقيق", "is-done");
    toast("تم حذف الفرصة");
    $("opportunityBankDetail").hidden = true;
  } catch (error) {
    console.warn("[iaqar] bank delete", error);
    setStatus("تعذر الحذف", "is-error");
  }
}

async function createShareRequest({ opportunityIds, targetOfficeId, scopeType }) {
  const user = authUser();
  const runtime = officeRuntime();
  if (!runtime?.db || !user) {
    setStatus("يلزم تسجيل الدخول", "is-error");
    return;
  }

  const mode = await readOfficeCooperationMode();
  if (!cooperationModeAllowsExplicitRequest(mode)) {
    setStatus("التعاون معطّل في إعدادات هذا المكتب", "is-error");
    return;
  }

  const ownedCheck = validateOwnedOpportunityIds(
    officeId(),
    state.records,
    opportunityIds
  );
  if (!ownedCheck.ok) {
    setStatus("لا يمكن مشاركة فرص لا تتبع هذا المكتب", "is-error");
    return;
  }

  setStatus("جارٍ إرسال طلب التعاون…");
  const built = await buildCooperationRequest({
    originatingOfficeId: officeId(),
    originatingBrokerId: user.uid,
    targetOfficeId,
    opportunityIds: ownedCheck.accepted,
    opportunityId: scopeType === "single" ? ownedCheck.accepted[0] : "",
    scopeType,
    createdBy: user.uid
  });
  if (!built.ok) {
    setStatus("تعذر تجهيز طلب التعاون", "is-error");
    return;
  }

  try {
    const ref = runtime.db.collection("cooperationRequests").doc(built.request.id);
    const existing = await ref.get();
    if (existing.exists) {
      const status = String(existing.data()?.status || "").toUpperCase();
      if (status === SHARE_REQUEST_STATUS.PENDING || status === SHARE_REQUEST_STATUS.ACCEPTED) {
        setStatus("يوجد طلب تعاون نشط أو معلّق مسبقًا", "is-done");
        return;
      }
    }
    await ref.set(built.request, { merge: false });

    // Update opportunity cooperation status to pending for singles/selected.
    const batch = runtime.db.batch();
    for (const oppId of ownedCheck.accepted) {
      const oppRef = runtime.db.collection("offices").doc(officeId()).collection("opportunities").doc(oppId);
      batch.set(oppRef, {
        officeId: officeId(),
        currentOwningOfficeId: officeId(),
        cooperationState: cooperationStateFromShareStatus(SHARE_REQUEST_STATUS.PENDING),
        cooperationStatus: cooperationStateFromShareStatus(SHARE_REQUEST_STATUS.PENDING),
        activeCooperationId: built.request.id,
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    await batch.commit();

    setStatus("تم إرسال طلب التعاون", "is-done");
    toast("تم إرسال طلب التعاون");
    await syncCooperationOperation(built.request.id);
    window.dispatchEvent(new CustomEvent("iaqar:cooperation-request-created", {
      detail: {
        ...phase3BoundaryGuarantees(),
        ...phase5BoundaryGuarantees(),
        ...phase6BoundaryGuarantees(),
        requestId: built.request.id,
        createsAutomaticCooperation: false
      }
    }));
  } catch (error) {
    console.warn("[iaqar] cooperation request", error);
    setStatus("تعذر إرسال طلب التعاون", "is-error");
  }
}

async function createScopedShare() {
  const user = authUser();
  const runtime = officeRuntime();
  const targetOfficeId = $("bankScopeTarget")?.value?.trim();
  if (!runtime?.db || !user || !targetOfficeId) {
    setStatus("أدخل معرّف المكتب المستهدف للنطاق", "is-error");
    return;
  }
  const mode = await readOfficeCooperationMode();
  if (!cooperationModeAllowsExplicitRequest(mode)) {
    setStatus("التعاون معطّل في إعدادات هذا المكتب", "is-error");
    return;
  }
  const built = await buildBankSharingScope({
    originatingOfficeId: officeId(),
    originatingBrokerId: user.uid,
    targetOfficeId,
    opportunityIds: [...state.selected],
    enabled: true,
    createdBy: user.uid,
    filters: { activeOnly: true }
  });
  if (!built.ok) {
    setStatus("تعذر تجهيز نطاق المشاركة", "is-error");
    return;
  }
  setStatus("جارٍ حفظ نطاق المشاركة…");
  try {
    await runtime.db.collection("bankSharingScopes").doc(built.scope.id).set(built.scope);
    setStatus("تم تفعيل نطاق المشاركة (قابل للإلغاء)", "is-done");
    toast("تم حفظ نطاق المشاركة");
    await loadOutgoingScopes();
  } catch (error) {
    console.warn("[iaqar] bank scope", error);
    setStatus("تعذر حفظ نطاق المشاركة", "is-error");
  }
}

async function revokeScopedShare(sharingScopeId) {
  const user = authUser();
  if (!user?.getIdToken || !sharingScopeId) {
    setStatus("يلزم تسجيل الدخول", "is-error");
    return;
  }
  setStatus("جارٍ إنهاء نطاق المشاركة…");
  try {
    const token = await user.getIdToken();
    const result = await requestScopeRevoke({
      workerBase: workerBaseUrl(),
      idToken: token,
      officeId: officeId(),
      sharingScopeId,
      reason: "broker_revoked_scope"
    });
    if (!result.ok) {
      setStatus(result.message || "تعذر إنهاء نطاق المشاركة", "is-error");
      return;
    }
    setStatus("انتهى نطاق المشاركة", "is-done");
    toast("تم إنهاء نطاق المشاركة");
    await loadOutgoingScopes();
  } catch (error) {
    console.warn("[iaqar] scope revoke", error);
    setStatus("تعذر إنهاء نطاق المشاركة", "is-error");
  }
}

async function loadOutgoingScopes() {
  const runtime = officeRuntime();
  const panel = $("bankOutgoingScopes");
  if (!runtime?.db || !panel) return;
  try {
    const snap = await runtime.db.collection("bankSharingScopes")
      .where("originatingOfficeId", "==", officeId())
      .limit(20)
      .get();
    const active = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((scope) => scope.status === "ACTIVE" && scope.enabled !== false && !scope.revokedAt);
    if (!active.length) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }
    panel.hidden = false;
    panel.innerHTML = `<h3>نطاقات المشاركة النشطة</h3>${active.map((scope) => `
      <div class="bank-incoming-item">
        <div>
          <strong>إلى ${escapeHtml(scope.targetOfficeId || "")}</strong>
          <p>${Number(scope.opportunityIds?.length || 0)} فرصة — قابل للإلغاء</p>
        </div>
        <button type="button" class="bank-action" data-revoke-scope="${escapeHtml(scope.id)}">إنهاء النطاق</button>
      </div>
    `).join("")}`;
    panel.querySelectorAll("[data-revoke-scope]").forEach((btn) => {
      btn.addEventListener("click", () => void revokeScopedShare(btn.getAttribute("data-revoke-scope")));
    });
  } catch (error) {
    console.warn("[iaqar] outgoing scopes", error);
  }
}

async function loadSharedWithUs() {
  const runtime = officeRuntime();
  const panel = $("bankSharedWithUs");
  if (!runtime?.db || !panel) return;
  try {
    const snap = await runtime.db.collection("offices").doc(officeId())
      .collection("sharedOpportunities")
      .limit(30)
      .get();
    const rows = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((row) => !row.revokedAt);
    if (!rows.length) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }
    panel.hidden = false;
    panel.innerHTML = `<h3>فرص مشاركة مع مكتبكم</h3>
      <p class="bank-note">قراءة فقط — بدون بيانات تواصل. الملكية تبقى للمكتب الأصلي.</p>
      ${rows.map((row) => `
        <div class="bank-incoming-item">
          <div>
            <strong>${escapeHtml([row.propertyType, row.district, row.city].filter(Boolean).join(" — ") || row.id)}</strong>
            <p>من ${escapeHtml(row.originatingOfficeId || "")} — ${escapeHtml(cooperationStatusLabel(row.cooperationStatus || "ACTIVE"))}</p>
          </div>
        </div>
      `).join("")}`;
  } catch (error) {
    console.warn("[iaqar] shared with us", error);
  }
}

function bindListClicks() {
  const list = $("opportunityBankList");
  if (!list || list.dataset.bound === "1") return;
  list.dataset.bound = "1";
  list.addEventListener("click", (event) => {
    const openId = event.target.closest?.("[data-open-id]")?.getAttribute("data-open-id");
    if (openId) {
      void renderDetail(openId);
      return;
    }
  });
  list.addEventListener("change", (event) => {
    const id = event.target?.getAttribute?.("data-select-id");
    if (!id) return;
    if (event.target.checked) state.selected.add(id);
    else state.selected.delete(id);
  });
}

async function revokeCooperation(opportunityId, record) {
  const user = authUser();
  const requestId = record.activeCooperationId;
  if (!user || !requestId) {
    setStatus("لا يوجد تعاون نشط لإلغائه", "is-error");
    return;
  }
  setStatus("جارٍ إنهاء التعاون…");
  try {
    // Phase 6 trusted path: revoke + remove target shared projections + audit.
    const result = await runTrustedCooperationLifecycle(requestId, "REVOKE", "broker_revoked");
    if (!result.ok) {
      setStatus(result.message || "تعذر إنهاء التعاون", "is-error");
      return;
    }
    setStatus("انتهى التعاون", "is-done");
    toast("تم إنهاء التعاون");
    window.dispatchEvent(new CustomEvent("iaqar:cooperation-revoked", {
      detail: {
        requestId,
        opportunityId,
        ...phase6BoundaryGuarantees()
      }
    }));
    await loadSharedWithUs();
    if (state.activeId === opportunityId) await renderDetail(opportunityId);
  } catch (error) {
    console.warn("[iaqar] revoke cooperation", error);
    setStatus("تعذر إنهاء التعاون", "is-error");
  }
}

async function syncOpportunityCooperationFromRequests() {
  const runtime = officeRuntime();
  const user = authUser();
  if (!runtime?.db || !user || !officeId()) return;
  const ids = [...state.records.values()]
    .map((record) => record.activeCooperationId)
    .filter(Boolean);
  const unique = [...new Set(ids)];
  for (const requestId of unique) {
    try {
      const snap = await runtime.db.collection("cooperationRequests").doc(requestId).get();
      if (!snap.exists) continue;
      const request = snap.data();
      const mapped = cooperationStateFromShareStatus(request.status);
      for (const [oppId, record] of state.records.entries()) {
        if (record.activeCooperationId !== requestId) continue;
        if (String(record.cooperationState || record.cooperationStatus) === mapped) continue;
        await patchOpportunity(oppId, {
          cooperationState: mapped,
          cooperationStatus: mapped
        });
        state.records.set(oppId, { ...record, cooperationState: mapped, cooperationStatus: mapped });
      }
    } catch (error) {
      console.warn("[iaqar] sync cooperation status", error);
    }
  }
}

async function loadIncomingRequests() {
  const runtime = officeRuntime();
  const user = authUser();
  const panel = $("bankIncomingRequests");
  const list = $("bankIncomingList");
  if (!panel || !list) return;
  if (!runtime?.db || !user || !officeId()) {
    panel.hidden = true;
    return;
  }
  try {
    const snap = await runtime.db.collection("cooperationRequests")
      .where("targetOfficeId", "==", officeId())
      .where("status", "==", SHARE_REQUEST_STATUS.PENDING)
      .limit(20)
      .get();
    if (snap.empty) {
      panel.hidden = true;
      list.innerHTML = "";
      return;
    }
    panel.hidden = false;
    list.innerHTML = snap.docs.map((docSnap) => {
      const request = docSnap.data() || {};
      const label = request.opportunityId
        ? `فرصة ${escapeHtml(request.opportunityId)}`
        : `${(request.opportunityIds || []).length} فرص محددة`;
      return `
        <div class="bank-incoming-item" data-request-id="${escapeHtml(docSnap.id)}">
          <div>
            <strong>من ${escapeHtml(request.originatingOfficeId)}</strong>
            <p>${label}</p>
          </div>
          <div>
            <button type="button" class="bank-action-primary" data-accept-request="${escapeHtml(docSnap.id)}">قبول</button>
            <button type="button" class="bank-action" data-reject-request="${escapeHtml(docSnap.id)}">رفض</button>
          </div>
        </div>
      `;
    }).join("");
  } catch (error) {
    console.warn("[iaqar] incoming cooperation", error);
    panel.hidden = true;
  }
}

async function decideIncomingRequest(requestId, decision) {
  const user = authUser();
  if (!user) {
    setStatus("يلزم تسجيل الدخول", "is-error");
    return;
  }
  if (decision === "ACCEPT") {
    const mode = await readOfficeCooperationMode();
    if (!cooperationModeAllowsAccept(mode)) {
      setStatus("التعاون معطّل في إعدادات هذا المكتب", "is-error");
      return;
    }
  }
  setStatus(decision === "ACCEPT" ? "جارٍ قبول الطلب…" : "جارٍ رفض الطلب…");
  try {
    // Phase 6 Worker path writes real minimum projections, updates origin status, audits.
    const result = await runTrustedCooperationLifecycle(
      requestId,
      decision === "ACCEPT" ? "ACCEPT" : "REJECT"
    );
    if (!result.ok) {
      setStatus(result.message || "تعذر تحديث الطلب", "is-error");
      return;
    }

    setStatus(decision === "ACCEPT" ? "تم قبول طلب التعاون" : "تم رفض طلب التعاون", "is-done");
    toast(decision === "ACCEPT" ? "تم قبول التعاون" : "تم رفض الطلب");
    window.dispatchEvent(new CustomEvent("iaqar:cooperation-decided", {
      detail: {
        requestId,
        decision,
        ...phase6BoundaryGuarantees()
      }
    }));
    await loadIncomingRequests();
    await loadSharedWithUs();
  } catch (error) {
    console.warn("[iaqar] decide incoming", error);
    setStatus("تعذر تحديث طلب التعاون", "is-error");
  }
}

function baseOpportunityQuery(db) {
  // Strictly scoped to this office path — never collectionGroup.
  return db.collection("offices").doc(officeId())
    .collection("opportunities")
    .orderBy("createdAt", "desc");
}

async function loadBankPage({ reset = false } = {}) {
  const runtime = officeRuntime();
  const user = authUser();
  const loadMoreBtn = $("bankLoadMoreBtn");

  if (!runtime?.db || !user || !officeId()) {
    setStatus("سجل دخول المكتب لعرض بنك الفرص", "is-error");
    if (loadMoreBtn) loadMoreBtn.hidden = true;
    return;
  }

  if (state.busy) return;
  state.busy = true;
  setStatus(reset ? "جارٍ تحميل فرص المكتب…" : "جارٍ تحميل المزيد…");

  try {
    let query = baseOpportunityQuery(runtime.db).limit(BANK_PAGE_SIZE);
    if (!reset && state.lastDoc) {
      query = baseOpportunityQuery(runtime.db).startAfter(state.lastDoc).limit(BANK_PAGE_SIZE);
    }
    if (reset) {
      state.records.clear();
      state.lastDoc = null;
      state.hasMore = false;
    }

    const snapshot = await query.get();
    snapshot.docs.forEach((docSnap) => {
      state.records.set(docSnap.id, { id: docSnap.id, ...(docSnap.data() || {}) });
    });
    state.lastDoc = snapshot.docs.length ? snapshot.docs[snapshot.docs.length - 1] : state.lastDoc;
    state.hasMore = snapshot.docs.length >= BANK_PAGE_SIZE;
    if (loadMoreBtn) loadMoreBtn.hidden = !state.hasMore;

    await syncOpportunityCooperationFromRequests();
    renderList();
    await loadIncomingRequests();

    const visible = [...state.records.values()].filter(isVisibleForFilter).length;
    setStatus(
      visible
        ? rowsCountLabel()
        : (state.filter === "archived"
          ? "لا توجد فرص مؤرشفة."
          : "لا توجد فرص محفوظة بعد. تُحفظ الفرص هنا تلقائيًا عند إضافتها.")
    );
  } catch (error) {
    console.warn("[iaqar] opportunity bank", error);
    setStatus("تعذر تحميل بنك الفرص — أعد المحاولة", "is-error");
    const retry = $("opportunityBankRetry");
    if (retry) retry.hidden = false;
  } finally {
    state.busy = false;
  }
}

function startListener() {
  // Phase 3 uses cursor pagination (get + startAfter) instead of an unbounded snapshot.
  stopListener();
  void loadBankPage({ reset: true });
  void loadIncomingRequests();
  void loadSharedWithUs();
  void loadOutgoingScopes();
}

export function openOpportunityBank() {
  const overlay = $("opportunityBank");
  if (!overlay) return;
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
  const retry = $("opportunityBankRetry");
  if (retry) retry.hidden = true;
  startListener();
  window.dispatchEvent(new CustomEvent("iaqar:opportunity-bank-opened", {
    detail: {
      arabicStatuses: [...FIVE_ARABIC_COOPERATION_STATUSES],
      ...phase6BoundaryGuarantees()
    }
  }));
}

export function closeOpportunityBank() {
  stopListener();
  const overlay = $("opportunityBank");
  if (overlay) overlay.hidden = true;
  const detail = $("opportunityBankDetail");
  if (detail) {
    detail.hidden = true;
    detail.innerHTML = "";
  }
  state.activeId = null;
  state.selected.clear();
  state.lastDoc = null;
  state.hasMore = false;
  if ($("officeSettings")?.hidden) document.body.style.overflow = "";
  window.dispatchEvent(new CustomEvent("iaqar:opportunity-bank-closed"));
}

function boot() {
  const openBtn = $("openOpportunityBankBtn");
  const closeBtn = $("opportunityBankClose");
  const overlay = $("opportunityBank");
  if (!openBtn || !overlay) return;
  if (overlay.dataset.bound === "1") return;
  overlay.dataset.bound = "1";

  openBtn.addEventListener("click", () => openOpportunityBank());
  closeBtn?.addEventListener("click", () => closeOpportunityBank());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeOpportunityBank();
  });
  $("opportunityBankRetry")?.addEventListener("click", () => {
    const retry = $("opportunityBankRetry");
    if (retry) retry.hidden = true;
    void loadBankPage({ reset: true });
  });
  $("bankLoadMoreBtn")?.addEventListener("click", () => void loadBankPage({ reset: false }));
  $("bankFilterActive")?.addEventListener("click", () => {
    state.filter = "active";
    syncFilterButtons();
    renderList();
    setStatus(rowsCountLabel());
  });
  $("bankFilterArchived")?.addEventListener("click", () => {
    state.filter = "archived";
    syncFilterButtons();
    renderList();
    setStatus(rowsCountLabel());
  });
  $("bankShareSelectedBtn")?.addEventListener("click", async () => {
    const target = $("bankScopeTarget")?.value?.trim();
    if (!target) {
      setStatus("أدخل معرّف المكتب المستهدف", "is-error");
      return;
    }
    if (!state.selected.size) {
      setStatus("حدّد فرصة واحدة على الأقل", "is-error");
      return;
    }
    await createShareRequest({
      opportunityIds: [...state.selected],
      targetOfficeId: target,
      scopeType: "selected"
    });
  });
  $("bankCreateScopeBtn")?.addEventListener("click", () => void createScopedShare());
  $("bankIncomingList")?.addEventListener("click", (event) => {
    const acceptId = event.target.closest?.("[data-accept-request]")?.getAttribute("data-accept-request");
    const rejectId = event.target.closest?.("[data-reject-request]")?.getAttribute("data-reject-request");
    if (acceptId) void decideIncomingRequest(acceptId, "ACCEPT");
    if (rejectId) void decideIncomingRequest(rejectId, "REJECT");
  });
  bindListClicks();

  window.addEventListener("iaqar:office-settings-closed", () => closeOpportunityBank());
  window.IAQAR = window.IAQAR || {};
  window.IAQAR.openOpportunityBank = openOpportunityBank;
  window.IAQAR.closeOpportunityBank = closeOpportunityBank;
}

function syncFilterButtons() {
  $("bankFilterActive")?.classList.toggle("is-active", state.filter === "active");
  $("bankFilterArchived")?.classList.toggle("is-active", state.filter === "archived");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
