/**
 * مجتمع الوسطاء — شارة داخل بطاقة العرض/الطلب ولوحة تعاون آمنة.
 */

import {
  agreementStatusLabel,
  buildOfficeCommunityVcard,
  communityBadgeLabel,
  communityStatusLabel,
  communityWhatsAppUrl,
  containsBlockedPeerPii,
  defaultCommissionSplit,
  officeCommunityVcardFilename,
  shouldShowCommunityBadge,
  validateCommissionSplit
} from "./broker-community-domain.js";

const cache = new Map();
let refreshTimer = 0;
let activeOpportunityId = "";

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function attrSel(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function officeId() {
  return String(window.IAQAR?.office?.officeId || document.documentElement.dataset.officeId || "").trim();
}

function workerBaseUrl() {
  if (typeof window.IAQAR?.resolveWorkerBase === "function") {
    return window.IAQAR.resolveWorkerBase();
  }
  return String(window.IAQAR?.workerBase || "").replace(/\/$/, "");
}

function authUser() {
  try {
    return window.firebase?.auth?.().currentUser || null;
  } catch (_) {
    return null;
  }
}

function overlayEls() {
  return {
    overlay: document.getElementById("brokerCommunityOverlay"),
    body: document.getElementById("brokerCommunityBody"),
    status: document.getElementById("brokerCommunityStatus"),
    close: document.getElementById("brokerCommunityClose")
  };
}

function setStatus(message = "", kind = "") {
  const { status } = overlayEls();
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("is-error", kind === "is-error");
  status.classList.toggle("is-done", kind === "is-done");
}

function collectHostIds(root = document) {
  return [...new Set(
    [...root.querySelectorAll("[data-community-host][data-opportunity-id]")]
      .map((node) => String(node.getAttribute("data-opportunity-id") || "").trim())
      .filter(Boolean)
  )].slice(0, 20);
}

function renderBadge(opportunityId, matches, sourceKind) {
  const slots = document.querySelectorAll(`[data-community-slot="${attrSel(opportunityId)}"]`);
  const visible = shouldShowCommunityBadge(matches);
  slots.forEach((slot) => {
    if (!visible) {
      slot.innerHTML = "";
      slot.hidden = true;
      return;
    }
    slot.hidden = false;
    slot.innerHTML = `<button type="button" class="broker-community-badge js-broker-community-open"
      data-opportunity-id="${esc(opportunityId)}">🤝 ${esc(communityBadgeLabel(sourceKind))}</button>`;
  });
}

async function fetchMatches(opportunityIds) {
  const user = authUser();
  const base = workerBaseUrl();
  const oid = officeId();
  if (!user?.getIdToken || !base || !oid || !opportunityIds.length) return;
  const pending = opportunityIds.filter((id) => !cache.has(id));
  if (!pending.length) {
    opportunityIds.forEach((id) => {
      const row = cache.get(id);
      renderBadge(id, row?.matches || [], row?.sourceKind || "");
    });
    return;
  }
  pending.forEach((id) => cache.set(id, { matches: [], sourceKind: "" }));
  try {
    const token = await user.getIdToken();
    const response = await fetch(`${base}/cooperation/community-matches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ officeId: oid, opportunityIds: pending })
    });
    const payload = await response.json().catch(() => ({}));
    const byId = payload.matchesByOpportunityId || {};
    for (const id of pending) {
      const matches = Array.isArray(byId[id]) ? byId[id].filter((row) => !containsBlockedPeerPii(row)) : [];
      const host = document.querySelector(`[data-community-host][data-opportunity-id="${attrSel(id)}"]`);
      const sourceKind = String(host?.getAttribute("data-opportunity-kind") || "");
      cache.set(id, { matches, sourceKind, request: null, agreement: null });
      renderBadge(id, matches, sourceKind);
    }
  } catch (error) {
    console.warn("[iaqar] community matches", error);
  }
}

function scheduleRefresh(root) {
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    void fetchMatches(collectHostIds(root));
  }, 80);
}

function matchCardHtml(match, sourceKind) {
  const wa = communityWhatsAppUrl({
    officeWhatsapp: match.officeWhatsapp,
    officePhone: match.officePhone,
    sourceKind
  });
  const phone = String(match.officePhone || match.officeWhatsapp || "").trim();
  const vcfReady = Boolean(phone);
  return `
    <article class="community-match-card" data-pair-key="${esc(match.pairKey || "")}">
      <strong>${esc(match.matchStrength || "مناسب")} — ${esc(String(match.matchScore || 0))}٪</strong>
      <span>الموقع: ${esc(match.district || "")} / ${esc(match.neighborhoodLabel || "")}</span>
      <span>نوع العقار: ${esc(match.propertyType || "")} — ${esc(match.kindLabel || "")}</span>
      <span>المكتب الآخر: ${esc(match.officeName || "مكتب عقاري مشارك في مجتمع الوسطاء")}</span>
      <div class="community-actions">
        ${wa ? `<a class="identity-btn js-community-whatsapp" href="${esc(wa)}" target="_blank" rel="noopener">تواصل مع المكتب</a>` : `<p class="section-help">لا يتوفر رقم تواصل للمكتب.</p>`}
        ${vcfReady ? `<button type="button" class="identity-btn js-community-vcf"
          data-office-name="${esc(match.officeName || "")}"
          data-office-phone="${esc(phone)}">حفظ رقم المكتب في الجوال (VCF)</button>` : ""}
        <button type="button" class="identity-btn js-community-request"
          data-target-office="${esc(match.officeId || "")}"
          data-peer-id="${esc(match.opportunityId || "")}">طلب تعاون</button>
      </div>
    </article>`;
}

function agreementHtml(state = {}) {
  const split = state.agreement || defaultCommissionSplit();
  const status = state.agreement
    ? agreementStatusLabel(state.agreement)
    : "";
  const requestStatus = state.request ? communityStatusLabel(state.request) : "";
  return `
    <div class="community-agreement">
      ${requestStatus ? `<p>حالة التعاون: ${esc(requestStatus)}</p>` : ""}
      ${status ? `<p>${esc(status)}</p>` : ""}
      <div class="community-split-row">
        <label>نسبة مكتبك
          <input type="number" min="1" max="99" id="communitySplitA" value="${esc(split.officeAPercent || 50)}">
        </label>
        <label>نسبة المكتب الآخر
          <input type="number" min="1" max="99" id="communitySplitB" value="${esc(split.officeBPercent || 50)}">
        </label>
      </div>
      <div class="community-actions">
        <button type="button" class="identity-btn" id="communityAgreementSave">إنشاء اتفاقية تعاون</button>
        <button type="button" class="identity-btn" id="communityAgreementAccept">اعتماد الاتفاقية</button>
        <button type="button" class="identity-btn" id="communityDealDone">تمت الصفقة</button>
        <button type="button" class="identity-btn" id="communityDealNone">انتهى بدون صفقة</button>
      </div>
    </div>`;
}

async function openPanel(opportunityId) {
  const { overlay, body } = overlayEls();
  if (!overlay || !body) return;
  activeOpportunityId = opportunityId;
  const row = cache.get(opportunityId) || { matches: [] };
  if (!shouldShowCommunityBadge(row.matches) && !row.request) return;
  try {
    const workspace = await postWorker("/opportunity/workspace", { opportunityId });
    const requests = Array.isArray(workspace.cooperationRequests) ? workspace.cooperationRequests : [];
    const active = requests.find((item) => ["PENDING", "ACCEPTED"].includes(String(item.status || "").toUpperCase()));
    if (active) {
      row.request = active;
      if (workspace.suggestions) row.matches = workspace.suggestions;
    }
  } catch (_) { /* keep cached matches */ }
  const sourceKind = row.sourceKind || "";
  const request = row.request || {};
  const status = String(request.status || "").toUpperCase();
  const isTarget = String(request.targetOfficeId || "") === officeId();
  const agreementBlock = status === "ACCEPTED" ? agreementHtml(row) : "";
  const acceptBtn = status === "PENDING" && isTarget
    ? `<button type="button" class="identity-btn" id="communityAcceptRequest">قبول التعاون</button>`
    : "";
  body.innerHTML = `
    ${row.matches.map((match) => matchCardHtml(match, sourceKind)).join("")}
    ${status ? `<p>حالة التعاون: ${esc(communityStatusLabel(request))}</p>` : ""}
    ${acceptBtn}
    ${agreementBlock}`;
  overlay.hidden = false;
  setStatus("");
  bindPanelActions(opportunityId, row);
  body.querySelector("#communityAcceptRequest")?.addEventListener("click", async () => {
    try {
      await postWorker("/cooperation/lifecycle", {
        cooperationId: request.id,
        action: "ACCEPT"
      });
      row.request = { ...request, status: "ACCEPTED" };
      cache.set(opportunityId, row);
      setStatus("تم قبول التعاون", "is-done");
      void openPanel(opportunityId);
    } catch (error) {
      setStatus(error.message || "تعذر قبول التعاون", "is-error");
    }
  });
}

function closePanel() {
  const { overlay } = overlayEls();
  if (overlay) overlay.hidden = true;
  activeOpportunityId = "";
}

async function postWorker(path, payload) {
  const user = authUser();
  const base = workerBaseUrl();
  if (!user?.getIdToken || !base) throw new Error("auth_required");
  const token = await user.getIdToken();
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ officeId: officeId(), ...payload })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "تعذر تنفيذ الإجراء");
    error.payload = data;
    throw error;
  }
  return data;
}

function downloadOfficeVcard({ officeName = "", officePhone = "" } = {}) {
  const text = buildOfficeCommunityVcard({ officeName, officePhone });
  if (!text) return false;
  const filename = officeCommunityVcardFilename({ officeName, officePhone });
  const blob = new Blob([text], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2500);
  return true;
}

function bindPanelActions(opportunityId, row) {
  const { body } = overlayEls();
  if (!body) return;
  body.querySelectorAll(".js-community-vcf").forEach((button) => {
    button.addEventListener("click", () => {
      const saved = downloadOfficeVcard({
        officeName: button.getAttribute("data-office-name") || "",
        officePhone: button.getAttribute("data-office-phone") || ""
      });
      setStatus(
        saved ? "تم تجهيز بطاقة VCF لرقم المكتب دون اسم عميل أو مالك أو وسيط." : "لا يتوفر رقم مكتب للحفظ.",
        saved ? "is-done" : "is-error"
      );
    });
  });
  body.querySelectorAll(".js-community-request").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        setStatus("جارٍ إرسال طلب التعاون…");
        const payload = await postWorker("/cooperation/request", {
          targetOfficeId: button.getAttribute("data-target-office"),
          opportunityIds: [opportunityId],
          peerOpportunityId: button.getAttribute("data-peer-id"),
          scopeType: "community_pair"
        });
        const next = cache.get(opportunityId) || row;
        next.request = {
          id: payload.cooperationRequestId,
          status: payload.duplicate ? "PENDING" : "PENDING",
          originatingOfficeId: officeId(),
          targetOfficeId: button.getAttribute("data-target-office")
        };
        cache.set(opportunityId, next);
        setStatus(payload.duplicate ? "يوجد طلب تعاون لهذه الزوج مسبقًا." : "تم إرسال طلب التعاون.", "is-done");
        openPanel(opportunityId);
      } catch (error) {
        setStatus(error.message || "تعذر إرسال طلب التعاون", "is-error");
      }
    });
  });
  body.querySelector("#communityAgreementSave")?.addEventListener("click", async () => {
    const a = document.getElementById("communitySplitA")?.value;
    const b = document.getElementById("communitySplitB")?.value;
    const check = validateCommissionSplit(a, b);
    if (!check.ok) {
      setStatus(check.message, "is-error");
      return;
    }
    const request = (cache.get(opportunityId) || row).request;
    if (!request?.id) {
      setStatus("أرسل طلب التعاون أولًا.", "is-error");
      return;
    }
    try {
      const payload = await postWorker("/cooperation/agreement", {
        cooperationId: request.id,
        action: request.agreementId ? "REVISE" : "CREATE",
        officeAPercent: check.officeAPercent,
        officeBPercent: check.officeBPercent
      });
      const next = cache.get(opportunityId) || row;
      next.agreement = payload.agreement;
      next.request = { ...request, agreementId: payload.agreementId };
      cache.set(opportunityId, next);
      setStatus("بانتظار موافقة الطرف الآخر", "is-done");
      openPanel(opportunityId);
    } catch (error) {
      setStatus(error.message || "تعذر حفظ الاتفاقية", "is-error");
    }
  });
  body.querySelector("#communityAgreementAccept")?.addEventListener("click", async () => {
    const request = (cache.get(opportunityId) || row).request;
    if (!request?.id) return;
    try {
      const payload = await postWorker("/cooperation/agreement", {
        cooperationId: request.id,
        action: "ACCEPT"
      });
      const next = cache.get(opportunityId) || row;
      next.agreement = payload.agreement;
      cache.set(opportunityId, next);
      setStatus("اتفاقية التعاون فعالة", "is-done");
      openPanel(opportunityId);
    } catch (error) {
      setStatus(error.message || "تعذر اعتماد الاتفاقية", "is-error");
    }
  });
  async function closeOutcome(outcome) {
    const request = (cache.get(opportunityId) || row).request;
    if (!request?.id) {
      setStatus("لا توجد فرصة تعاون مفتوحة.", "is-error");
      return;
    }
    try {
      await postWorker("/cooperation/outcome", { cooperationId: request.id, outcome });
      cache.delete(opportunityId);
      renderBadge(opportunityId, [], "");
      setStatus(outcome === "DEAL_COMPLETED" ? "تم تسجيل إتمام الصفقة بنجاح." : "تم إنهاء التعاون بدون صفقة.", "is-done");
      window.setTimeout(closePanel, 700);
    } catch (error) {
      setStatus(error.message || "تعذر إغلاق فرصة التعاون", "is-error");
    }
  }
  body.querySelector("#communityDealDone")?.addEventListener("click", () => closeOutcome("DEAL_COMPLETED"));
  body.querySelector("#communityDealNone")?.addEventListener("click", () => closeOutcome("ENDED_WITHOUT_DEAL"));
}

function onDocumentClick(event) {
  const openBtn = event.target.closest(".js-broker-community-open");
  if (openBtn) {
    event.preventDefault();
    event.stopPropagation();
    openPanel(openBtn.getAttribute("data-opportunity-id") || "");
    return;
  }
  const { overlay } = overlayEls();
  if (overlay && event.target === overlay) closePanel();
}

export function bindBrokerCommunity(root = document) {
  if (root.dataset?.brokerCommunityBound === "1") {
    scheduleRefresh(root);
    return;
  }
  if (root.dataset) root.dataset.brokerCommunityBound = "1";
  const { close } = overlayEls();
  if (close) close.addEventListener("click", closePanel);
  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanel();
  });
  const observer = new MutationObserver(() => scheduleRefresh(document));
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleRefresh(root);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => bindBrokerCommunity(document));
} else {
  bindBrokerCommunity(document);
}

window.IAQAR = window.IAQAR || {};
window.IAQAR.brokerCommunity = Object.freeze({ bindBrokerCommunity, refresh: () => scheduleRefresh(document) });
