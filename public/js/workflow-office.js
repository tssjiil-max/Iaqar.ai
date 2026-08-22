(() => {
  "use strict";

  function resolveWorkerBase() {
    if (window.IAQAR && typeof window.IAQAR.resolveWorkerBase === "function") {
      return window.IAQAR.resolveWorkerBase();
    }
    // Fail closed if runtime-config did not load: never send staging hosts to prod Worker.
    try {
      const host = String(window.location && window.location.hostname || "").toLowerCase();
      if (host.includes("--staging") || host.startsWith("staging.")) {
        return "https://iaqar-intake-staging.iaqar-ai.workers.dev";
      }
    } catch (_) { /* ignore */ }
    return "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
  }
  const SHARED_STORAGE_KEY = "iaqar.pendingSharedMessage";
  const APP_VERSION = "stage3-fcm-fid-v1";
  const office = () => window.IAQAR && window.IAQAR.office;
  const messagingDomain = () => window.IAQAR && window.IAQAR.messagingDomain;
  const LC = () => window.IAQAR_LIFECYCLE || {};
  const OPP = () => window.IAQAR_OPPORTUNITY?.card || null;
  const FD = () => window.IAQAR_OPPORTUNITY?.followup || null;
  const BUX = () => window.IAQAR?.brokerMatchUxDomain || null;
  const BAL = () => window.IAQAR?.brokerAlertsDomain || null;

  function brokerUxStatusLine(item = {}) {
    const domain = BUX();
    if (!domain) return "";
    if (item.viewingAt || item.appointmentAt) {
      const viewingLine = domain.viewingConfirmationOpsLine?.(item);
      if (viewingLine) return viewingLine;
    }
    return domain.negotiationOpsLine?.(item) || "";
  }

  function sanitizeOpsText(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const lower = raw.toLowerCase();
    if (["ms", "dd", "dd dd", "ii", "ا ب"].includes(lower)) return "";
    if (/^سلمى\s*ii$/i.test(raw)) return "";
    if (raw.length <= 2 && !/^\d+$/.test(raw)) return "";
    if (/^(?:[\u0621-\u064A]\s+){1,4}[\u0621-\u064A]$/.test(raw)) return "";
    return raw;
  }

  function buildOpsSubtitle(card, fallbackParts = []) {
    if (!card) return fallbackParts.filter(Boolean).join(" — ");
    const parts = [
      card.description,
      card.location !== "غير محدد" ? card.location : "",
      card.priceOrBudget !== "غير محدد" ? card.priceOrBudget : "",
      card.area !== "غير محدد" ? card.area : ""
    ].filter(Boolean);
    return parts.join(" · ") || fallbackParts.filter(Boolean).join(" — ");
  }

  const MATCH_STATUS = Object.freeze({
    new: { key: "active", label: "نشطة", mark: "🟢", next: "التواصل مع الطرفين" },
    active: { key: "active", label: "نشطة", mark: "🟢", next: "التواصل مع الطرفين" },
    in_progress: { key: "active", label: "نشطة", mark: "🟢", next: "متابعة التواصل" },
    waiting_response: { key: "waiting_response", label: "بانتظار رد", mark: "🟡", next: "متابعة الرد" },
    viewing: { key: "viewing", label: "موعد معاينة", mark: "🔵", next: "تأكيد المعاينة" },
    negotiation: { key: "negotiation", label: "تفاوض", mark: "🟣", next: "متابعة التفاوض" },
    converted: { key: "negotiation", label: "تفاوض", mark: "🟣", next: "متابعة الصفقة" },
    completed: { key: "completed", label: "تمت الصفقة", mark: "✅", next: "تمت الصفقة" },
    closed: { key: "closed", label: "أُغلقت", mark: "🔴", next: "لا يوجد إجراء" }
  });
  const READINESS = Object.freeze({
    very_high: { label: "عالية جدًا", mark: "🟢" },
    high: { label: "عالية", mark: "🟡" },
    medium: { label: "متوسطة", mark: "🟠" },
    low: { label: "منخفضة", mark: "🔴" }
  });
  const DEAL_STAGE = Object.freeze({
    contact: { label: "التواصل", next: "تحديد موعد معاينة" },
    viewing: { label: "المعاينة", next: "بدء التفاوض" },
    negotiation: { label: "التفاوض", next: "تجهيز اتفاقية الوساطة" },
    agreement: { label: "اتفاقية الوساطة", next: "اعتماد الاتفاقية" },
    closing: { label: "جاهزة للإغلاق", next: "إغلاق الصفقة" },
    closed: { label: "تمت الصفقة", next: "تمت الصفقة" },
    lost: { label: "متوقفة", next: "لا يوجد إجراء" }
  });
  const HEALTH = Object.freeze({
    excellent: { label: "ممتازة", mark: "🟢" },
    stable: { label: "مستقرة", mark: "🟡" },
    needs_intervention: { label: "تحتاج تدخل", mark: "🟠" },
    at_risk: { label: "معرضة للفشل", mark: "🔴" }
  });

  let liveUnsubscribers = [];
  let liveOfficeKey = "";
  let matchItems = [];
  let dealItems = [];
  let intakeItems = [];
  let operationItems = [];
  let savedOpportunityWorkspaceItems = [];
  let opportunityItems = [];
  let opportunityView = "active";
  let analyticsItem = null;
  const ACTIVE_OPERATION_STATUSES = Object.freeze(["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL_RESPONSE"]);
  const timelineCache = new Map();
  const timelinePending = new Set();
  const intakeProcessing = new Set();

  function notify(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function readPendingShare() {
    try {
      const raw = localStorage.getItem(SHARED_STORAGE_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      return value && value.messageText ? value : null;
    } catch (_) { return null; }
  }

  function clearPendingShare() {
    try { localStorage.removeItem(SHARED_STORAGE_KEY); } catch (_) {}
  }

  function toDate(value) {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function relativeTime(value) {
    const date = toDate(value) || new Date();
    const diff = Date.now() - date.getTime();
    if (!Number.isFinite(diff) || diff < 0) return "الآن";
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "الآن";
    if (minutes < 60) return `قبل ${minutes} د`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `قبل ${hours} س`;
    return date.toLocaleDateString("ar-SA", { month: "short", day: "numeric" });
  }

  function dateTimeLabel(value) {
    const date = toDate(value);
    if (!date) return "غير محدد";
    return date.toLocaleString("ar-SA", {
      timeZone: "Asia/Riyadh",
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
    });
  }

  function localDateTimeValue(date) {
    const d = new Date(date);
    const pad = value => String(value).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function isOverdue(value) {
    const date = toDate(value);
    return Boolean(date && date.getTime() < Date.now());
  }

  function isFollowUpOverdueRecord(record = {}) {
    const follow = FD()?.activeFollowUpFromRecord?.(record);
    if (follow) return FD().isFollowUpOverdue(follow);
    return isOverdue(record.nextFollowUpAt || record.nextActionAt);
  }

  function parseArray(value) {
    try {
      if (Array.isArray(value)) return value;
      const parsed = JSON.parse(value || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
  }

  function normalizeMatchStatus(status) {
    return MATCH_STATUS[status] || MATCH_STATUS.active;
  }

  function readinessInfo(item) {
    const score = Number(item.closingReadinessScore || 0);
    const fallbackKey = score >= 85 ? "very_high" : score >= 70 ? "high" : score >= 50 ? "medium" : "low";
    const key = READINESS[item.closingReadinessKey] ? item.closingReadinessKey : fallbackKey;
    return { key, score, ...(READINESS[key] || READINESS.low), label: item.closingReadinessLabel || READINESS[key].label };
  }

  function healthInfo(item) {
    const stageBase = { contact: 66, viewing: 76, negotiation: 82, agreement: 88, closing: 95, closed: 100, lost: 10 };
    let score = Number(item.healthScore);
    if (!Number.isFinite(score) || score <= 0) score = stageBase[item.workflowStage] || 60;
    const updated = toDate(item.updatedAt || item.createdAt);
    if (updated && Date.now() - updated.getTime() > 7 * 86400000) score -= 25;
    else if (updated && Date.now() - updated.getTime() > 3 * 86400000) score -= 12;
    if (isOverdue(item.nextFollowUpAt)) score -= 18;
    score = Math.max(0, Math.min(100, Math.round(score)));
    let fallbackKey = score >= 85 ? "excellent" : score >= 65 ? "stable" : score >= 40 ? "needs_intervention" : "at_risk";
    const key = HEALTH[item.healthKey] && !isOverdue(item.nextFollowUpAt) ? item.healthKey : fallbackKey;
    return { key, score, ...(HEALTH[key] || HEALTH.stable), label: HEALTH[key].label };
  }

  function timelineLines(recordType, recordId) {
    const events = timelineCache.get(`${recordType}:${recordId}`) || [];
    if (!events.length) return [];
    return ["سجل النشاط:", ...events.slice(0, 5).map(event => {
      const note = event.note || event.stage || "تم تحديث السجل";
      return `• ${note} — ${relativeTime(event.createdAt)}`;
    })];
  }

  function matchOperation(doc) {
    const item = doc.data();
    const status = normalizeMatchStatus(item.status);
    const readiness = readinessInfo(item);
    const overdue = isOverdue(item.nextFollowUpAt) && !["completed", "closed"].includes(status.key);
    const reasons = parseArray(item.reasonsJson);
    const warnings = parseArray(item.warningsJson);
    const appointmentAt = item.viewingAt || null;
    const lines = [
      `نسبة المطابقة: ${Number(item.score || 0)}%`,
      `جاهزية الإغلاق: ${readiness.mark} ${readiness.label}`,
      `الحالة: ${status.mark} ${status.label}`,
      appointmentAt ? `موعد المعاينة: ${dateTimeLabel(appointmentAt)}` : "موعد المعاينة: لم يحدد بعد",
      `الخطوة التالية: ${item.nextAction || status.next}`
    ];
    if (reasons.length) lines.push(`أسباب المطابقة: ${reasons.join("، ")}`);
    if (warnings.length) lines.push(`تحتاج مراجعة: ${warnings.join("، ")}`);
    if (item.ownerMediaMissing === true) lines.push("صور العقار ناقصة — اطلبها من المالك عبر واتساب");
    if (item.lastNote) lines.push(`آخر ملاحظة: ${item.lastNote}`);
    if (item.closeReason) lines.push(`سبب الإغلاق: ${item.closeReason}`);
    lines.push(...timelineLines("match", doc.id));

    let priority = 4;
    if (overdue || item.attentionRequired === true) priority = 0;
    else if (readiness.key === "very_high") priority = 1;
    else if (readiness.key === "high") priority = 2;
    else if (status.key === "negotiation") priority = 1;

    let actionLabel = appointmentAt ? "إتمام الصفقة" : "تحديد المعاينة";
    if (["completed", "closed"].includes(status.key)) actionLabel = "عرض السجل";

    return {
      id: doc.id,
      recordId: doc.id,
      recordType: "match",
      main: "opportunities",
      priority,
      isAlert: overdue || item.attentionRequired === true,
      icon: status.key === "completed" ? "i-house-check" : "i-match",
      title: `مطابقة بنسبة ${Number(item.score || 0)}%`,
      subtitle: [item.propertyType, item.district, `${readiness.mark} ${readiness.label}`].filter(Boolean).join(" — ") || "طلب عميل مع عرض مالك",
      propertyType: item.propertyType || "",
      district: item.district || "",
      time: relativeTime(item.updatedAt || item.createdAt),
      detailsLines: lines,
      status: status.key,
      statusLabel: status.label,
      workflowStage: item.workflowStage || status.key,
      nextAction: item.nextAction || status.next,
      actionLabel,
      secondaryActionLabel: ["completed", "closed"].includes(status.key) ? "عرض النشاط" : "إدارة الفرصة",
      dealId: item.dealId || "",
      clientRequestId: item.clientRequestId || "",
      ownerOfferId: item.ownerOfferId || "",
      matchId: doc.id,
      whatsappOwner: Boolean(item.ownerOfferId),
      whatsappOwnerLabel: item.ownerMediaMissing === true ? "طلب الصور عبر واتساب" : "واتساب المالك",
      whatsappClient: Boolean(item.clientRequestId),
      ownerMediaMissing: item.ownerMediaMissing === true,
      nextFollowUpAt: item.nextFollowUpAt || null,
      appointmentAt,
      viewingAt: item.viewingAt || null,
      lastNote: item.lastNote || "",
      closeReason: item.closeReason || "",
      closingReadinessScore: readiness.score,
      closingReadinessKey: readiness.key,
      brokerUx: item.brokerUx || {},
      opsStatusLine: brokerUxStatusLine({ ...item, viewingAt: item.viewingAt, appointmentAt })
    };
  }

  function dealOperation(doc) {
    const item = doc.data();
    const stage = DEAL_STAGE[item.workflowStage] || DEAL_STAGE.contact;
    const health = healthInfo(item);
    const overdue = isOverdue(item.nextFollowUpAt) && !["closed", "lost"].includes(item.status);
    const lines = [
      `المرحلة الحالية: ${stage.label}`,
      `صحة الصفقة: ${health.mark} ${health.label}`,
      `الخطوة التالية: ${item.nextAction || stage.next}`,
      `المتابعة القادمة: ${dateTimeLabel(item.nextFollowUpAt)}${overdue ? " — متأخرة" : ""}`
    ];
    if (item.lastNote) lines.push(`آخر ملاحظة: ${item.lastNote}`);
    if (item.commissionExpected) lines.push(`العمولة المتوقعة: ${Number(item.commissionExpected).toLocaleString("ar-SA")} ريال`);
    if (item.commissionActual) lines.push(`العمولة الفعلية: ${Number(item.commissionActual).toLocaleString("ar-SA")} ريال`);
    if (item.lostReason) lines.push(`سبب التوقف: ${item.lostReason}`);
    lines.push(...timelineLines("deal", doc.id));

    let priority = overdue || item.attentionRequired === true ? 0 : 3;
    if (["negotiation", "agreement", "closing"].includes(item.workflowStage)) priority = 1;
    if (item.status === "closed") priority = 5;

    return {
      id: doc.id,
      recordId: doc.id,
      recordType: "deal",
      main: "operations",
      priority,
      isAlert: overdue || item.attentionRequired === true || item.workflowStage === "closing",
      icon: item.status === "closed" ? "i-house-check" : "i-briefcase-check",
      title: item.status === "closed" ? "تمت الصفقة" : item.status === "lost" ? "صفقة متوقفة" : "صفقة قيد التنفيذ",
      subtitle: [item.propertyType, item.district, stage.label].filter(Boolean).join(" — ") || stage.label,
      propertyType: item.propertyType || "",
      district: item.district || "",
      time: relativeTime(item.updatedAt || item.createdAt),
      detailsLines: lines,
      status: item.status || "open",
      workflowStage: item.workflowStage || "contact",
      nextAction: item.nextAction || stage.next,
      actionLabel: item.status === "closed" || item.status === "lost" ? "عرض السجل" : "إنهاء الصفقة",
      secondaryActionLabel: item.status === "closed" || item.status === "lost" ? "عرض النشاط" : "إدارة الصفقة",
      clientRequestId: item.clientRequestId || "",
      ownerOfferId: item.ownerOfferId || "",
      matchId: item.matchId || "",
      dealId: doc.id,
      whatsappOwner: Boolean(item.ownerOfferId),
      whatsappClient: Boolean(item.clientRequestId),
      nextFollowUpAt: item.nextFollowUpAt || null,
      healthKey: health.key,
      healthScore: health.score,
      brokerUx: item.brokerUx || {},
      opsStatusLine: brokerUxStatusLine(item)
    };
  }


  function intakeOperation(doc) {
    const item = doc.data() || {};
    const isOwner = item.kind === "owner";
    const amountLabel = isOwner ? "السعر المطلوب" : "الميزانية";
    const readinessEval = window.IAQAR_OPPORTUNITY?.evaluateMatchingReadiness
      ? window.IAQAR_OPPORTUNITY.evaluateMatchingReadiness({ ...item, id: doc.id })
      : null;
    const matchingReadiness = String(item.matchingReadiness || readinessEval?.matchingReadiness || "").toUpperCase();
    const matchingReadinessMissing = Array.isArray(item.matchingReadinessMissing) && item.matchingReadinessMissing.length
      ? item.matchingReadinessMissing.map(String)
      : (readinessEval?.matchingReadinessMissing || []);
    return {
      id: `intake-${doc.id}`,
      recordId: doc.id,
      recordType: "intake",
      main: "opportunities",
      priority: 0,
      isAlert: item.status === "new",
      icon: isOwner ? "i-house-check" : "i-user-clock",
      title: isOwner ? "عرض جديد من مالك" : "طلب جديد من عميل",
      subtitle: buildOpsSubtitle(null, [
        sanitizeOpsText(item.propertyType),
        sanitizeOpsText(item.district),
        sanitizeOpsText(item.name)
      ]),
      propertyType: item.propertyType || "",
      district: item.district || "",
      time: relativeTime(item.createdAt),
      detailsLines: [
        `الاسم: ${item.name || "غير محدد"}`,
        `الجوال: ${item.phone || "غير محدد"}`,
        `نوع العقار: ${item.propertyType || "غير محدد"}`,
        `الحي: ${item.district || "غير محدد"}`,
        `${amountLabel}: ${Number(item.amount || 0).toLocaleString("ar-SA")} ريال`,
        item.details ? `التفاصيل: ${item.details}` : "التفاصيل: لا يوجد",
        ...(isOwner && item.mediaMissing === true ? ["صور العقار ناقصة — اطلبها من المالك عبر واتساب"] : [])
      ],
      status: item.status || "new",
      workflowStage: "intake",
      nextAction: "مراجعة البيانات والتواصل",
      actionLabel: "تمت المراجعة",
      secondaryActionLabel: "إغلاق التفاصيل"
      ,kind: item.kind || "client"
      ,contactName: item.name || ""
      ,contactPhone: item.phone || ""
      ,whatsappOwner: isOwner
      ,whatsappOwnerLabel: isOwner && item.mediaMissing === true ? "طلب الصور عبر واتساب" : "واتساب المالك"
      ,whatsappClient: !isOwner
      ,ownerMediaMissing: isOwner && item.mediaMissing === true
      ,lifecycleStatus: LC().getOpportunityLifecycleStatus ? LC().getOpportunityLifecycleStatus(item) : "NEW"
      ,lifecycleStatusLabel: (LC().LIFECYCLE_STATUS_LABELS && LC().LIFECYCLE_STATUS_LABELS[LC().getOpportunityLifecycleStatus(item)]) || "جديدة"
      ,normalizedSource: item.normalizedSource || item.source || "office_link"
      ,opportunityId: item.opportunityId || ""
      ,contactType: isOwner ? "owner" : "buyer"
      ,transactionType: item.transactionType || ""
      ,amount: item.amount || 0
      ,area: item.area || 0
      ,matchingReadiness
      ,matchingReadinessMissing
      ,isReadyForMatching: matchingReadiness === "READY_FOR_MATCHING" || readinessEval?.isReadyForMatching === true
    };
  }

  function opportunityOperation(doc) {
    const item = doc.data() || {};
    const lifecycleStatus = LC().getOpportunityLifecycleStatus ? LC().getOpportunityLifecycleStatus(item) : "NEW";
    const lifecycleLabel = (LC().LIFECYCLE_STATUS_LABELS && LC().LIFECYCLE_STATUS_LABELS[lifecycleStatus]) || lifecycleStatus;
    const isOwner = item.contactType === "owner" || item.recordType === "owner_offer";
    const overdue = isFollowUpOverdueRecord(item) && lifecycleStatus !== "ARCHIVED"
      && !["CLOSED_WON", "CLOSED_LOST"].includes(lifecycleStatus);
    const card = OPP()?.buildOpportunityCardView
      ? OPP().buildOpportunityCardView({ ...item, id: doc.id, opportunityId: doc.id })
      : null;
    const title = card?.kindBadge || (isOwner ? "عرض مالك" : "طلب عميل");
    const subtitle = buildOpsSubtitle(card, [
      sanitizeOpsText(item.propertyType),
      sanitizeOpsText(item.district),
      lifecycleLabel
    ]);
    const matchingReadinessStored = String(item.matchingReadiness || "").toUpperCase();
    const matchingReadinessMissingStored = Array.isArray(item.matchingReadinessMissing)
      ? item.matchingReadinessMissing.map(String)
      : [];
    const readinessEval = window.IAQAR_OPPORTUNITY?.evaluateMatchingReadiness
      ? window.IAQAR_OPPORTUNITY.evaluateMatchingReadiness({ ...item, id: doc.id })
      : null;
    const matchingReadiness = matchingReadinessStored
      || readinessEval?.matchingReadiness
      || "";
    const matchingReadinessMissing = matchingReadinessMissingStored.length
      ? matchingReadinessMissingStored
      : (readinessEval?.matchingReadinessMissing || []);
    const matchCount = Number(item.matchCount || item.activeMatchCount || 0);
    const followAt = (item.followUp && item.followUp.at)
      || item.nextFollowUpAt
      || item.viewingAt
      || item.appointmentAt
      || null;

    return {
      id: `opp-${doc.id}`,
      recordId: doc.id,
      recordType: "opportunity",
      main: "opportunities",
      priority: overdue ? 0 : lifecycleStatus === "NEW" ? 1 : 3,
      isAlert: overdue || lifecycleStatus === "NEW",
      icon: isOwner ? "i-house-check" : "i-user-clock",
      title,
      subtitle,
      opsStatusLine: card
        ? `${card.dataCompletenessLabel} · ${card.contactStatusLabel}${card.nextActionLabel !== "غير محدد" ? ` · ${card.nextActionLabel}` : ""}`
        : "",
      propertyType: item.propertyType || "",
      district: item.district || "",
      city: item.city || "",
      purpose: item.purpose || item.transactionType || "",
      advertiserRole: item.advertiserRole || item.ownerRole || "",
      contactPhone: item.contactPhone || item.phone || "",
      matchingReadiness,
      matchingReadinessMissing,
      isReadyForMatching: matchingReadiness === "READY_FOR_MATCHING" || readinessEval?.isReadyForMatching === true,
      matchCount,
      bestMatchScoreText: card?.bestMatchScoreText || "",
      createdAt: String(item.createdAt || item.receivedAt || ""),
      updatedAt: String(item.updatedAt || item.createdAt || item.receivedAt || ""),
      time: relativeTime(item.updatedAt || item.createdAt || item.receivedAt),
      detailsLines: card ? [
        card.description,
        card.location,
        `${card.priceOrBudget} · ${card.area}`,
        card.contactLine,
        `المصدر: ${card.sourceLabel}`,
        `اكتمال البيانات: ${card.dataCompletenessLabel}`,
        `التواصل: ${card.contactStatusLabel}`,
        `المطابقة: ${card.matchStatusLabel}`,
        `النتيجة: ${card.outcomeStatusLabel}`,
        card.nextActionLabel !== "غير محدد" ? `الإجراء القادم: ${card.nextActionLabel}` : "",
        card.bestMatchScoreText ? `أفضل مطابقة: ${card.bestMatchScoreText}` : ""
      ].filter(Boolean) : [
        `الحالة: ${lifecycleLabel}`,
        `المصدر: ${item.normalizedSource || item.source || "—"}`,
        `الاسم: ${item.contactName || "غير محدد"}`,
        `الجوال: ${item.contactPhone || "غير محدد"}`,
        `الملخص: ${LC().buildOpportunitySummary ? LC().buildOpportunitySummary(item) : ""}`,
        item.nextFollowUpAt ? `المتابعة القادمة: ${dateTimeLabel(item.nextFollowUpAt)}` : "المتابعة القادمة: غير محددة"
      ],
      status: lifecycleStatus,
      lifecycleStatus,
      lifecycleStatusLabel: lifecycleLabel,
      workflowStage: lifecycleStatus,
      nextAction: card?.nextActionLabel !== "غير محدد" ? card.nextActionLabel : "تفاصيل الفرصة",
      actionLabel: "تفاصيل الفرصة",
      secondaryActionLabel: "إدارة الفرصة",
      kind: isOwner ? "owner" : "client",
      contactType: isOwner ? "owner" : "buyer",
      contactName: item.contactName || "",
      contactPhone: item.contactPhone || "",
      whatsappOwner: isOwner,
      whatsappClient: !isOwner,
      nextFollowUpAt: followAt,
      viewingAt: item.viewingAt || item.appointmentAt || followAt || null,
      appointmentAt: item.appointmentAt || item.viewingAt || followAt || null,
      normalizedSource: item.normalizedSource || item.source || "",
      opportunityId: doc.id,
      sourceRecordId: item.sourceRecordId || "",
      sourceCollection: item.sourceCollection || "",
      transactionType: item.transactionType || "",
      amount: item.price || item.priceMax || 0,
      salePrice: item.salePrice ?? item.price,
      annualRent: item.annualRent,
      budget: item.budget ?? item.priceMax,
      priceOrBudget: item.priceOrBudget ?? item.price ?? item.amount,
      area: item.area || 0,
      rooms: item.rooms || 0,
      closureReason: item.closureReason || ""
    };
  }

  function filterOpportunityView(items) {
    return items.filter(item => {
      if (item.recordType === "summary") return true;
      if (item.main !== "opportunities") return true;
      if (item.recordType === "match" || item.recordType === "deal" || item.recordType === "operation") return true;
      const status = item.lifecycleStatus || (LC().getOpportunityLifecycleStatus ? LC().getOpportunityLifecycleStatus(item) : "NEW");
      const archived = status === "ARCHIVED";
      return opportunityView === "archived" ? archived : !archived;
    });
  }


  // Phase 8: client-side matcher removed — Worker matching-engine is authoritative.

  async function showLocalMatchNotification(matchCount, topMatch) {
    const title = matchCount > 1 ? `وجدنا ${matchCount} مطابقات جديدة` : "وجدنا مطابقة جديدة";
    const body = topMatch
      ? `${topMatch.propertyType || "عقار"} — ${topMatch.district || ""} — نسبة ${topMatch.score}%`
      : "افتح مساحة العمل لمراجعة المطابقة.";
    notify(title);
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        const registration = await navigator.serviceWorker?.ready.catch(() => null);
        if (registration && registration.showNotification) {
          await registration.showNotification(title, { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { type: "match", recordId: topMatch && topMatch.id || "" } });
        } else {
          new Notification(title, { body, icon: "icons/icon-192.png" });
        }
      }
    } catch (error) {
      console.warn("[iaqar] local notification", error);
    }
  }

  async function processPublicIntakeDoc(doc) {
    const runtime = office();
    const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
    if (!runtime || !runtime.officeId || !user || !doc || intakeProcessing.has(doc.id)) return;
    const intake = doc.data() || {};
    if (intake.status !== "new") return;
    intakeProcessing.add(doc.id);

    try {
      const response = await fetch(`${resolveWorkerBase()}/pipeline/public-intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ officeId: runtime.officeId, intakeId: doc.id })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "تعذر تشغيل المطابقة المركزية");
      if (Number(payload.matches || 0) > 0 && payload.bestMatch) {
        await showLocalMatchNotification(Number(payload.matches), {
          id: payload.bestMatch.matchId,
          score: payload.bestMatch.score,
          propertyType: payload.bestMatch.propertyType,
          district: payload.bestMatch.district
        });
      } else if (!payload.duplicate) {
        notify(intake.kind === "owner" ? "تم اعتماد عرض المالك، ولا توجد مطابقة حاليًا" : "تم اعتماد طلب العميل، ولا توجد مطابقة حاليًا");
      }
    } catch (error) {
      console.error("[iaqar] central public intake matching", error);
      notify("تعذر تشغيل المطابقة الآن؛ سيعاد تشغيلها تلقائيًا عند توفر الاتصال");
    } finally {
      intakeProcessing.delete(doc.id);
    }
  }

  function processNewPublicIntakes(snapshot) {
    snapshot.docs
      .filter(doc => (doc.data() || {}).status === "new")
      .forEach(doc => processPublicIntakeDoc(doc));
  }

  function opsDomain() {
    return (window.IAQAR && window.IAQAR.operationsDomain) || null;
  }

  function projectPersistedOperation(doc) {
    const data = { id: doc.id, ...(doc.data() || {}) };
    const domain = opsDomain();
    if (domain && typeof domain.projectOperationToUiItem === "function") {
      return domain.projectOperationToUiItem(data, { relativeTime });
    }
    // Fallback projector if the domain module has not loaded yet.
    const priorityMap = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
    return {
      id: data.id,
      recordId: data.id,
      recordType: "operation",
      operationType: data.type || "SYSTEM_ACTION",
      main: "opportunities",
      priority: priorityMap[String(data.priority || "NORMAL").toUpperCase()] ?? 2,
      priorityKey: data.priority || "NORMAL",
      isAlert: ["URGENT", "HIGH"].includes(String(data.priority || "").toUpperCase()),
      icon: "i-clipboard-list",
      title: data.titleText || "إجراء مطلوب",
      subtitle: data.summaryText || "",
      time: relativeTime(data.updatedAt || data.createdAt),
      detailsLines: [data.summaryText || "لا توجد تفاصيل إضافية."],
      status: data.status || "OPEN",
      actionLabel: data.recommendedActionText || "عرض التفاصيل",
      secondaryActionLabel: "إتمام",
      canDismiss: ACTIVE_OPERATION_STATUSES.includes(String(data.status || "").toUpperCase()),
      dismissLabel: "صرف النظر",
      matchId: data.matchId || "",
      opportunityId: data.opportunityId || "",
      cooperationId: data.cooperationId || "",
      whatsappOwner: false,
      whatsappClient: false
    };
  }

  function pruneSavedOpportunityWorkspaceItems() {
    const covered = new Set(
      operationItems.map(item => String(item.opportunityId || "").trim()).filter(Boolean)
    );
    savedOpportunityWorkspaceItems = savedOpportunityWorkspaceItems.filter(
      item => !covered.has(String(item.opportunityId || "").trim())
    );
  }

  function buildSavedOpportunityWorkspaceItem(opportunityId, matchCount = 0) {
    const id = String(opportunityId || "").trim();
    if (!id) return null;
    const matches = Number(matchCount || 0);
    return {
      id: `saved-opportunity-${id}`,
      recordId: id,
      recordType: "opportunity",
      operationType: "OPPORTUNITY_SAVED",
      main: "bank",
      priority: 0,
      isAlert: false,
      icon: "i-clipboard-list",
      title: "فرصة جديدة محفوظة",
      subtitle: matches > 0 ? `تم العثور على ${matches} مطابقة` : "أُضيفت إلى العروض والطلبات",
      time: "الآن",
      detailsLines: [
        matches > 0
          ? `تم حفظ الفرصة وإنشاء ${matches} مطابقة جديدة.`
          : "تم حفظ الفرصة بنجاح — راجع التفاصيل في العروض والطلبات."
      ],
      actionLabel: "فتح العروض والطلبات",
      secondaryActionLabel: "إغلاق",
      canDismiss: false,
      opportunityId: id
    };
  }

  function pushSavedOpportunityToWorkspace({
    opportunityId,
    duplicate = false,
    matchCount = 0,
    advertiserPhone = "",
    propertyType = "",
    district = "",
    marketingConsentStatus = ""
  } = {}) {
    const id = String(opportunityId || "").trim();
    if (!id) return;
    const savedItem = buildSavedOpportunityWorkspaceItem(id, matchCount);
    if (!savedItem) return;
    if (duplicate) {
      savedItem.title = "فرصة موجودة";
      savedItem.subtitle = "تم تحديث الفرصة الحالية";
      savedItem.detailsLines = ["توجد فرصة نشطة لهذا الرقم — تم تحديث الفرصة الحالية بدل إنشاء نسخة مكررة."];
    }
    savedOpportunityWorkspaceItems = [
      savedItem,
      ...savedOpportunityWorkspaceItems.filter(item => item.recordId !== savedItem.recordId)
    ].slice(0, 3);

    const phone = String(advertiserPhone || "").trim();
    const needsFollowup = phone
      && !["PRELIMINARY_YES", "REFUSED"].includes(String(marketingConsentStatus || "").toUpperCase());
    if (needsFollowup && !duplicate) {
      const label = [propertyType, district].filter(Boolean).join(" — ");
      const followup = {
        id: `advertiser-followup-${id}`,
        recordId: id,
        recordType: "opportunity",
        operationType: "ADVERTISER_FOLLOWUP",
        main: "bank",
        priority: 1,
        isAlert: false,
        icon: "i-user-clock",
        title: label ? `استكمال بيانات معلن فرصة ${label}` : "استكمال بيانات المعلن",
        subtitle: "راجع رقم المعلن ورسالة الاستكمال",
        time: "الآن",
        detailsLines: ["يوجد رقم معلن — أكمل التواصل وتحديث الحالة يدويًا."],
        actionLabel: "فتح العروض والطلبات",
        secondaryActionLabel: "إغلاق",
        canDismiss: true,
        opportunityId: id
      };
      savedOpportunityWorkspaceItems = [
        followup,
        ...savedOpportunityWorkspaceItems.filter(item => item.id !== followup.id)
      ].slice(0, 4);
    }
    emitOperations();
  }

  function isSavedOpportunityPresentationItem(item) {
    const type = String(item?.operationType || "").toUpperCase();
    return type === "OPPORTUNITY_SAVED"
      || String(item?.title || "").trim() === "فرصة محفوظة مسبقًا";
  }

  function activeMatchOperations() {
    return matchItems.filter((item) => !["completed", "closed"].includes(String(item.status || "").toLowerCase()));
  }

  function activeDealOperations() {
    return dealItems.filter((item) => !["closed", "lost"].includes(String(item.status || "").toLowerCase()));
  }

  function emitOperations() {
    // Phase 5: Operations Center shows persisted Operations; hide save-success feedback only.
    pruneSavedOpportunityWorkspaceItems();
    const workspaceItems = savedOpportunityWorkspaceItems.filter(
      (item) => !isSavedOpportunityPresentationItem(item)
    );
    const baseItems = [
      ...operationItems,
      ...intakeItems,
      ...opportunityItems,
      ...activeMatchOperations(),
      ...activeDealOperations(),
      ...workspaceItems
    ].sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2));
    const alerts = BAL()?.scanBrokerAlerts ? BAL().scanBrokerAlerts(baseItems) : [];
    const items = filterOpportunityView([...alerts, ...baseItems].sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2)));
    window.dispatchEvent(new CustomEvent("iaqar:operations-data", { detail: { items, authoritative: true, opportunityView } }));
  }

  async function opportunityLifecycleAction(action, detail, extra = {}) {
    const runtime = office();
    if (!runtime || !runtime.officeId) throw new Error("تعذر تحديد المكتب");
    const response = await fetch(`${resolveWorkerBase()}/opportunity/lifecycle`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        officeId: runtime.officeId,
        recordType: detail.recordType === "intake" ? "intake" : "opportunity",
        recordId: detail.recordId,
        opportunityId: detail.opportunityId || detail.recordId,
        action,
        ...extra
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "تعذر تحديث دورة الفرصة");
    return payload;
  }

  async function postOperationAction(operationId, action, reason = "") {
    const runtime = office();
    const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
    if (!runtime || !runtime.officeId || !user) throw new Error("سجل دخول المكتب أولًا");
    const response = await fetch(`${resolveWorkerBase()}/operations/action`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        officeId: runtime.officeId,
        operationId,
        action,
        reason
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || payload.error || "تعذر تحديث العملية");
    return payload;
  }

  async function authHeaders() {
    const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
    if (!user) throw new Error("سجل دخول المكتب أولًا");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await user.getIdToken(true)}`
    };
  }

  async function submitPendingShare() {
    const pending = readPendingShare();
    if (!pending) return;
    const runtime = office();
    if (!runtime || !runtime.officeId || runtime.officeId === "platform") {
      notify("افتح رابط مكتبك أولًا ثم أعد مشاركة الرسالة");
      return;
    }
    const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
    if (!user) {
      notify("سجل دخول المكتب لإدخال الرسالة المشتركة");
      return;
    }
    try {
      notify("جاري فرز الرسالة وتشغيل المطابقة");
      const response = await fetch(`${resolveWorkerBase()}/pipeline/intake`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          officeId: runtime.officeId,
          eventId: pending.id,
          messageText: pending.messageText,
          senderName: pending.senderName || "مشاركة من واتساب",
          source: "pwa_share_target",
          receivedAt: pending.receivedAt || new Date().toISOString()
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "تعذر إدخال الرسالة");
      clearPendingShare();
      notify(Number(payload.matches || 0) > 0
        ? `تم فرز الرسالة وإنشاء ${payload.matches} مطابقة`
        : "تم فرز الرسالة ولم تظهر مطابقة حاليًا");
      history.replaceState({}, "", location.pathname + (runtime.officeId ? `?officeId=${encodeURIComponent(runtime.officeId)}` : ""));
    } catch (error) {
      notify(error.message || "تعذر معالجة الرسالة المشتركة");
    }
  }

  async function loadAnalytics() {
    const runtime = office();
    const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
    if (!runtime || !runtime.officeId || !user) return;
    try {
      const response = await fetch(`${resolveWorkerBase()}/office/analytics?officeId=${encodeURIComponent(runtime.officeId)}`, { headers: await authHeaders() });
      const data = await response.json();
      if (!response.ok) return;
      const summary = data.morningSummary || data.counts || {};
      const best = data.bestOpportunity || null;
      analyticsItem = {
        id: "daily-priorities",
        recordId: "daily-priorities",
        recordType: "summary",
        main: "opportunities",
        priority: -1,
        isAlert: Number(summary.dueFollowUps || 0) > 0,
        icon: "i-clipboard-list",
        title: "أولويات اليوم",
        subtitle: Number(summary.dueFollowUps || 0) > 0 ? `${summary.dueFollowUps} متابعات مستحقة` : "العمل مرتب حسب الأقرب للإغلاق",
        time: "الآن",
        detailsLines: [
          `المتابعات المستحقة: ${Number(summary.dueFollowUps || 0)}`,
          `فرص جاهزيتها عالية جدًا: ${Number(summary.veryReady || 0)}`,
          `صفقات في التفاوض وما بعده: ${Number(summary.negotiationDeals || 0)}`,
          `العمولات المتوقعة: ${Number(summary.commissionExpected || 0).toLocaleString("ar-SA")} ريال`,
          best ? `أفضل فرصة: ${best.matchScore || best.score || 0}% — جاهزية الإغلاق ${best.closingReadinessLabel || "متوسطة"}` : "لا توجد فرصة مكتملة البيانات الآن"
        ],
        actionLabel: best ? "فتح أفضل فرصة" : "مراجعة الفرص",
        secondaryActionLabel: "إغلاق التفاصيل",
        targetId: best && best.matchId || "",
        targetMain: "opportunities"
      };
      emitOperations();
    } catch (error) {
      console.warn("[iaqar] analytics", error);
    }
  }

  function stopLiveData() {
    liveUnsubscribers.forEach(unsubscribe => { try { unsubscribe(); } catch (_) {} });
    liveUnsubscribers = [];
    liveOfficeKey = "";
  }

  function startLiveData() {
    const runtime = office();
    const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
    if (!runtime || !runtime.refs || !user) return;
    const key = `${runtime.officeId}:${user.uid}`;
    if (liveOfficeKey === key && liveUnsubscribers.length) return;
    stopLiveData();
    liveOfficeKey = key;

    const onError = error => {
      console.warn("[iaqar] live listener", error);
      if (String(error && error.code || "").includes("permission-denied")) {
        notify("حسابك لا يملك صلاحية بيانات هذا المكتب");
      }
    };

    const matchUnsub = runtime.refs.matches.orderBy("createdAt", "desc").limit(100).onSnapshot(snapshot => {
      matchItems = snapshot.docs.map(matchOperation);
      loadAnalytics();
    }, onError);
    const dealUnsub = runtime.refs.deals.orderBy("updatedAt", "desc").limit(100).onSnapshot(snapshot => {
      dealItems = snapshot.docs.map(dealOperation);
      loadAnalytics();
    }, onError);
    const intakeUnsub = runtime.db.collection("offices").doc(runtime.officeId).collection("publicIntake")
      .orderBy("createdAt", "desc").limit(100).onSnapshot(snapshot => {
        intakeItems = snapshot.docs.map(intakeOperation);
        processNewPublicIntakes(snapshot);
      }, onError);

    const operationsRef = runtime.refs.operations
      || runtime.db.collection("offices").doc(runtime.officeId).collection("operations");
    // Bounded active-status query; client sorts by priority after snapshot.
    const opsUnsub = operationsRef
      .where("status", "in", ACTIVE_OPERATION_STATUSES.slice())
      .orderBy("createdAt", "desc")
      .limit(50)
      .onSnapshot(snapshot => {
        operationItems = snapshot.docs.map(projectPersistedOperation);
        pruneSavedOpportunityWorkspaceItems();
        emitOperations();
      }, (error) => {
        console.warn("[iaqar] operations listener", error);
        // Fallback without orderBy if composite index/query fails — still surface MATCH_REVIEW.
        operationsRef
          .where("status", "in", ACTIVE_OPERATION_STATUSES.slice())
          .limit(50)
          .get()
          .then((snapshot) => {
            operationItems = snapshot.docs.map(projectPersistedOperation)
              .sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2));
            pruneSavedOpportunityWorkspaceItems();
            emitOperations();
          })
          .catch((fallbackError) => {
            console.warn("[iaqar] operations fallback", fallbackError);
            onError(fallbackError);
          });
      });

    liveUnsubscribers = [matchUnsub, dealUnsub, intakeUnsub, opsUnsub];
    const opportunityUnsub = runtime.db.collection("offices").doc(runtime.officeId).collection("opportunities")
      .orderBy("updatedAt", "desc").limit(100).onSnapshot(snapshot => {
        opportunityItems = snapshot.docs.map(opportunityOperation);
        emitOperations();
      }, onError);
    liveUnsubscribers.push(opportunityUnsub);
    // Ensure empty authoritative state until the first operations snapshot arrives.
    if (!operationItems.length) emitOperations();
  }

  async function loadTimeline(recordType, recordId) {
    if (!recordId || !["match", "deal"].includes(recordType)) return;
    const cacheKey = `${recordType}:${recordId}`;
    if (timelinePending.has(cacheKey)) return;
    timelinePending.add(cacheKey);
    try {
      const runtime = office();
      if (!runtime || !runtime.refs) return;
      const collection = recordType === "deal" ? runtime.refs.deals : runtime.refs.matches;
      const snapshot = await collection.doc(recordId).collection("timeline").orderBy("createdAt", "desc").limit(20).get();
      timelineCache.set(cacheKey, snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      // إعادة قراءة المستند نفسه تضمن تحديث النص بدون إنشاء مستمعات فرعية دائمة.
      const currentDoc = await collection.doc(recordId).get();
      if (currentDoc.exists) {
        if (recordType === "match") matchItems = replaceOperation(matchItems, matchOperation(currentDoc));
        else dealItems = replaceOperation(dealItems, dealOperation(currentDoc));
      }
      emitOperations();
    } catch (error) {
      console.warn("[iaqar] timeline", error);
    } finally {
      timelinePending.delete(cacheKey);
    }
  }

  function replaceOperation(items, operation) {
    const index = items.findIndex(item => item.recordId === operation.recordId);
    if (index < 0) return [operation, ...items];
    const copy = [...items];
    copy[index] = operation;
    return copy;
  }

  async function workflowAction(action, recordId, extra = {}) {
    const runtime = office();
    if (!runtime || !runtime.officeId) throw new Error("تعذر تحديد المكتب");
    const response = await fetch(`${resolveWorkerBase()}/workflow/action`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ officeId: runtime.officeId, action, recordId, ...extra })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "تعذر تنفيذ الإجراء");
    return payload;
  }

  function whatsappPhone(value) {
    if (LC().normalizeSaudiPhoneForWhatsApp) return LC().normalizeSaudiPhoneForWhatsApp(value);
    const digits = String(value || "").replace(/\D/g, "");
    if (/^009665\d{8}$/.test(digits)) return digits.slice(2);
    if (/^9665\d{8}$/.test(digits)) return digits;
    if (/^05\d{8}$/.test(digits)) return `966${digits.slice(1)}`;
    if (/^5\d{8}$/.test(digits)) return `966${digits}`;
    return "";
  }

  function openWhatsAppHandoff({ phone = "", text = "", url = "" } = {}) {
    const handoff = window.IAQAR?.whatsappHandoff;
    const digits = whatsappPhone(phone);
    if (handoff?.openWhatsAppUrl && url && handoff.isSafeWhatsAppHttpUrl?.(url)) {
      return handoff.openWhatsAppUrl(url, { phone: digits || phone, text });
    }
    if (handoff?.openWhatsApp) {
      return handoff.openWhatsApp({ phone: digits || phone, text });
    }
    if (!digits) return { ok: false, reason: "invalid_phone", url: "" };
    const fallback = `https://wa.me/${digits}?text=${encodeURIComponent(String(text || ""))}`;
    window.open(fallback, "_blank", "noopener,noreferrer");
    return { ok: true, mode: "fallback", url: fallback };
  }

  function brokerDisplayName() {
    return String(document.getElementById("brokerDisplayName")?.textContent || document.getElementById("officeDisplayName")?.textContent || "الوسيط").trim();
  }

  function officeDisplayName() {
    return String(document.getElementById("officeDisplayName")?.textContent || "المكتب العقاري").trim();
  }

  function escapeUi(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  function BAP() {
    return window.IAQAR?.brokerActionProgress || {};
  }

  function brokerDoneClass(detail = {}, actionKey = "") {
    return BAP().brokerActionDoneClass?.(detail, actionKey) || "";
  }

  function brokerPressed(detail = {}, actionKey = "") {
    return BAP().brokerActionAriaPressed?.(detail, actionKey) || "false";
  }

  function applyWorkflowBrokerMarks(detail = {}) {
    BAP().applyBrokerActionMarks?.(workflowBody(), detail);
  }

  function mergeWorkflowBrokerProgress(detail = {}, actionKey = "", followPatch = null) {
    let next = detail;
    if (actionKey) next = BAP().markBrokerActionDoneLocally?.(next, actionKey) || next;
    if (followPatch) next = BAP().markFollowUpProgressLocally?.(next, followPatch) || next;
    return next;
  }

  function syncWorkflowDetailFromLifecyclePayload(payload = {}, actionKey = "", followPatch = null) {
    let next = {
      ...activeWorkflowDetail,
      ...payload,
      followUp: payload.followUp || activeWorkflowDetail.followUp,
      brokerActionProgress: payload.brokerActionProgress || activeWorkflowDetail.brokerActionProgress
    };
    next = mergeWorkflowBrokerProgress(next, actionKey, followPatch);
    activeWorkflowDetail = next;
    return next;
  }

  function appointmentValue(detail) {
    return detail.appointmentAt || detail.viewingAt || null;
  }

  function appointmentText(detail) {
    const value = appointmentValue(detail);
    return value ? dateTimeLabel(value) : "لم يحدد بعد";
  }

  function viewingDateTimePartsUi(value) {
    const handoff = window.IAQAR?.whatsappHandoff;
    if (handoff?.viewingDateTimeParts) return handoff.viewingDateTimeParts(value);
    const date = toDate(value);
    if (!date) return { date: "", time: "" };
    return {
      date: date.toLocaleDateString("ar-SA", { timeZone: "Asia/Riyadh", year: "numeric", month: "long", day: "numeric" }),
      time: date.toLocaleTimeString("ar-SA", { timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit" })
    };
  }

  function ownerRequestWhatsAppTextUi(items, note) {
    const handoff = window.IAQAR?.whatsappHandoff;
    if (handoff?.ownerRequestWhatsAppText) {
      return handoff.ownerRequestWhatsAppText({ items, note });
    }
    const labels = [];
    const map = { photos: "صور العقار", location: "موقع العقار", propertyLink: "رابط العقار" };
    for (const item of items || []) {
      if (map[item] && !labels.includes(map[item])) labels.push(map[item]);
    }
    if (!labels.length) return "";
    const joined = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(" و")} و${labels[labels.length - 1]}`;
    const extra = String(note || "").trim();
    return `السلام عليكم، نحتاج ${joined} لاستكمال بيانات العرض.${extra ? `\n${extra}` : ""}`;
  }

  function viewingAppointmentWhatsAppTextUi(viewingAt) {
    const handoff = window.IAQAR?.whatsappHandoff;
    if (handoff?.viewingAppointmentWhatsAppText) {
      return handoff.viewingAppointmentWhatsAppText(viewingAt);
    }
    const { date, time } = viewingDateTimePartsUi(viewingAt);
    if (!date || !time) return "";
    return `السلام عليكم، تم تحديد موعد معاينة العقار بتاريخ ${date} الساعة ${time}.`;
  }

  async function openPartyWhatsApp(detail, role, text) {
    const enriched = await enrichDetailForMessaging(detail);
    const contact = await resolveWorkflowPartyContact(enriched, role);
    const phone = whatsappPhone(contact && contact.phone);
    if (!phone) {
      notify(`رقم ${role === "owner" ? "المالك" : "العميل"} غير موجود أو غير صحيح`);
      return false;
    }
    openWhatsAppHandoff({ phone, text });
    notify("فُتح واتساب — أكّد الإرسال بنفسك");
    return true;
  }

  async function sendViewingAppointmentWhatsApp(role) {
    const detail = activeWorkflowDetail;
    const at = appointmentValue(detail);
    if (!at) return notify("حدد موعد المعاينة أولًا");
    const text = viewingAppointmentWhatsAppTextUi(at);
    if (!text) return notify("حدد موعد المعاينة أولًا");
    await openPartyWhatsApp(detail, role === "owner" ? "owner" : "client", text);
  }

  async function syncOfficeContact(role, contact, recordId = "") {
    const runtime = office();
    const digits = String(contact && contact.phone || "").replace(/\D/g, "");
    if (!runtime || !runtime.db || !runtime.officeId || !digits) return;
    try {
      await runtime.db.collection("offices").doc(runtime.officeId).collection("contacts").doc(digits).set({
        officeId: runtime.officeId,
        fullName: contact.name || "",
        name: contact.name || "",
        phone: contact.phone || "",
        roles: window.firebase.firestore.FieldValue.arrayUnion(role),
        lastRecordId: recordId || "",
        lastRecordType: role,
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.warn("[iaqar] contact sync", error);
    }
  }

  async function workflowContact(detail, role) {
    if (detail.recordType === "intake") {
      if ((role === "owner" && detail.kind !== "owner") || (role === "client" && detail.kind === "owner")) return null;
      const contact = { name: detail.contactName || "", phone: detail.contactPhone || "" };
      await syncOfficeContact(role, contact, detail.recordId);
      return contact;
    }
    const runtime = office();
    if (!runtime || !runtime.refs) return null;
    const recordId = role === "owner" ? detail.ownerOfferId : detail.clientRequestId;
    const collection = role === "owner" ? runtime.refs.owners : runtime.refs.clients;
    if (!recordId || !collection) return null;
    const snapshot = await collection.doc(recordId).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data() || {};
    const contact = {
      name: data.contactName || data.name || "",
      phone: data.contactPhone || data.phone || ""
    };
    await syncOfficeContact(role, contact, recordId);
    return contact;
  }

  function isOwnerPartyDetail(detail = {}) {
    const contactType = String(detail.contactType || "").toLowerCase();
    const recordType = String(detail.recordType || "").toLowerCase();
    const kind = String(detail.kind || "").toLowerCase();
    const opportunityKind = String(detail.opportunityKind || "").toUpperCase();
    const advertiserRole = String(detail.advertiserRole || "").toUpperCase();
    if (contactType === "owner" || recordType === "owner_offer" || kind === "owner" || kind === "owner_offer") {
      return true;
    }
    if (opportunityKind === "OFFER" || recordType === "owner") return true;
    if (advertiserRole === "OWNER") return true;
    return false;
  }

  async function resolveWorkflowPartyContact(detail, role) {
    const roleKey = String(role || "").toLowerCase();
    const linked = await workflowContact(detail, roleKey);
    if (linked?.phone) return linked;

    const phoneInfo = resolveLifecyclePhone(detail);
    if (!phoneInfo.valid) return null;

    const isOwnerParty = isOwnerPartyDetail(detail);
    const matchesOwner = roleKey === "owner" && isOwnerParty;
    const matchesClient = roleKey === "client" && !isOwnerParty;
    if (!matchesOwner && !matchesClient) return null;

    return {
      name: detail.contactName || detail.advertiserDisplayName || "",
      phone: phoneInfo.whatsappDigits || phoneInfo.local || detail.contactPhone || ""
    };
  }

  function resolveMessageStage(detail) {
    return detail.messageStage
      || (detail.recordType === "deal" ? detail.workflowStage : detail.status)
      || (detail.recordType === "operation" ? "match_review" : "contact");
  }

  function whatsappMessage(detail, role, contact) {
    const domain = messagingDomain();
    const officeName = officeDisplayName();
    const stage = resolveMessageStage(detail);
    if (domain && typeof domain.buildArabicMessageBody === "function") {
      const templateCode = typeof domain.resolveTemplateCode === "function"
        ? domain.resolveTemplateCode({
          templateCode: detail.templateCode,
          role,
          stage,
          messageMode: detail.messageMode || "",
          ownerMediaMissing: detail.ownerMediaMissing === true
        })
        : "";
      return domain.buildArabicMessageBody({
        templateCode,
        role,
        officeName,
        contactName: contact && contact.name || "",
        propertyType: detail.propertyType || "",
        district: detail.district || "",
        appointmentLabel: appointmentText(detail),
        requestedItems: detail.requestedItems || [],
        requestNote: detail.requestNote || "",
        stage
      });
    }
    // Fallback if messaging domain module has not loaded yet.
    const name = contact.name ? ` ${contact.name}` : "";
    const greeting = `مرحبًا${name}، معك ${officeName}.`;
    const property = [detail.propertyType, detail.district].filter(Boolean).join(" في ") || "العقار";
    return `${greeting}\n\nنتواصل معك بخصوص ${property} لتأكيد البيانات وترتيب الخطوة التالية.\n\nمع التحية،\n${officeName}`;
  }

  async function enrichDetailForMessaging(detail) {
    const next = { ...detail };
    if (next.ownerOfferId && next.clientRequestId) return next;
    const matchId = next.matchId || (next.recordType === "match" ? next.recordId : "");
    if (!matchId) return next;
    const fromCache = matchItems.find((item) => item.recordId === matchId || item.id === matchId);
    if (fromCache) {
      next.ownerOfferId = next.ownerOfferId || fromCache.ownerOfferId || "";
      next.clientRequestId = next.clientRequestId || fromCache.clientRequestId || "";
      next.propertyType = next.propertyType || fromCache.propertyType || "";
      next.district = next.district || fromCache.district || "";
      next.ownerMediaMissing = next.ownerMediaMissing ?? fromCache.ownerMediaMissing;
      next.status = next.status || fromCache.status || "";
      return next;
    }
    const runtime = office();
    if (!runtime || !runtime.refs || !runtime.refs.matches) return next;
    try {
      const snap = await runtime.refs.matches.doc(matchId).get();
      if (!snap.exists) return next;
      const data = snap.data() || {};
      next.ownerOfferId = next.ownerOfferId || data.ownerOfferId || "";
      next.clientRequestId = next.clientRequestId || data.clientRequestId || "";
      next.propertyType = next.propertyType || data.propertyType || "";
      next.district = next.district || data.district || "";
      next.ownerMediaMissing = next.ownerMediaMissing ?? data.ownerMediaMissing;
      next.status = next.status || data.status || "";
    } catch (error) {
      console.warn("[iaqar] enrich match for messaging", error);
    }
    return next;
  }

  async function persistAndOpenMessageDraft(detail, channel) {
    const runtime = office();
    const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
    const domain = messagingDomain();
    if (!runtime || !runtime.officeId || !user) {
      return notify("سجل دخول المكتب أولًا");
    }
    const role = detail.recipientRole === "owner" ? "owner" : "client";
    const enriched = await enrichDetailForMessaging(detail);
    const contact = await resolveWorkflowPartyContact(enriched, role);
    const safeChannel = channel === "telegram" ? "telegram" : "whatsapp";
    if (safeChannel === "whatsapp") {
      const phone = whatsappPhone(contact && contact.phone);
      if (!phone) {
        return notify(`رقم ${role === "owner" ? "المالك" : "العميل"} غير موجود أو غير صحيح`);
      }
    }

    const stage = resolveMessageStage(enriched);
    const bodyText = whatsappMessage(enriched, role, contact || {});
    let handoffUrl = "";
    let messageId = "";

    if (domain && typeof domain.requestCreateMessageDraft === "function") {
      const idToken = await user.getIdToken(true);
      const created = await domain.requestCreateMessageDraft({
        workerBase: resolveWorkerBase(),
        idToken,
        officeId: runtime.officeId,
        channel: safeChannel,
        role,
        contactName: contact && contact.name || "",
        contactPhone: contact && contact.phone || "",
        propertyType: enriched.propertyType || "",
        district: enriched.district || "",
        appointmentLabel: appointmentText(enriched),
        officeName: officeDisplayName(),
        stage,
        messageMode: enriched.messageMode || "",
        ownerMediaMissing: enriched.ownerMediaMissing === true,
        requestedItems: enriched.requestedItems || [],
        requestNote: enriched.requestNote || "",
        operationId: enriched.recordType === "operation" ? (enriched.recordId || enriched.id || "") : "",
        matchId: enriched.matchId || (enriched.recordType === "match" ? enriched.recordId : "") || "",
        opportunityId: enriched.opportunityId || "",
        body: bodyText
      });
      if (!created.ok) {
        return notify(created.message || "تعذر حفظ مسودة الرسالة");
      }
      messageId = created.messageId || (created.draft && created.draft.id) || "";
      handoffUrl = (created.draft && created.draft.handoffUrl) || "";
      if (messageId && typeof domain.requestMessageHandoff === "function") {
        const handed = await domain.requestMessageHandoff({
          workerBase: resolveWorkerBase(),
          idToken,
          officeId: runtime.officeId,
          messageId
        });
        if (handed.ok) {
          handoffUrl = handed.handoffUrl || handoffUrl;
          // OPENED_EXTERNAL only — never treat as provider SENT/DELIVERED.
        }
      }
    }

    if (safeChannel === "whatsapp") {
      const phone = whatsappPhone(contact && contact.phone);
      if (!phone && !handoffUrl) {
        return notify("تعذر تجهيز رابط الرسالة");
      }
      openWhatsAppHandoff({
        phone,
        text: bodyText,
        url: handoffUrl && window.IAQAR?.whatsappHandoff?.isSafeWhatsAppHttpUrl?.(handoffUrl)
          ? handoffUrl
          : undefined
      });
      notify("فُتح واتساب — أكّد الإرسال بنفسك");
      return;
    }

    if (!handoffUrl) {
      if (domain && typeof domain.buildTelegramHandoffUrl === "function") {
        handoffUrl = domain.buildTelegramHandoffUrl({ body: bodyText }).url;
      } else {
        handoffUrl = `https://t.me/share/url?url=${encodeURIComponent("https://iaqar.ai/")}&text=${encodeURIComponent(bodyText)}`;
      }
    }

    if (!handoffUrl) {
      return notify("تعذر تجهيز رابط الرسالة");
    }
    window.location.href = handoffUrl;
    notify("فُتح تليجرام — أكّد الإرسال بنفسك");
  }

  function resolveLifecyclePhone(detail) {
    if (LC().resolveOpportunityCanonicalPhone) {
      return LC().resolveOpportunityCanonicalPhone(detail);
    }
    const whatsappDigits = whatsappPhone(detail.contactPhone);
    if (!whatsappDigits) return { valid: false, error: "رقم الجوال غير مكتمل" };
    const local = `0${whatsappDigits.slice(3)}`;
    return { valid: true, whatsappDigits, local, tel: local };
  }

  function buildLifecycleContactMessage(detail) {
    const lifecycleStatus = detail.lifecycleStatus || (LC().getOpportunityLifecycleStatus ? LC().getOpportunityLifecycleStatus(detail) : "NEW");
    const actionType = LC().whatsappActionTypeForStatus ? LC().whatsappActionTypeForStatus(lifecycleStatus) : "first_contact";
    const isOwner = detail.kind === "owner" || detail.contactType === "owner";
    const role = isOwner ? "owner" : "client";
    const contactName = String(detail.contactName || detail.advertiserDisplayName || "").trim();
    const payload = {
      ...detail,
      contactType: isOwner ? "owner" : "buyer",
      kind: isOwner ? "owner" : "client",
      contactPhone: detail.contactPhone || detail.advertiserPhone || detail.advertiserPhoneNormalized || ""
    };
    if (contactName) payload.contactName = contactName;
    return LC().buildOpportunityWhatsAppMessage
      ? LC().buildOpportunityWhatsAppMessage(payload, actionType, {
        brokerName: brokerDisplayName(),
        officeName: officeDisplayName(),
        matchSummary: detail.matchSummary || ""
      })
      : whatsappMessage(detail, role, { name: contactName, phone: payload.contactPhone });
  }

  async function openContactWhatsAppDirect() {
    const detail = activeWorkflowDetail;
    if (!detail) return;
    const phoneInfo = resolveLifecyclePhone(detail);
    if (!phoneInfo.valid) return notify(phoneInfo.error || "رقم الجوال غير مكتمل");
    const message = buildLifecycleContactMessage(detail);
    openWhatsAppHandoff({ phone: phoneInfo.whatsappDigits, text: message });
    lifecycleContactAttempted = true;
    try {
      const payload = await opportunityLifecycleAction("whatsapp_opened", detail, { communicationAction: "whatsapp_opened" });
      syncWorkflowDetailFromLifecyclePayload(
        payload,
        BAP().BROKER_ACTION?.contactWhatsApp || "contact:whatsapp"
      );
    } catch (error) {
      console.warn("[iaqar] whatsapp opened log", error);
      activeWorkflowDetail = mergeWorkflowBrokerProgress(
        detail,
        BAP().BROKER_ACTION?.contactWhatsApp || "contact:whatsapp"
      );
    }
    notify("تم فتح واتساب");
    renderOpportunityLifecycleUi();
  }

  async function openContactCallDirect() {
    const detail = activeWorkflowDetail;
    if (!detail) return;
    const phoneInfo = resolveLifecyclePhone(detail);
    if (!phoneInfo.valid) return notify(phoneInfo.error || "رقم الجوال غير مكتمل");
    window.location.href = `tel:${phoneInfo.tel || phoneInfo.local}`;
    lifecycleContactAttempted = true;
    try {
      const payload = await opportunityLifecycleAction("call_opened", detail);
      syncWorkflowDetailFromLifecyclePayload(
        payload,
        BAP().BROKER_ACTION?.contactCall || "contact:call"
      );
    } catch (error) {
      console.warn("[iaqar] call opened log", error);
      activeWorkflowDetail = mergeWorkflowBrokerProgress(
        detail,
        BAP().BROKER_ACTION?.contactCall || "contact:call"
      );
    }
    notify("تم فتح الاتصال");
    renderOpportunityLifecycleUi();
  }

  async function openLifecycleWhatsApp(detail) {
    activeWorkflowDetail = { ...detail };
    openContactWhatsAppDirect();
  }

  function buildMissingDataWhatsAppMessage(opportunity = {}) {
    const brokerName = brokerDisplayName();
    const officeName = officeDisplayName();
    const isOwner = opportunity.contactType === "owner" || opportunity.kind === "owner";
    const property = LC().buildOpportunitySummary ? LC().buildOpportunitySummary(opportunity) : "";
    const intro = `معك ${brokerName} من ${officeName}.`;
    if (isOwner) {
      return [
        "السلام عليكم،",
        intro,
        "",
        `بخصوص عرضكم: ${property}`,
        "",
        "نرغب في استكمال صور العقار والبيانات الناقصة قبل المتابعة.",
        "",
        "شاكرين لكم."
      ].join("\n");
    }
    return [
      "السلام عليكم،",
      intro,
      "",
      `بخصوص طلبكم: ${property}`,
      "",
      "نرغب في استكمال بعض البيانات أو الصور الناقصة لمساعدتكم بشكل أفضل.",
      "",
      "شاكرين لكم."
    ].join("\n");
  }

  async function openWorkflowWhatsApp(detail) {
    if (["intake", "opportunity"].includes(detail.recordType)) {
      return openLifecycleWhatsApp(detail);
    }
    return persistAndOpenMessageDraft(detail, "whatsapp");
  }

  async function openWorkflowTelegram(detail) {
    return persistAndOpenMessageDraft(detail, "telegram");
  }

  let activeWorkflowDetail = null;
  let activeWorkflowContacts = { owner: null, client: null };
  let lifecycleContactAttempted = false;
  let followUpEditMode = false;
  let followUpRecipientContext = null;
  const CLOSE_REASONS = Object.freeze([
    ["client_not_interested", "العميل غير مهتم"],
    ["owner_not_responding", "المالك غير متجاوب"],
    ["property_unavailable", "العقار لم يعد متاحًا"],
    ["price_not_suitable", "السعر غير مناسب"],
    ["specifications_not_suitable", "المواصفات غير مناسبة"],
    ["outside_platform", "تم التعامل خارج المنصة"],
    ["duplicate", "طلب مكرر"],
    ["other", "سبب آخر"]
  ]);

  function ensureWorkflowUi() {
    if (!document.getElementById("iaqarWorkflowStyles")) {
      document.head.insertAdjacentHTML("beforeend", `<style id="iaqarWorkflowStyles">
      .iaqar-workflow-overlay[hidden]{display:none!important}.iaqar-workflow-overlay{position:fixed;inset:0;z-index:2000;background:rgba(8,36,31,.55);display:flex;align-items:flex-end;justify-content:center;padding:12px;box-sizing:border-box;direction:rtl}
      .iaqar-workflow-panel{width:min(100%,560px);max-height:92svh;overflow:auto;background:#fff;border-radius:24px 24px 18px 18px;box-shadow:0 24px 70px rgba(0,0,0,.24);font-family:Tajawal,Arial,sans-serif;color:#173d35}
      .iaqar-workflow-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:17px 18px;background:#fff;border-bottom:1px solid #e2ece8}.iaqar-workflow-head h2,.iaqar-workflow-head h3{margin:0;color:#087064;font-size:21px;font-weight:700}.iaqar-workflow-head--opp-details{display:grid;grid-template-columns:38px minmax(0,1fr) 38px;align-items:center;gap:8px;background:#087064;color:#fff;border-bottom:0;padding:12px 14px}.iaqar-workflow-head--opp-details h2,.iaqar-workflow-head--opp-details h3{color:#fff;text-align:center;font-size:17px;font-weight:800;margin:0}.iaqar-workflow-head--opp-details .iaqar-workflow-close{background:rgba(255,255,255,.14);color:#fff}.iaqar-workflow-head:not(.iaqar-workflow-head--opp-details) .opp-details-head-balance{display:none}.iaqar-workflow-close{width:38px;height:38px;border:0;border-radius:12px;background:#edf6f3;color:#087064;font-size:25px;cursor:pointer;line-height:1}
      .iaqar-workflow-body{padding:16px}.iaqar-workflow-summary{background:#f4f8f6;border:1px solid #dce8e4;border-radius:16px;padding:12px;margin-bottom:12px;font-size:14px;line-height:1.8}.iaqar-workflow-steps{display:grid;gap:10px}.iaqar-workflow-step{border:1px solid #dce8e4;border-radius:18px;padding:14px}.iaqar-workflow-step.is-done{border-color:#9fd1c5;background:#f1faf7}.iaqar-workflow-step h3,.iaqar-workflow-step h4{margin:0 0 5px;font-size:17px;color:#0a695d;font-weight:700}.iaqar-workflow-step p{margin:0 0 10px;color:#657b74;font-size:13px;line-height:1.6}
      .iaqar-workflow-actions,.iaqar-whatsapp-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:10px}.iaqar-workflow-btn{min-height:52px;border:0;border-radius:14px;padding:10px 12px;font:700 15px Tajawal;cursor:pointer;background:#087064;color:#fff}.iaqar-workflow-btn.secondary{background:#edf7f4;color:#087064;border:1px solid #b9ddd4}.iaqar-workflow-btn.danger{background:#fff1f1;color:#a33a3a;border:1px solid #efc4c4}.iaqar-workflow-btn.success{background:#087064;color:#fff}.iaqar-workflow-btn.whatsapp{background:#087064;color:#fff}.iaqar-workflow-btn.call{background:#edf7f4;color:#087064;border:1px solid #b9ddd4}.iaqar-outcome-actions{grid-template-columns:1fr 1fr}.iaqar-outcome-actions .iaqar-workflow-btn.secondary.is-selected{background:#087064;color:#fff;border-color:#087064;box-shadow:0 0 0 2px #fff,0 0 0 4px #087064}.iaqar-outcome-actions .iaqar-workflow-btn.secondary.is-selected::after{content:" ✓";font-size:13px}.iaqar-workflow-btn:disabled{opacity:.48;cursor:not-allowed}
      .iaqar-workflow-form{display:grid;gap:11px}.iaqar-workflow-form label{display:grid;gap:5px;font-size:13px;font-weight:700;color:#36574f}.iaqar-workflow-form input,.iaqar-workflow-form select,.iaqar-workflow-form textarea{width:100%;box-sizing:border-box;border:1px solid #d4e3de;border-radius:14px;padding:12px;font:500 15px Tajawal;background:#fff;color:#173d35;min-height:48px}.iaqar-workflow-form textarea{min-height:82px;resize:vertical}.iaqar-workflow-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.iaqar-workflow-form-grid label,.iaqar-workflow-step label{display:grid;gap:5px;font-size:13px;font-weight:700;color:#36574f}.iaqar-workflow-form-grid .full{grid-column:1/-1}.iaqar-workflow-step input:not([type=checkbox]):not([type=radio]),.iaqar-workflow-step select,.iaqar-workflow-step textarea,.iaqar-workflow-form-grid input,.iaqar-workflow-form-grid select,.iaqar-workflow-form-grid textarea{width:100%;box-sizing:border-box;border:1px solid #d4e3de;border-radius:14px;padding:12px;font:500 15px Tajawal;background:#fff;color:#173d35;min-height:48px}.iaqar-workflow-form select,.iaqar-workflow-step select,.iaqar-workflow-form-grid select{appearance:none;-webkit-appearance:none;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23087064' d='M1 1l5 5 5-5'/%3E%3C/svg%3E") no-repeat left 14px center;padding-left:36px}.iaqar-workflow-step textarea,.iaqar-workflow-form-grid textarea{min-height:82px;resize:vertical}.iaqar-workflow-form input:focus,.iaqar-workflow-form select:focus,.iaqar-workflow-form textarea:focus,.iaqar-workflow-step input:focus,.iaqar-workflow-step select:focus,.iaqar-workflow-step textarea:focus,.iaqar-workflow-form-grid input:focus,.iaqar-workflow-form-grid select:focus,.iaqar-workflow-form-grid textarea:focus{outline:none;border-color:#9fd1c5;box-shadow:0 0 0 3px rgba(8,112,100,.1)}.iaqar-checks{display:grid;gap:8px;background:#f7faf9;border-radius:14px;padding:12px}.iaqar-checks label{display:flex;align-items:center;gap:8px}.iaqar-workflow-note{font-size:12px;color:#70817c;line-height:1.6}.iaqar-workflow-result{padding:18px;border-radius:17px;text-align:center;font-weight:800}.iaqar-workflow-result.success{background:#eaf8f3;color:#087064}.iaqar-workflow-result.closed{background:#fff1f1;color:#9c3c3c}.iaqar-internal-details{margin-top:12px;border:1px solid #e1ebe7;border-radius:15px;padding:10px}.iaqar-internal-details summary{cursor:pointer;font-weight:700;color:#54716a}.iaqar-viewing-alert{color:#a33a3a;font-size:13px;font-weight:700;margin:0 0 8px}
      @media(min-width:700px){.iaqar-workflow-overlay{align-items:center}.iaqar-workflow-panel{border-radius:24px}}@media(max-width:420px){.iaqar-workflow-actions,.iaqar-whatsapp-grid,.iaqar-workflow-form-grid{grid-template-columns:1fr}}
    </style>`);
    }
    if (document.getElementById("iaqarWorkflowOverlay")) return;
    document.body.insertAdjacentHTML("beforeend", `<div class="iaqar-workflow-overlay" id="iaqarWorkflowOverlay" hidden>
      <section class="iaqar-workflow-panel" role="dialog" aria-modal="true" aria-labelledby="iaqarWorkflowTitle">
        <header class="iaqar-workflow-head"><button class="iaqar-workflow-close" type="button" data-ui-action="close-overlay" aria-label="إغلاق">×</button><h2 id="iaqarWorkflowTitle">تفاصيل الفرصة</h2><span class="opp-details-head-balance" aria-hidden="true"></span></header>
        <div class="iaqar-workflow-body" id="iaqarWorkflowBody"></div>
      </section></div>`);
    const overlay = document.getElementById("iaqarWorkflowOverlay");
    overlay.addEventListener("click", event => {
      if (event.target === overlay) closeWorkflowUi();
    });
    overlay.addEventListener("change", event => {
      if (event.target.id === "iaqarCloseReason") {
        const note = document.getElementById("iaqarCloseOtherNote");
        if (note) note.hidden = event.target.value !== "other";
      }
    });
    overlay.addEventListener("click", handleWorkflowUiClick);
  }

  function syncWorkflowOverlayHead(mode = "opportunity") {
    const overlay = document.getElementById("iaqarWorkflowOverlay");
    const head = overlay?.querySelector(".iaqar-workflow-head");
    const title = document.getElementById("iaqarWorkflowTitle");
    const close = head?.querySelector(".iaqar-workflow-close");
    if (!head) return;
    const isOppDetails = mode === "opportunity";
    head.classList.toggle("iaqar-workflow-head--opp-details", isOppDetails);
    if (title) {
      title.textContent = isOppDetails
        ? "تفاصيل الفرصة"
        : (mode === "deal" ? "إدارة الصفقة" : "إدارة الفرصة");
    }
    if (close) {
      close.setAttribute("aria-label", isOppDetails ? "رجوع" : "إغلاق");
      close.textContent = isOppDetails ? "‹" : "×";
    }
  }

  function workflowBody() {
    return document.getElementById("iaqarWorkflowBody");
  }

  function closeWorkflowUi() {
    const overlay = document.getElementById("iaqarWorkflowOverlay");
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    activeWorkflowDetail = null;
    if (window.history?.state?.iaqarOverlay) {
      window.history.replaceState(null, "", location.href);
    }
    window.dispatchEvent(new CustomEvent("iaqar:workflow-overlay-closed"));
    window.IAQAR?.navigation?.updateBackButton?.();
    window.dispatchEvent(new CustomEvent("iaqar:navigation-changed"));
  }

  function hideWorkflowOverlay() {
    const overlay = document.getElementById("iaqarWorkflowOverlay");
    if (overlay) overlay.hidden = true;
    activeWorkflowDetail = null;
  }

  function setUiBusy(button, busy, text = "جارٍ التنفيذ...") {
    if (!button) return;
    if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? text : button.dataset.originalText;
  }

  async function openWorkflowUi(detail) {
    ensureWorkflowUi();
    activeWorkflowDetail = { ...detail };
    lifecycleContactAttempted = Boolean(
      detail.lastWhatsAppOpenedAt || detail.lastCallOpenedAt || detail.lastContactAt
    );
    const overlay = document.getElementById("iaqarWorkflowOverlay");
    overlay.hidden = false;
    if (["intake", "opportunity"].includes(detail.recordType)) {
      activeWorkflowContacts = {
        owner: detail.kind === "owner" || detail.contactType === "owner" ? { name: detail.contactName, phone: detail.contactPhone } : null,
        client: detail.kind === "owner" || detail.contactType === "owner" ? null : { name: detail.contactName, phone: detail.contactPhone }
      };
      renderOpportunityLifecycleUi();
      window.dispatchEvent(new CustomEvent("iaqar:nav-open", { detail: { view: "iaqarWorkflowOverlay" } }));
      return;
    }
    workflowBody().innerHTML = `<div class="iaqar-workflow-summary">جارٍ تحميل بيانات العميل والمالك...</div>`;
    window.dispatchEvent(new CustomEvent("iaqar:nav-open", { detail: { view: "iaqarWorkflowOverlay" } }));
    const [owner, client] = await Promise.all([
      workflowContact(activeWorkflowDetail, "owner").catch(() => null),
      workflowContact(activeWorkflowDetail, "client").catch(() => null)
    ]);
    activeWorkflowContacts = { owner, client };
    renderWorkflowUi();
  }

  function contactButtonLabel(role) {
    const contact = activeWorkflowContacts[role];
    const label = role === "owner" ? "المالك" : "العميل";
    return contact && contact.name ? `واتساب ${label}: ${contact.name}` : `واتساب ${label}`;
  }

  function renderWorkflowUi() {
    const detail = activeWorkflowDetail;
    if (!detail) return;
    if (["intake", "opportunity"].includes(detail.recordType)) {
      syncWorkflowOverlayHead("opportunity");
      return renderOpportunityLifecycleUi();
    }
    const body = workflowBody();
    const isMatch = detail.recordType === "match";
    const isCompleted = detail.status === "completed" || (detail.recordType === "deal" && detail.status === "closed");
    const isClosed = detail.status === "closed" || detail.status === "lost";
    const hasAppointment = Boolean(appointmentValue(detail));
    syncWorkflowOverlayHead(isMatch ? "match" : "deal");

    const summary = `<div class="iaqar-workflow-summary"><strong>${escapeUi(detail.propertyType || "عقار")}</strong>${detail.district ? ` — ${escapeUi(detail.district)}` : ""}<br>العميل: ${escapeUi(activeWorkflowContacts.client?.name || "غير محدد")} — المالك: ${escapeUi(activeWorkflowContacts.owner?.name || "غير محدد")}</div>`;

    if (isCompleted) {
      body.innerHTML = `${summary}<div class="iaqar-workflow-result success">صفقة مكتملة ✓</div>
        <div class="iaqar-whatsapp-grid"><button class="iaqar-workflow-btn whatsapp" data-ui-action="whatsapp-client">${escapeUi(contactButtonLabel("client"))}</button><button class="iaqar-workflow-btn whatsapp" data-ui-action="whatsapp-owner">${escapeUi(contactButtonLabel("owner"))}</button></div>`;
      return;
    }
    if (isClosed) {
      body.innerHTML = `${summary}<div class="iaqar-workflow-result closed">تم إغلاق ${isMatch ? "الفرصة" : "الصفقة"}<br><small>${escapeUi(detail.closeReason || detail.lostReason || "تم حفظ سبب الإغلاق في السجل")}</small></div>`;
      return;
    }

    if (!isMatch) {
      body.innerHTML = `${summary}${negotiationPanelHtml(detail)}<div class="iaqar-workflow-step"><h3>إنهاء الصفقة</h3><p>يمكن إتمام الصفقة مباشرة، أو إيقافها مع حفظ السبب.</p><div class="iaqar-workflow-actions"><button class="iaqar-workflow-btn success" data-ui-action="complete">تمت الصفقة</button><button class="iaqar-workflow-btn danger" data-ui-action="open-close">لم تتم الصفقة</button></div></div>
        <div class="iaqar-whatsapp-grid"><button class="iaqar-workflow-btn whatsapp" data-ui-action="whatsapp-client">${escapeUi(contactButtonLabel("client"))}</button><button class="iaqar-workflow-btn whatsapp" data-ui-action="whatsapp-owner">${escapeUi(contactButtonLabel("owner"))}</button></div>${internalDealFields()}`;
      return;
    }

    const viewingParts = viewingDateTimePartsUi(appointmentValue(detail));
    body.innerHTML = `${summary}<div class="iaqar-workflow-steps">
      <article class="iaqar-workflow-step ${hasAppointment ? "is-done" : ""}"><h3>تحديد المعاينة</h3>${hasAppointment ? `<p>التاريخ: ${escapeUi(viewingParts.date)}</p><p>الوقت: ${escapeUi(viewingParts.time)}</p>` : "<p>اختر التاريخ والوقت ثم احفظ الموعد.</p>"}<button class="iaqar-workflow-btn secondary" data-ui-action="open-schedule">${hasAppointment ? "تغيير الموعد" : "تحديد المعاينة"}</button></article>
      ${hasAppointment ? `<article class="iaqar-workflow-step"><h3>إرسال الموعد</h3><div class="iaqar-whatsapp-grid"><button class="iaqar-workflow-btn whatsapp" type="button" data-ui-action="send-viewing-client">إرسال الموعد للعميل</button><button class="iaqar-workflow-btn whatsapp" type="button" data-ui-action="send-viewing-owner">إرسال الموعد للمالك</button></div></article>` : ""}
      ${viewingConfirmationHtml(detail)}
      ${negotiationPanelHtml(detail)}
      <article class="iaqar-workflow-step"><h3>نتيجة الصفقة</h3><p>${hasAppointment ? "بعد المعاينة سجّل النتيجة." : "يتاح إتمام الصفقة بعد حفظ موعد المعاينة."}</p><div class="iaqar-workflow-actions"><button class="iaqar-workflow-btn success" data-ui-action="complete" ${hasAppointment ? "" : "disabled"}>تمت الصفقة</button><button class="iaqar-workflow-btn danger" data-ui-action="open-close">لم تتم الصفقة</button></div></article>
    </div>
    <div class="iaqar-workflow-actions"><button class="iaqar-workflow-btn secondary" data-ui-action="open-request">طلب الصور أو الموقع أو رابط العقار</button></div>${internalDealFields()}`;
  }

  function internalDealFields() {
    return `<details class="iaqar-internal-details"><summary>بيانات داخلية اختيارية</summary><div class="iaqar-workflow-form" style="margin-top:10px"><label>السعر النهائي<input id="iaqarFinalPrice" inputmode="decimal" placeholder="اختياري"></label><label>العمولة<input id="iaqarCommission" inputmode="decimal" placeholder="اختياري"></label><label>ملاحظة داخلية<textarea id="iaqarInternalNote" placeholder="لا تظهر للعميل أو المالك"></textarea></label></div></details>`;
  }

  function negotiationPanelHtml(detail) {
    const domain = BUX();
    if (!domain?.buildNegotiationPanelView) return "";
    const panel = domain.buildNegotiationPanelView(detail);
    return `<article class="iaqar-workflow-step"><h3>التفاوض</h3>
      <div class="iaqar-workflow-form iaqar-workflow-form-grid">
        <label>سعر المالك<input id="iaqarOwnerPrice" inputmode="numeric" value="${escapeUi(panel.ownerPrice || "")}" placeholder="ريال"></label>
        <label>سعر العميل<input id="iaqarClientPrice" inputmode="numeric" value="${escapeUi(panel.clientPrice || "")}" placeholder="ريال"></label>
        <label class="full">آخر عرض<input id="iaqarLastOffer" inputmode="numeric" value="${escapeUi(panel.lastOffer || "")}" placeholder="ريال"></label>
        <label>حالة التفاوض<select id="iaqarNegotiationStatus">
          <option value="in_progress"${panel.negotiationStatus === "in_progress" ? " selected" : ""}>جاري</option>
          <option value="agreed"${panel.negotiationStatus === "agreed" ? " selected" : ""}>اتفقوا</option>
          <option value="failed"${panel.negotiationStatus === "failed" ? " selected" : ""}>فشل</option>
        </select></label>
        <label class="full">سبب الرفض أو ملاحظة<textarea id="iaqarNegotiationNote" placeholder="اختياري">${escapeUi(panel.negotiationNote || "")}</textarea></label>
      </div>
      <button class="iaqar-workflow-btn secondary" type="button" data-ui-action="save-negotiation">حفظ التفاوض</button>
    </article>`;
  }

  function viewingConfirmationHtml(detail) {
    const domain = BUX();
    if (!domain?.buildViewingConfirmationView || !appointmentValue(detail)) return "";
    const view = domain.buildViewingConfirmationView(detail);
    return `<article class="iaqar-workflow-step${view.bothConfirmed ? " is-done" : ""}"><h3>تأكيد المعاينة</h3>
      ${view.needsAlert ? `<p class="iaqar-viewing-alert">${escapeUi(view.alertLine)}</p>` : ""}
      <div class="iaqar-workflow-actions">
        <button class="iaqar-workflow-btn ${view.clientViewingConfirmed ? "success" : "secondary"}" type="button" data-ui-action="confirm-viewing" data-party="client">${view.clientViewingConfirmed ? "✓ العميل أكد" : "عميل أكد"}</button>
        <button class="iaqar-workflow-btn ${view.ownerViewingConfirmed ? "success" : "secondary"}" type="button" data-ui-action="confirm-viewing" data-party="owner">${view.ownerViewingConfirmed ? "✓ المالك أكد" : "مالك أكد"}</button>
      </div>
    </article>`;
  }

  async function persistBrokerUx(recordType, recordId, patch) {
    const runtime = office();
    const domain = BUX();
    if (!runtime?.refs || !runtime.officeId || !domain?.mergeBrokerUx) {
      throw new Error("تعذر حفظ بيانات التفاوض");
    }
    const collection = recordType === "deal" ? runtime.refs.deals : runtime.refs.matches;
    const snapshot = await collection.doc(recordId).get();
    const current = snapshot.exists ? snapshot.data() : {};
    const brokerUx = domain.mergeBrokerUx(current, patch);
    await collection.doc(recordId).set({
      officeId: runtime.officeId,
      brokerUx,
      updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return brokerUx;
  }

  function showScheduleForm() {
    const detail = activeWorkflowDetail;
    const currentValue = toDate(appointmentValue(detail)) || new Date(Date.now() + 24 * 3600000);
    const local = localDateTimeValue(currentValue);
    const [date, time] = local.split("T");
    workflowBody().innerHTML = `<form class="iaqar-workflow-form" id="iaqarScheduleForm"><h3>${appointmentValue(detail) ? "تغيير موعد المعاينة" : "تحديد موعد المعاينة"}</h3><div class="iaqar-workflow-form-grid"><label>التاريخ<input id="iaqarAppointmentDate" type="date" value="${escapeUi(date)}" required></label><label>الوقت<input id="iaqarAppointmentTime" type="time" value="${escapeUi(time)}" required></label></div><label>ملاحظة اختيارية<textarea id="iaqarAppointmentNote" placeholder="مثال: التواصل قبل الموعد بنصف ساعة"></textarea></label><div class="iaqar-workflow-actions"><button class="iaqar-workflow-btn success" type="button" data-ui-action="save-schedule">حفظ الموعد</button><button class="iaqar-workflow-btn secondary" type="button" data-ui-action="back">رجوع</button></div></form>`;
  }

  function showCloseForm() {
    workflowBody().innerHTML = `<form class="iaqar-workflow-form"><h3>إغلاق ${activeWorkflowDetail.recordType === "deal" ? "الصفقة" : "الفرصة"}</h3><label>سبب الإغلاق<select id="iaqarCloseReason" required><option value="">اختر السبب</option>${CLOSE_REASONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label><label id="iaqarCloseOtherNote" hidden>اكتب السبب<textarea id="iaqarCloseNote"></textarea></label><div class="iaqar-workflow-actions"><button class="iaqar-workflow-btn danger" type="button" data-ui-action="save-close">تأكيد الإغلاق</button><button class="iaqar-workflow-btn secondary" type="button" data-ui-action="back">رجوع</button></div></form>`;
  }

  function showRequestForm() {
    workflowBody().innerHTML = `<form class="iaqar-workflow-form"><h3>طلب معلومات من المالك</h3><div class="iaqar-checks"><label><input type="checkbox" name="requestItem" value="photos"> صور العقار</label><label><input type="checkbox" name="requestItem" value="location"> موقع العقار</label><label><input type="checkbox" name="requestItem" value="propertyLink"> رابط العقار</label></div><label>ملاحظة اختيارية<textarea id="iaqarRequestNote"></textarea></label><div class="iaqar-workflow-actions"><button class="iaqar-workflow-btn whatsapp" type="button" data-ui-action="send-request">فتح واتساب المالك</button><button class="iaqar-workflow-btn secondary" type="button" data-ui-action="back">رجوع</button></div></form>`;
  }

  async function persistViewingAt(detail, date, note) {
    await persistBrokerUx("match", detail.recordId, {
      clientViewingConfirmed: false,
      ownerViewingConfirmed: false,
      viewingConfirmedAt: null
    }).catch(() => null);
  }

  async function saveNegotiation(button) {
    const detail = activeWorkflowDetail;
    const domain = BUX();
    if (!detail || !domain?.parseBrokerUxPatch) return;
    setUiBusy(button, true, "جارٍ الحفظ...");
    try {
      const patch = domain.parseBrokerUxPatch({
        ownerPrice: document.getElementById("iaqarOwnerPrice")?.value,
        clientPrice: document.getElementById("iaqarClientPrice")?.value,
        lastOffer: document.getElementById("iaqarLastOffer")?.value,
        negotiationStatus: document.getElementById("iaqarNegotiationStatus")?.value,
        negotiationNote: document.getElementById("iaqarNegotiationNote")?.value
      });
      const brokerUx = await persistBrokerUx(detail.recordType, detail.recordId, patch);
      activeWorkflowDetail = { ...detail, brokerUx };
      notify("تم حفظ بيانات التفاوض");
      renderWorkflowUi();
      emitOperations();
    } catch (error) {
      notify(error.message || "تعذر حفظ التفاوض");
    } finally {
      setUiBusy(button, false);
    }
  }

  async function confirmViewingParty(button) {
    const detail = activeWorkflowDetail;
    const party = button.dataset.party;
    if (!detail || !party) return;
    setUiBusy(button, true, "جارٍ الحفظ...");
    try {
      const domain = BUX();
      const current = domain?.mergeBrokerUx ? domain.mergeBrokerUx(detail, {}) : {};
      const nextClient = party === "client" ? !current.clientViewingConfirmed : current.clientViewingConfirmed;
      const nextOwner = party === "owner" ? !current.ownerViewingConfirmed : current.ownerViewingConfirmed;
      const patch = {
        clientViewingConfirmed: nextClient,
        ownerViewingConfirmed: nextOwner,
        viewingConfirmedAt: nextClient && nextOwner ? new Date().toISOString() : null
      };
      const brokerUx = await persistBrokerUx(detail.recordType === "deal" ? "deal" : "match", detail.recordId, patch);
      activeWorkflowDetail = { ...detail, brokerUx };
      notify("تم تحديث تأكيد المعاينة");
      renderWorkflowUi();
      emitOperations();
    } catch (error) {
      notify(error.message || "تعذر حفظ التأكيد");
    } finally {
      setUiBusy(button, false);
    }
  }

  async function saveViewingSchedule(button) {
    const detail = activeWorkflowDetail;
    const dateValue = document.getElementById("iaqarAppointmentDate")?.value || "";
    const timeValue = document.getElementById("iaqarAppointmentTime")?.value || "";
    const note = document.getElementById("iaqarAppointmentNote")?.value.trim() || "";
    const date = new Date(`${dateValue}T${timeValue}`);
    if (!dateValue || !timeValue || Number.isNaN(date.getTime())) return notify("اختر تاريخًا ووقتًا صحيحين");
    setUiBusy(button, true, "جارٍ حفظ الموعد...");
    try {
      const iso = date.toISOString();
      let status = detail.status || "active";
      if (["active", "new", "in_progress"].includes(status)) {
        const first = await workflowAction("advance_match", detail.recordId, { note: "تم التواصل مع الطرفين", nextFollowUpAt: iso });
        status = first.status || "waiting_response";
      }
      if (status === "waiting_response") {
        const second = await workflowAction("advance_match", detail.recordId, { note: note || "تم تحديد موعد المعاينة", nextFollowUpAt: iso });
        status = second.status || "viewing";
      } else {
        await workflowAction("add_match_followup", detail.recordId, { note: note || "تم تحديث موعد المعاينة", nextFollowUpAt: iso });
      }
      await persistViewingAt(detail, date, note);
      activeWorkflowDetail = {
        ...detail,
        status: status === "negotiation" ? "negotiation" : "viewing",
        appointmentAt: iso,
        viewingAt: iso,
        nextFollowUpAt: iso,
        brokerUx: {
          ...(detail.brokerUx || {}),
          clientViewingConfirmed: false,
          ownerViewingConfirmed: false,
          viewingConfirmedAt: null
        }
      };
      notify("تم حفظ موعد المعاينة");
      renderWorkflowUi();
    } catch (error) {
      notify(error.message || "تعذر حفظ الموعد");
    } finally {
      setUiBusy(button, false);
    }
  }

  async function ensureDealForMatch(detail) {
    let status = detail.status || "active";
    let dealId = detail.dealId || "";
    let loops = 0;
    while (!dealId && !["completed", "closed"].includes(status) && loops < 5) {
      const result = await workflowAction("advance_match", detail.recordId, {
        note: "تم التقدم تلقائيًا ضمن مسار إنهاء الصفقة السريع",
        nextFollowUpAt: new Date().toISOString()
      });
      status = result.status || status;
      dealId = result.dealId || dealId;
      loops += 1;
      if (status === "negotiation" && !dealId) {
        const created = await workflowAction("create_deal", detail.recordId, {});
        dealId = created.dealId || "";
      }
    }
    if (!dealId) throw new Error("تعذر إنشاء الصفقة المرتبطة");
    return dealId;
  }

  async function saveInternalDealData(dealId) {
    const runtime = office();
    if (!runtime || !runtime.officeId || !dealId) return;
    const finalPriceRaw = document.getElementById("iaqarFinalPrice")?.value.trim() || "";
    const commissionRaw = document.getElementById("iaqarCommission")?.value.trim() || "";
    const internalNote = document.getElementById("iaqarInternalNote")?.value.trim() || "";
    const payload = {};
    if (finalPriceRaw && Number.isFinite(Number(finalPriceRaw))) payload.finalPrice = Number(finalPriceRaw);
    if (commissionRaw && Number.isFinite(Number(commissionRaw))) payload.commissionActual = Number(commissionRaw);
    if (internalNote) payload.internalNote = internalNote;
    // Phase 8: deals are Worker-writable only — never patch from the client SDK.
    if (Object.keys(payload).length) {
      await workflowAction("update_deal_fields", dealId, payload);
    }
  }

  async function completeFastDeal(button) {
    const detail = activeWorkflowDetail;
    if (detail.recordType === "match" && !appointmentValue(detail)) return notify("حدد موعد المعاينة أولًا");
    setUiBusy(button, true, "جارٍ إتمام الصفقة...");
    try {
      const dealId = detail.recordType === "deal" ? (detail.dealId || detail.recordId) : await ensureDealForMatch(detail);
      await saveInternalDealData(dealId);
      const runtime = office();
      let stage = detail.recordType === "deal" ? detail.workflowStage : "negotiation";
      if (runtime && runtime.refs && runtime.refs.deals) {
        const snapshot = await runtime.refs.deals.doc(dealId).get().catch(() => null);
        if (snapshot && snapshot.exists) stage = snapshot.data().workflowStage || stage;
      }
      const order = ["contact", "viewing", "negotiation", "agreement", "closing", "closed"];
      if (order.indexOf(stage) < order.indexOf("agreement")) {
        await workflowAction("set_deal_stage", dealId, { stage: "agreement", note: "تم تسجيل الاتفاق ضمن مسار الإنهاء السريع" });
      }
      const commissionRaw = document.getElementById("iaqarCommission")?.value.trim() || "";
      const commissionActual = commissionRaw && Number.isFinite(Number(commissionRaw)) ? Number(commissionRaw) : 0;
      const result = await workflowAction("set_deal_stage", dealId, { stage: "closed", note: "تم إتمام الصفقة من المسار السريع", commissionActual });
      activeWorkflowDetail = { ...detail, status: detail.recordType === "deal" ? "closed" : "completed", workflowStage: "closed", dealId };
      notify(result.closedSiblings > 0 ? `تمت الصفقة وأُغلقت ${result.closedSiblings} فرص أخرى مرتبطة` : "تمت الصفقة بنجاح");
      renderWorkflowUi();
    } catch (error) {
      notify(error.message || "تعذر إتمام الصفقة");
    } finally {
      setUiBusy(button, false);
    }
  }

  async function saveCloseReason(button) {
    const detail = activeWorkflowDetail;
    const reasonKey = document.getElementById("iaqarCloseReason")?.value || "";
    const custom = document.getElementById("iaqarCloseNote")?.value.trim() || "";
    const label = CLOSE_REASONS.find(([value]) => value === reasonKey)?.[1] || "";
    if (!reasonKey) return notify("اختر سبب الإغلاق");
    if (reasonKey === "other" && !custom) return notify("اكتب سبب الإغلاق");
    const reason = reasonKey === "other" ? custom : label;
    setUiBusy(button, true, "جارٍ الإغلاق...");
    try {
      if (detail.recordType === "deal") await workflowAction("mark_lost", detail.recordId, { note: reason });
      else await workflowAction("close_match", detail.recordId, { note: reason });
      activeWorkflowDetail = { ...detail, status: detail.recordType === "deal" ? "lost" : "closed", closeReason: reason, lostReason: reason };
      notify("تم إغلاق الفرصة مع حفظ السبب");
      renderWorkflowUi();
    } catch (error) {
      notify(error.message || "تعذر إغلاق الفرصة");
    } finally {
      setUiBusy(button, false);
    }
  }

  async function sendOwnerRequest(button) {
    const items = Array.from(document.querySelectorAll('input[name="requestItem"]:checked')).map(input => input.value);
    const note = document.getElementById("iaqarRequestNote")?.value.trim() || "";
    if (!items.length) return notify("اختر الصور أو الموقع أو رابط العقار");
    const message = ownerRequestWhatsAppTextUi(items, note);
    if (!message) return notify("اختر الصور أو الموقع أو رابط العقار");
    setUiBusy(button, true, "جارٍ تجهيز الرسالة...");
    try {
      const detail = { ...activeWorkflowDetail, recipientRole: "owner", requestedItems: items, requestNote: note };
      if (detail.recordType === "match") {
        await workflowAction("add_match_followup", detail.recordId, {
          note: `تم طلب: ${items.join("، ")}${note ? ` — ${note}` : ""}`,
          nextFollowUpAt: new Date(Date.now() + 24 * 3600000).toISOString()
        });
      }
      const opened = await openPartyWhatsApp(detail, "owner", message);
      if (opened) renderWorkflowUi();
    } catch (error) {
      notify(error.message || "تعذر تجهيز الرسالة");
    } finally {
      setUiBusy(button, false);
    }
  }

  function isLifecycleClosed(detail = {}) {
    const status = detail.lifecycleStatus || (LC().getOpportunityLifecycleStatus ? LC().getOpportunityLifecycleStatus(detail) : "NEW");
    return Boolean(detail.closedAt) || ["CLOSED_WON", "CLOSED_LOST", "ARCHIVED"].includes(status);
  }

  function contactOutcomesVisible(detail = {}) {
    return lifecycleContactAttempted
      || detail.lastWhatsAppOpenedAt
      || detail.lastCallOpenedAt
      || detail.lastContactAt;
  }

  function shouldShowFollowUpSection(detail = {}, lastOutcome = "") {
    if (isLifecycleClosed(detail)) return false;
    const status = detail.lifecycleStatus || "NEW";
    return lastOutcome === "NO_RESPONSE"
      || lastOutcome === "FOLLOW_UP"
      || lastOutcome === "INTERESTED"
      || status === "FOLLOW_UP"
      || Boolean(detail.nextFollowUpAt);
  }

  function shouldShowLifecycleCloseSection(detail = {}, lastOutcome = "") {
    if (isLifecycleClosed(detail)) return false;
    if (lastOutcome === "AGREED") return false;
    return true;
  }

  function shouldShowMatchingSection(detail = {}, lastOutcome = "") {
    if (isLifecycleClosed(detail)) return false;
    if (lastOutcome === "REFUSED") return false;
    if (!contactOutcomesVisible(detail)) return false;
    const readiness = detail.matchingReadiness === "READY" || detail.isReadyForMatching === true;
    const hasFields = Boolean(
      detail.propertyType
      && detail.district
      && (detail.price || detail.priceMax || detail.priceOrBudget || detail.amount)
    );
    const status = detail.lifecycleStatus || "NEW";
    const contactAllows = ["INTERESTED", "AGREED", "CONTACTED", "FOLLOW_UP", "NEGOTIATION", "MATCHED"].includes(status)
      || lastOutcome === "INTERESTED"
      || lastOutcome === "AGREED"
      || lastOutcome === "FOLLOW_UP";
    return (readiness || hasFields) && contactAllows;
  }

  async function reloadActiveOpportunityFromServer() {
    const detail = activeWorkflowDetail;
    if (!detail?.recordId || detail.recordType === "intake") return detail;
    const runtime = office();
    if (!runtime?.db || !runtime.officeId) return detail;
    try {
      const snap = await runtime.db.collection("offices").doc(runtime.officeId)
        .collection("opportunities").doc(detail.recordId).get();
      if (!snap.exists) return detail;
      const data = snap.data() || {};
      activeWorkflowDetail = {
        ...detail,
        ...data,
        recordId: detail.recordId,
        recordType: "opportunity",
        opportunityId: detail.recordId
      };
    } catch (error) {
      console.warn("[iaqar] reload opportunity", error);
    }
    return activeWorkflowDetail;
  }

  async function ensureFollowUpRecipientContext(detail = {}) {
    if (followUpRecipientContext?.detailId === detail.recordId) return followUpRecipientContext;
    const context = await resolveFollowUpRecipientContext(detail);
    followUpRecipientContext = { detailId: detail.recordId, ...context };
    return followUpRecipientContext;
  }

  async function resolveFollowUpRecipientContext(detail = {}) {
    const base = FD()?.resolveRecipientContext?.(detail) || {
      availableModes: [FD()?.defaultRecipientMode?.(detail) || "owner"],
      defaultMode: FD()?.defaultRecipientMode?.(detail) || "owner",
      hasBothParties: false,
      ownerContactId: "",
      clientContactId: ""
    };
    if (base.hasBothParties) return base;
    const enriched = await enrichDetailForMessaging(detail);
    if (enriched.ownerOfferId && enriched.clientRequestId) {
      return FD()?.resolveRecipientContext?.(detail, {
        ownerOfferId: enriched.ownerOfferId,
        clientRequestId: enriched.clientRequestId
      }) || base;
    }
    return base;
  }

  function populateFollowUpInput(detail = {}) {
    const input = document.getElementById("iaqarCustomFollowUp");
    if (!input) return;
    const follow = FD()?.activeFollowUpFromRecord?.(detail);
    const value = follow?.at || detail.nextFollowUpAt || "";
    if (!value) {
      input.value = "";
      return;
    }
    input.value = FD()?.riyadhDateTimeInputValue?.(value) || localDateTimeValue(value);
  }

  function buildFollowUpRecipientOptionsHtml(context = {}, selected = "") {
    const labels = FD()?.RECIPIENT_MODE_LABELS || { owner: "المالك", client: "العميل", both: "المالك والعميل" };
    let modes = Array.isArray(context.availableModes) ? context.availableModes.filter(Boolean) : [];
    const fallback = context.defaultMode || "owner";
    if (!modes.length) modes = [fallback];
    const selectedMode = modes.includes(selected) ? selected : (context.defaultMode || modes[0]);
    return modes.map((mode) =>
      `<option value="${escapeUi(mode)}" ${mode === selectedMode ? "selected" : ""}>${escapeUi(labels[mode] || mode)}</option>`
    ).join("");
  }

  function renderFollowUpAppointmentCard(detail = {}) {
    const follow = FD()?.activeFollowUpFromRecord?.(detail);
    if (!follow || !follow.at) return "";
    const labels = FD()?.RECIPIENT_MODE_LABELS || {};
    const appointmentLine = FD()?.formatFollowUpAppointmentLine?.(follow.at) || dateTimeLabel(follow.at);
    const recipientLabel = labels[follow.recipientMode] || labels.owner || "المالك";
    const overdue = FD()?.isFollowUpOverdue?.(follow);
    return `<article class="iaqar-followup-card" id="iaqarFollowUpCard">
      <h3>الموعد القادم</h3>
      <p class="iaqar-followup-when">${escapeUi(appointmentLine)}${overdue ? " — متأخرة" : ""}</p>
      <p class="iaqar-followup-meta">التذكير: قبل الموعد بـ ٢٤ ساعة ثم قبل ساعة</p>
      <p class="iaqar-followup-meta">التواصل مع: ${escapeUi(recipientLabel)} — أرسل تأكيد الموعد عبر واتساب</p>
      <div class="iaqar-workflow-actions">
        <button type="button" class="iaqar-workflow-btn secondary" data-ui-action="edit-followup">تعديل الموعد</button>
        <button type="button" class="iaqar-workflow-btn secondary" data-ui-action="cancel-followup">إلغاء الموعد</button>
        <button type="button" class="iaqar-workflow-btn success" data-ui-action="complete-followup">تمت المتابعة</button>
      </div>
    </article>`;
  }

  function renderFollowUpConfirmationActions(detail = {}, follow = {}) {
    const modes = [];
    const recipient = String(follow.recipientMode || "");
    if (recipient === "both") modes.push("owner", "client");
    else if (recipient === "owner") modes.push("owner");
    else if (recipient === "client") modes.push("client");
    else modes.push(FD()?.defaultRecipientMode?.(detail) || "owner");
    const buttons = modes.map((role) => {
      const actionKey = BAP().followUpWhatsAppActionKey?.(role) || `followup:whatsapp:${role}`;
      return `<button type="button" class="iaqar-workflow-btn whatsapp${brokerDoneClass(detail, actionKey)}" data-ui-action="followup-whatsapp" data-broker-action="${escapeUi(actionKey)}" data-role="${role}" aria-pressed="${brokerPressed(detail, actionKey)}">واتساب ${role === "owner" ? "المالك" : "العميل"}</button>`;
    }).join("");
    const confirmedKey = BAP().followUpOutcomeActionKey?.("confirmed") || "followup:outcome:confirmed";
    const noResponseKey = BAP().followUpOutcomeActionKey?.("no_response") || "followup:outcome:no_response";
    return `<div class="iaqar-workflow-step" id="iaqarFollowUpConfirmSection">
      <h3>تأكيد الموعد</h3>
      <p class="iaqar-workflow-note">أرسل رسالة واتساب للطرف المختار — الإرسال يدوي ولا يتم تلقائيًا.</p>
      <div class="iaqar-whatsapp-grid">${buttons}</div>
      <div class="iaqar-workflow-actions">
        <button type="button" class="iaqar-workflow-btn success${brokerDoneClass(detail, confirmedKey)}" data-ui-action="followup-outcome" data-broker-action="${confirmedKey}" data-outcome="confirmed" aria-pressed="${brokerPressed(detail, confirmedKey)}">تم التأكيد</button>
        <button type="button" class="iaqar-workflow-btn secondary" data-ui-action="edit-followup">تغيير الموعد</button>
        <button type="button" class="iaqar-workflow-btn secondary${brokerDoneClass(detail, noResponseKey)}" data-ui-action="followup-outcome" data-broker-action="${noResponseKey}" data-outcome="no_response" aria-pressed="${brokerPressed(detail, noResponseKey)}">لم يرد</button>
      </div>
    </div>`;
  }

  function selectWorkflowContactOutcome(outcome = "", { toggle = true } = {}) {
    const key = String(outcome || "").toUpperCase();
    const buttons = workflowBody().querySelectorAll('[data-ui-action="contact-outcome"]');
    const current = workflowBody().querySelector('[data-ui-action="contact-outcome"].is-selected');
    const currentOutcome = String(current?.dataset.outcome || "").toUpperCase();
    let nextOutcome = key;
    if (toggle && key && currentOutcome === key) {
      nextOutcome = "";
    }
    const actionKey = nextOutcome
      ? (BAP().contactOutcomeActionKey?.(nextOutcome) || `contact:outcome:${nextOutcome}`)
      : "";
    buttons.forEach((btn) => {
      const btnOutcome = String(btn.dataset.outcome || "").toUpperCase();
      const active = Boolean(nextOutcome) && btnOutcome === nextOutcome;
      btn.classList.toggle("is-selected", active);
      btn.classList.remove("is-action-done");
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      if (actionKey) btn.setAttribute("data-broker-action", actionKey);
    });
  }

  function buildWorkflowOpportunityDetailsHtml(detail = {}) {
    const builder = window.IAQAR_OPPORTUNITY?.buildOpportunityDetailsCoreHtml;
    if (!builder) return "";
    const oppId = String(detail.recordId || detail.opportunityId || detail.id || "")
      .replace(/^opp-/, "")
      .trim();
    if (!oppId) return "";
    const record = { ...detail, id: oppId };
    const readiness = window.IAQAR_OPPORTUNITY?.evaluateMatchingReadiness
      ? window.IAQAR_OPPORTUNITY.evaluateMatchingReadiness(record)
      : undefined;
    const built = builder(oppId, record, readiness);
    return built?.html || "";
  }

  async function renderOpportunityLifecycleUi() {
    syncWorkflowOverlayHead("opportunity");
    const detail = activeWorkflowDetail;
    const body = workflowBody();
    const lifecycleStatus = detail.lifecycleStatus || (LC().getOpportunityLifecycleStatus ? LC().getOpportunityLifecycleStatus(detail) : "NEW");
    const lifecycleLabel = (LC().LIFECYCLE_STATUS_LABELS && LC().LIFECYCLE_STATUS_LABELS[lifecycleStatus]) || lifecycleStatus;
    const summaryText = LC().buildOpportunitySummary ? LC().buildOpportunitySummary(detail) : "";
    const phoneInfo = resolveLifecyclePhone(detail);
    const closed = isLifecycleClosed(detail);
    const outcomesVisible = contactOutcomesVisible(detail);
    const lastOutcome = String(detail.lastContactOutcome || detail.advertiserContactStatus || "").toUpperCase();
    const showFollowUp = shouldShowFollowUpSection(detail, lastOutcome);
    const showMatching = shouldShowMatchingSection(detail, lastOutcome);
    const showLifecycleClose = shouldShowLifecycleCloseSection(detail, lastOutcome);
    const activeFollowUp = FD()?.activeFollowUpFromRecord?.(detail);
    const recipientContext = showFollowUp ? await ensureFollowUpRecipientContext(detail) : null;
    const selectedRecipient = activeFollowUp?.recipientMode || recipientContext?.defaultMode || "owner";
    const detailsHtml = buildWorkflowOpportunityDetailsHtml(detail);
    const outcomeLabels = LC().CONTACT_OUTCOME_LABELS || {
      NO_RESPONSE: "لم يرد",
      INTERESTED: "مهتم",
      REFUSED: "غير مهتم",
      FOLLOW_UP: "طلب متابعة",
      AGREED: "تم الاتفاق"
    };
    const outcomeButtons = Object.entries(outcomeLabels).map(([value, label]) => {
      const actionKey = BAP().contactOutcomeActionKey?.(value) || `contact:outcome:${value}`;
      const selected = lastOutcome === value;
      return `<button type="button" class="iaqar-workflow-btn secondary iaqar-contact-outcome-btn${selected ? " is-selected is-action-done" : ""}" data-ui-action="contact-outcome" data-broker-action="${actionKey}" data-outcome="${value}" aria-pressed="${selected ? "true" : "false"}" ${closed ? "disabled" : ""}>${escapeUi(label)}</button>`;
    }).join("");

    let html = detailsHtml
      ? `<div class="iaqar-workflow-details">${detailsHtml}</div>`
      : `<div class="iaqar-workflow-summary"><strong>${escapeUi(detail.contactName || detail.advertiserDisplayName || "جهة التواصل")}</strong><br>${escapeUi(summaryText)}<br>الحالة: ${escapeUi(lifecycleLabel)}</div>`;

    if (!closed) {
      html += `<div class="iaqar-workflow-step"><h3>التواصل</h3><p>تواصل عبر واتساب أو اتصال ثم سجّل نتيجة التواصل.</p>
        <div class="iaqar-workflow-actions">
          <button type="button" class="iaqar-workflow-btn whatsapp${brokerDoneClass(detail, BAP().BROKER_ACTION?.contactWhatsApp || "contact:whatsapp")}" data-ui-action="whatsapp-contact" data-broker-action="${BAP().BROKER_ACTION?.contactWhatsApp || "contact:whatsapp"}" aria-pressed="${brokerPressed(detail, BAP().BROKER_ACTION?.contactWhatsApp || "contact:whatsapp")}" ${phoneInfo.valid ? "" : "disabled"}>واتساب</button>
          <button type="button" class="iaqar-workflow-btn call${brokerDoneClass(detail, BAP().BROKER_ACTION?.contactCall || "contact:call")}" data-ui-action="call-contact" data-broker-action="${BAP().BROKER_ACTION?.contactCall || "contact:call"}" aria-pressed="${brokerPressed(detail, BAP().BROKER_ACTION?.contactCall || "contact:call")}" ${phoneInfo.valid ? "" : "disabled"}>اتصال</button>
        </div>
        ${phoneInfo.valid ? "" : `<p class="iaqar-workflow-note">${escapeUi(phoneInfo.error || "رقم الجوال غير مكتمل")}</p>`}
      </div>`;
      html += `<div class="iaqar-workflow-step"><h3>نتيجة التواصل</h3>
        ${outcomesVisible
          ? `<div class="iaqar-workflow-actions iaqar-outcome-actions">${outcomeButtons}</div>`
          : `<p class="iaqar-workflow-note">بعد واتساب أو اتصال اختر نتيجة التواصل.</p>`}
      </div>`;
      if (showFollowUp) {
        html += `<div class="iaqar-workflow-step" id="iaqarNextActionSection"><h3>الإجراء القادم</h3>`;
        if (activeFollowUp && !followUpEditMode) {
          html += renderFollowUpAppointmentCard(detail);
          if (detail.focusFollowUpReminder || detail.showFollowUpConfirmation) {
            html += renderFollowUpConfirmationActions(detail, activeFollowUp);
          }
        }
        if (!activeFollowUp || followUpEditMode) {
          html += `<div class="iaqar-workflow-actions">
            <button type="button" class="iaqar-workflow-btn secondary" data-ui-action="pick-followup-day" data-days="0">اليوم</button>
            <button type="button" class="iaqar-workflow-btn secondary" data-ui-action="pick-followup-day" data-days="1">غدًا</button>
            <button type="button" class="iaqar-workflow-btn secondary" data-ui-action="pick-followup-day" data-days="2">بعد غد</button>
          </div>
          <label class="iaqar-workflow-form" style="margin-top:10px;display:grid;gap:6px">تاريخ ووقت المتابعة
            <input id="iaqarCustomFollowUp" type="datetime-local">
          </label>
          <label class="iaqar-workflow-form" style="display:grid;gap:6px">التأكيد مع
            <select id="iaqarFollowUpRecipient">${buildFollowUpRecipientOptionsHtml(recipientContext, selectedRecipient)}</select>
          </label>
          <div class="iaqar-workflow-actions">
            <button type="button" class="iaqar-workflow-btn success" data-ui-action="save-followup-custom">حفظ موعد المتابعة</button>
          </div>`;
        }
        html += `</div>`;
      }
      if (showMatching) {
        const coopLabel = lastOutcome === "AGREED"
          ? "إتمام الصفقة من المطابقة"
          : (String(detail.cooperationListing || "").toUpperCase() === "OPEN"
            ? "المطابقة والتعاون"
            : "فتح المطابقة والتعاون");
        const matchingHint = lastOutcome === "AGREED"
          ? "تم تسجيل الاتفاق — أكمل الصفقة من المطابقة ثم سجّل النتيجة."
          : "استخدم العروض والطلبات لإدارة المطابقة والتعاون.";
        html += `<div class="iaqar-workflow-step"><h3>${lastOutcome === "AGREED" ? "إتمام الصفقة" : "المطابقة والتعاون"}</h3>
          <p>${escapeUi(matchingHint)}</p>
          <div class="iaqar-workflow-actions">
            <button type="button" class="iaqar-workflow-btn ${lastOutcome === "AGREED" ? "success" : "secondary"}" data-ui-action="open-matching-bank">${escapeUi(coopLabel)}</button>
          </div>
        </div>`;
      }
      if (showLifecycleClose) {
        const closeHint = lastOutcome === "REFUSED"
          ? "تم تسجيل عدم الاهتمام — أكمل إنهاء الفرصة مع السبب."
          : "استخدم هذا الإجراء فقط عند انتهاء متابعة الفرصة.";
        html += `<div class="iaqar-workflow-step" id="iaqarLifecycleCloseSection"><h3>إنهاء الفرصة</h3>
          <p class="iaqar-workflow-note">${escapeUi(closeHint)}</p>
          <div class="iaqar-workflow-actions">
            <button type="button" class="iaqar-workflow-btn ${lastOutcome === "REFUSED" ? "success" : "secondary"}" data-ui-action="open-lifecycle-close">إنهاء الفرصة</button>
          </div>
        </div>`;
      }
    } else {
      html += `<div class="iaqar-workflow-result closed">الفرصة مؤرشفة / منتهية<br><small>${escapeUi(detail.closureReason || lifecycleLabel)}</small></div>`;
    }
    body.innerHTML = html;
    populateFollowUpInput(detail);
    applyWorkflowBrokerMarks(detail);
    if (detail.focusFollowUpReminder) {
      const card = document.getElementById("iaqarFollowUpCard");
      if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function showLifecycleCloseForm(prefill = {}) {
    const reasons = (LC().OPPORTUNITY_FINAL_CLOSE_REASONS || []).map(([value, label]) =>
      `<option value="${value}">${label}</option>`
    ).join("");
    const outcomes = (LC().OPPORTUNITY_FINAL_OUTCOMES || []).map(([value, label]) =>
      `<option value="${value}">${label}</option>`
    ).join("");
    const prefillReason = String(prefill.reasonKey || activeWorkflowDetail?.prefillCloseReasonKey || "").trim();
    const prefillNote = String(prefill.closureNote || activeWorkflowDetail?.prefillCloseNote || "").trim();
    workflowBody().innerHTML = `<form class="iaqar-workflow-form" id="iaqarCloseForm"><h3>إنهاء الفرصة</h3>
      <label>السبب النهائي<select id="iaqarCloseReasonKey" required><option value="">اختر السبب</option>${reasons}</select></label>
      <div id="iaqarFinalOutcomeWrap" hidden>
        <label>نتيجة الصفقة<select id="iaqarFinalOutcome"><option value="">اختر النتيجة</option>${outcomes}</select></label>
        <label>ملاحظة نهائية (اختياري)<textarea id="iaqarCloseNote" placeholder="ملاحظة اختيارية"></textarea></label>
      </div>
      <div class="iaqar-workflow-actions">
        <button type="button" class="iaqar-workflow-btn success" data-ui-action="confirm-final-close">تأكيد إنهاء الفرصة</button>
        <button type="button" class="iaqar-workflow-btn secondary" data-ui-action="back">رجوع</button>
      </div>
    </form>`;
    const reasonSelect = document.getElementById("iaqarCloseReasonKey");
    const outcomeWrap = document.getElementById("iaqarFinalOutcomeWrap");
    reasonSelect?.addEventListener("change", () => {
      if (outcomeWrap) outcomeWrap.hidden = reasonSelect.value !== "deal_done";
    });
    if (prefillReason && reasonSelect) {
      reasonSelect.value = prefillReason;
      reasonSelect.dispatchEvent(new Event("change"));
    }
    if (prefillNote) {
      const noteInput = document.getElementById("iaqarCloseNote");
      if (noteInput) noteInput.value = prefillNote;
    }
  }

  async function recordContactOutcomeAction(button, outcome) {
    if (!outcome) return;
    const previousOutcome = String(
      activeWorkflowDetail.lastContactOutcome || activeWorkflowDetail.advertiserContactStatus || ""
    ).toUpperCase();
    selectWorkflowContactOutcome(outcome);
    setUiBusy(button, true);
    try {
      const payload = await opportunityLifecycleAction("contact_outcome", activeWorkflowDetail, { contactOutcome: outcome });
      syncWorkflowDetailFromLifecyclePayload(payload, BAP().contactOutcomeActionKey?.(outcome) || `contact:outcome:${outcome}`);
      activeWorkflowDetail = {
        ...activeWorkflowDetail,
        lastContactOutcome: outcome,
        lifecycleStatus: payload.lifecycleStatus || activeWorkflowDetail.lifecycleStatus,
        advertiserContactStatus: payload.advertiserContactStatus || outcome
      };
      notify("تم تسجيل نتيجة التواصل");
      if (outcome === "REFUSED") {
        await renderOpportunityLifecycleUi();
        document.getElementById("iaqarLifecycleCloseSection")?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (outcome === "AGREED") {
        await renderOpportunityLifecycleUi();
        notify("الخطوة التالية: إتمام الصفقة من المطابقة");
      } else {
        renderOpportunityLifecycleUi();
      }
    } catch (error) {
      selectWorkflowContactOutcome(previousOutcome);
      notify(error.message || "تعذر تسجيل نتيجة التواصل");
    } finally {
      setUiBusy(button, false);
    }
  }

  function pickFollowUpDay(daysValue) {
    const days = Number(daysValue || 0);
    const input = document.getElementById("iaqarCustomFollowUp");
    if (!input) return;
    const base = new Date();
    base.setDate(base.getDate() + days);
    const pad = (value) => String(value).padStart(2, "0");
    const datePart = `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
    const existingTime = String(input.value || "").includes("T") ? input.value.split("T")[1] : "10:00";
    input.value = `${datePart}T${existingTime}`;
  }

  async function saveFollowUpAction(button) {
    const custom = document.getElementById("iaqarCustomFollowUp")?.value || "";
    if (!custom) return notify("اختر موعد المتابعة");
    const parsed = FD()?.parseRiyadhDateTimeInput?.(custom) || new Date(custom);
    const recipientMode = document.getElementById("iaqarFollowUpRecipient")?.value || "";
    const todayCheck = FD()?.validateTodayRequiresFutureTime?.(parsed);
    if (todayCheck && !todayCheck.ok) return notify(todayCheck.message);
    setUiBusy(button, true);
    try {
      const payload = await opportunityLifecycleAction("set_followup", activeWorkflowDetail, {
        nextFollowUpAt: parsed.toISOString(),
        recipientMode
      });
      await reloadActiveOpportunityFromServer();
      syncWorkflowDetailFromLifecyclePayload(payload, BAP().BROKER_ACTION?.followUpScheduled || "followup:scheduled");
      if (payload.followUp) activeWorkflowDetail.followUp = payload.followUp;
      activeWorkflowDetail.nextFollowUpAt = payload.nextFollowUpAt || parsed.toISOString();
      activeWorkflowDetail.lifecycleStatus = payload.lifecycleStatus || "FOLLOW_UP";
      activeWorkflowDetail.showFollowUpConfirmation = true;
      followUpEditMode = false;
      notify("تم حفظ موعد المتابعة — أرسل تأكيدًا عبر واتساب. ستصلك تذكيرات قبل الموعد بـ ٢٤ ساعة وساعة.");
      await renderOpportunityLifecycleUi();
      document.getElementById("iaqarFollowUpConfirmSection")?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
      notify(error.message || "تعذر حفظ المتابعة");
    } finally {
      setUiBusy(button, false);
    }
  }

  async function cancelFollowUpAction(button) {
    if (!confirm("إلغاء موعد المتابعة؟")) return;
    setUiBusy(button, true);
    try {
      await opportunityLifecycleAction("cancel_followup", activeWorkflowDetail, {});
      await reloadActiveOpportunityFromServer();
      followUpEditMode = false;
      notify("تم إلغاء موعد المتابعة");
      await renderOpportunityLifecycleUi();
    } catch (error) {
      notify(error.message || "تعذر إلغاء الموعد");
    } finally {
      setUiBusy(button, false);
    }
  }

  async function completeFollowUpAction(button) {
    setUiBusy(button, true);
    try {
      const payload = await opportunityLifecycleAction("complete_followup", activeWorkflowDetail, {});
      syncWorkflowDetailFromLifecyclePayload(
        payload,
        BAP().BROKER_ACTION?.followUpComplete || "followup:complete"
      );
      followUpEditMode = false;
      notify("تم تسجيل نتيجة التواصل");
      await renderOpportunityLifecycleUi();
    } catch (error) {
      notify(error.message || "تعذر إتمام المتابعة");
    } finally {
      setUiBusy(button, false);
    }
  }

  async function recordFollowUpOutcome(button, outcome) {
    if (!outcome) return;
    setUiBusy(button, true);
    try {
      const payload = await opportunityLifecycleAction("followup_outcome", activeWorkflowDetail, { outcome });
      const outcomeKey = BAP().followUpOutcomeActionKey?.(outcome) || `followup:outcome:${outcome}`;
      syncWorkflowDetailFromLifecyclePayload(payload, outcomeKey, { confirmationOutcome: outcome });
      notify("تم تسجيل نتيجة التواصل");
      if (outcome === "confirmed") {
        await completeFollowUpAction(button);
        return;
      }
      await renderOpportunityLifecycleUi();
    } catch (error) {
      notify(error.message || "تعذر تسجيل النتيجة");
    } finally {
      setUiBusy(button, false);
    }
  }

  async function openFollowUpReminderWhatsApp(role) {
    const detail = await enrichDetailForMessaging(activeWorkflowDetail);
    const enriched = {
      ...detail,
      recipientRole: role,
      ownerOfferId: detail.ownerOfferId || followUpRecipientContext?.ownerContactId || "",
      clientRequestId: detail.clientRequestId || followUpRecipientContext?.clientContactId || ""
    };
    const contact = await resolveWorkflowPartyContact(enriched, role);
    if (!contact?.phone) return notify(`رقم ${role === "owner" ? "المالك" : "العميل"} غير متوفر`);
    const phone = whatsappPhone(contact.phone);
    if (!phone) return notify("رقم الجوال غير مكتمل");
    const property = LC().buildOpportunitySummary ? LC().buildOpportunitySummary(detail) : "";
    const follow = FD()?.activeFollowUpFromRecord?.(detail);
    const appointmentLine = follow?.at
      ? (FD()?.formatFollowUpAppointmentLine?.(follow.at) || dateTimeLabel(follow.at))
      : "";
    const message = [
      "السلام عليكم، تذكير بموعد المتابعة بخصوص العقار.",
      property ? `بخصوص: ${property}` : "",
      appointmentLine ? `الموعد: ${appointmentLine}` : "",
      "هل ما زال الموعد مناسبًا؟"
    ].filter(Boolean).join("\n");
    openWhatsAppHandoff({ phone, text: message });
    notify("تم فتح واتساب");
    const whatsappKey = BAP().followUpWhatsAppActionKey?.(role) || `followup:whatsapp:${role}`;
    try {
      const payload = await opportunityLifecycleAction("whatsapp_opened", activeWorkflowDetail, {
        communicationAction: "whatsapp_opened",
        recipientRole: role
      });
      syncWorkflowDetailFromLifecyclePayload(payload, whatsappKey, { whatsappRole: role });
    } catch (error) {
      console.warn("[iaqar] followup whatsapp progress", error);
      activeWorkflowDetail = mergeWorkflowBrokerProgress(activeWorkflowDetail, whatsappKey, { whatsappRole: role });
    }
    void opportunityLifecycleAction("followup_confirmation_opened", activeWorkflowDetail, { recipientRole: role }).catch(() => {});
    activeWorkflowDetail = { ...activeWorkflowDetail, showFollowUpConfirmation: true };
    await renderOpportunityLifecycleUi();
  }

  async function confirmCloseOpportunityFinal(button) {
    const reasonKey = document.getElementById("iaqarCloseReasonKey")?.value || "";
    if (!reasonKey) return notify("اختر سبب إنهاء الفرصة");
    const finalOutcome = document.getElementById("iaqarFinalOutcome")?.value || "";
    if (reasonKey === "deal_done" && !finalOutcome) return notify("اختر نتيجة الصفقة");
    const closureNote = document.getElementById("iaqarCloseNote")?.value || "";
    setUiBusy(button, true);
    try {
      await opportunityLifecycleAction("close_opportunity", activeWorkflowDetail, {
        closureReasonKey: reasonKey,
        finalOutcome: reasonKey === "deal_done" ? finalOutcome : "",
        closureNote
      });
      activeWorkflowDetail = {
        ...activeWorkflowDetail,
        lifecycleStatus: "ARCHIVED",
        closedAt: new Date().toISOString()
      };
      notify("تم إنهاء الفرصة وأرشفتها");
      emitOperations();
      renderOpportunityLifecycleUi();
    } catch (error) {
      notify(error.message || "تعذر إنهاء الفرصة");
    } finally {
      setUiBusy(button, false);
    }
  }

  async function openMatchingBankFromWorkflow() {
    const detail = activeWorkflowDetail;
    const oppId = String(detail?.opportunityId || detail?.recordId || "").replace(/^opp-/, "");
    if (oppId && window.IAQAR?.openOpportunityDetail) {
      closeWorkflowUi();
      await window.IAQAR.openOpportunityDetail(oppId);
    }
  }

  async function handleWorkflowUiClick(event) {
    const button = event.target.closest("[data-ui-action]");
    if (!button) return;
    const action = button.dataset.uiAction;
    if (action === "close-overlay") return closeWorkflowUi();
    if (action === "back") return renderWorkflowUi();
    if (action === "open-schedule") return showScheduleForm();
    if (action === "open-close") return showCloseForm();
    if (action === "open-request") return showRequestForm();
    if (action === "save-schedule") return saveViewingSchedule(button);
    if (action === "save-negotiation") return saveNegotiation(button);
    if (action === "confirm-viewing") return confirmViewingParty(button);
    if (action === "complete") return completeFastDeal(button);
    if (action === "save-close") return saveCloseReason(button);
    if (action === "send-request") return sendOwnerRequest(button);
    if (action === "send-viewing-client") return sendViewingAppointmentWhatsApp("client");
    if (action === "send-viewing-owner") return sendViewingAppointmentWhatsApp("owner");
    const messageStage = activeWorkflowDetail.status === "closed" && activeWorkflowDetail.workflowStage === "closed" ? "completed" : activeWorkflowDetail.status;
    if (action === "whatsapp-client") return openWorkflowWhatsApp({ ...activeWorkflowDetail, recipientRole: "client", messageStage });
    if (action === "whatsapp-owner") return openWorkflowWhatsApp({ ...activeWorkflowDetail, recipientRole: "owner", messageStage });
    if (action === "telegram-client") return openWorkflowTelegram({ ...activeWorkflowDetail, recipientRole: "client", messageStage });
    if (action === "telegram-owner") return openWorkflowTelegram({ ...activeWorkflowDetail, recipientRole: "owner", messageStage });
    if (action === "whatsapp-contact") return openContactWhatsAppDirect();
    if (action === "call-contact") return openContactCallDirect();
    if (action === "contact-outcome") return recordContactOutcomeAction(button, button.dataset.outcome);
    if (action === "save-followup-custom") return saveFollowUpAction(button);
    if (action === "pick-followup-day") return pickFollowUpDay(button.dataset.days);
    if (action === "edit-followup") {
      followUpEditMode = true;
      return void renderOpportunityLifecycleUi();
    }
    if (action === "cancel-followup") return cancelFollowUpAction(button);
    if (action === "complete-followup") return completeFollowUpAction(button);
    if (action === "followup-outcome") return recordFollowUpOutcome(button, button.dataset.outcome);
    if (action === "followup-whatsapp") return openFollowUpReminderWhatsApp(button.dataset.role);
    if (action === "open-lifecycle-close") return showLifecycleCloseForm();
    if (action === "confirm-final-close") return confirmCloseOpportunityFinal(button);
    if (action === "open-matching-bank") return openMatchingBankFromWorkflow();
    if (action === "confirm-contact") return notify("سجّل نتيجة التواصل بعد واتساب أو اتصال");
    if (action === "save-lifecycle-status") return notify("استخدم نتيجة التواصل بدل تغيير الحالة العام");
    if (action === "open-followup") return renderOpportunityLifecycleUi();
  }

  async function handleOperationPrimary(detail) {
    const operationId = detail.recordId || detail.id;
    await postOperationAction(operationId, "START");
    notify(detail.actionLabel || "تم تسجيل بدء الإجراء");
    if (detail.operationType === "MISSING_DATA") {
      const opportunityId = String(detail.opportunityId || "").trim();
      if (opportunityId && window.IAQAR?.renderDailyTaskOpportunity) {
        const opened = await window.IAQAR.renderDailyTaskOpportunity("operationsTaskPanel", opportunityId);
        if (opened) return;
      }
      if (opportunityId && window.IAQAR?.openOpportunityDetail) {
        void window.IAQAR.openOpportunityDetail(opportunityId);
      } else if (window.IAQAR?.openOpportunityBank) {
        window.IAQAR.openOpportunityBank();
      }
      return;
    }
    if (detail.operationType === "COOPERATION_REQUEST" || detail.operationType === "COOPERATION_RESPONSE") {
      if (window.IAQAR?.openOpportunityBank) window.IAQAR.openOpportunityBank();
    }
  }

  async function handleOperationSecondary(detail) {
    const operationId = detail.recordId || detail.id;
    await postOperationAction(operationId, "COMPLETE");
    notify("تم إتمام الإجراء");
  }

  async function handleOperationDismiss(detail) {
    const operationId = detail.recordId || detail.id;
    await postOperationAction(operationId, "DISMISS", detail.dismissalReason || "");
    notify("تم صرف النظر عن الإجراء");
  }

  async function handlePrimaryAction(detail) {
    if (detail.recordType === "summary") {
      if (detail.targetId) window.dispatchEvent(new CustomEvent("iaqar:open-operation", { detail: { id: detail.targetId, main: detail.targetMain || "opportunities" } }));
      else notify("لا توجد فرصة جاهزة الآن");
      return;
    }
    if (detail.recordType === "operation") {
      await handleOperationPrimary(detail);
      return;
    }
    if (detail.recordType === "opportunity") {
      const oppId = String(detail.recordId || detail.opportunityId || "")
        .replace(/^opp-/, "");
      if (oppId && window.IAQAR?.openOpportunityDetail) {
        await window.IAQAR.openOpportunityDetail(oppId);
        return;
      }
    }
    if (detail.recordType === "intake") {
      const oppId = String(detail.opportunityId || "").trim();
      if (oppId && window.IAQAR?.openOpportunityDetail) {
        await window.IAQAR.openOpportunityDetail(oppId);
        return;
      }
      await openWorkflowUi(detail);
      return;
    }
    if (["match", "deal"].includes(detail.recordType)) {
      await openWorkflowUi(detail);
      return;
    }
    if (detail.recordType === "intake") {
      await openWorkflowUi(detail);
    }
  }

  async function handleSecondaryAction(detail) {
    if (detail.recordType === "summary") return;
    if (detail.recordType === "operation") {
      await handleOperationSecondary(detail);
      return;
    }
    if (detail.recordType === "opportunity") {
      const oppId = String(detail.recordId || detail.opportunityId || "").replace(/^opp-/, "");
      if (oppId) await openOpportunityManagement(oppId);
      return;
    }
    if (["match", "deal"].includes(detail.recordType)) {
      await openWorkflowUi(detail);
      return;
    }
    if (["intake", "opportunity"].includes(detail.recordType)) {
      await openWorkflowUi(detail);
    }
  }

  function setOpportunityView(view) {
    opportunityView = view === "archived" ? "archived" : "active";
    emitOperations();
  }

  async function handleQuickCall(detail) {
    if (["match", "deal"].includes(detail.recordType)) {
      await openWorkflowUi(detail);
      return;
    }
    const phoneInfo = resolveLifecyclePhone(detail);
    if (!phoneInfo.valid) return notify(phoneInfo.error || "رقم الجوال غير مكتمل");
    window.location.href = `tel:${phoneInfo.local}`;
    void opportunityLifecycleAction("call_opened", detail, { communicationAction: "call_opened" }).catch((error) => {
      console.warn("[iaqar] call opened log", error);
    });
  }

  async function handleQuickFollowup(detail) {
    const recordType = String(detail.recordType || "").toLowerCase();
    const oppId = String(detail.opportunityId || "").trim()
      || (recordType === "opportunity"
        ? String(detail.recordId || detail.id || "").replace(/^opp-/, "").trim()
        : "");
    if (oppId) {
      window.IAQAR?.homeTabs?.switchTo?.("operations");
      window.dispatchEvent(new CustomEvent("iaqar:open-operations-opportunity", {
        detail: { opportunityId: oppId }
      }));
      return;
    }
    await openWorkflowUi({ ...detail, focusFollowUpReminder: true });
  }

  async function handleQuickScheduleViewing(detail) {
    if (!["match", "deal"].includes(detail.recordType)) {
      return handleQuickFollowup(detail);
    }
    await openWorkflowUi(detail);
    showScheduleForm();
  }

  async function handleAction(event) {
    const detail = event.detail || {};
    try {
      if (detail.actionMode === "call") await handleQuickCall(detail);
      else if (detail.actionMode === "followup") await handleQuickFollowup(detail);
      else if (detail.actionMode === "schedule_viewing") await handleQuickScheduleViewing(detail);
      else if (detail.actionMode === "whatsapp" || detail.actionMode === "telegram") {
        // Phase 7: Match/communication Operations may create drafts; never auto-send.
        const channel = detail.actionMode === "telegram" || detail.channel === "telegram"
          ? "telegram"
          : "whatsapp";
        if (channel === "telegram") await openWorkflowTelegram(detail);
        else await openWorkflowWhatsApp(detail);
      } else if (detail.actionMode === "dismiss") await handleOperationDismiss(detail);
      else if (detail.actionMode === "secondary") await handleSecondaryAction(detail);
      else await handlePrimaryAction(detail);
    } catch (error) {
      notify(error.message || "تعذر تنفيذ الإجراء");
    }
  }

  let currentFcmRegistration = { id: "", type: "" };
  let foregroundMessageUnsubscribe = null;
  let foregroundSetupPending = false;
  const seenPushDeliveries = new Set();
  let deferredInstallPrompt = null;

  function notificationNodes() {
    return {
      control: document.getElementById("officeNotificationControl"),
      status: document.getElementById("officeNotificationStatus")
    };
  }

  function setNotificationStatus(text) {
    const node = notificationNodes().status;
    if (node) node.textContent = text;
  }

  async function getFcmConfig() {
    const response = await fetch(`${resolveWorkerBase()}/fcm/config`, { cache: "no-store" });
    if (!response.ok) throw new Error("تعذر قراءة إعدادات الإشعارات");
    return response.json();
  }

  function notificationInstallationId() {
    const key = "iaqar.notificationInstallationId";
    try {
      let value = localStorage.getItem(key);
      if (!value) {
        value = window.crypto && typeof window.crypto.randomUUID === "function"
          ? window.crypto.randomUUID()
          : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(key, value);
      }
      return value;
    } catch (_) {
      return `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }

  function deviceName() {
    const agent = navigator.userAgent || "";
    const browser = /Edg\//.test(agent) ? "Edge" : /Chrome\//.test(agent) ? "Chrome" : /Firefox\//.test(agent) ? "Firefox" : /Safari\//.test(agent) ? "Safari" : "متصفح";
    const platform = /Android/i.test(agent) ? "Android" : /iPhone|iPad|iPod/i.test(agent) ? "iPhone/iPad" : /Windows/i.test(agent) ? "Windows" : /Macintosh/i.test(agent) ? "Mac" : "جهاز";
    return `${browser} — ${platform}`;
  }

  function notificationUrl(data = {}) {
    if (window.IAQAR?.buildNotificationRelativeUrl) {
      return window.IAQAR.buildNotificationRelativeUrl(data);
    }
    if (data.url && String(data.url).startsWith("/")) return data.url;
    const runtime = office();
    const params = new URLSearchParams({ officeId: runtime && runtime.officeId || "platform" });
    if (data.dealId) params.set("openDeal", data.dealId);
    else if (data.matchId || data.recordId) params.set("openMatch", data.matchId || data.recordId);
    return `/?${params.toString()}`;
  }

  function ensureOperationsHome() {
    window.IAQAR?.homeTabs?.switchTo?.("operations");
    const workspace = document.getElementById("workspace");
    if (workspace) workspace.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function openRecordFromNotification(recordId) {
    const id = String(recordId || "").trim();
    if (!id) return openNotificationCenter();
    ensureOperationsHome();
    const existing = operationItems.find((item) =>
      item.id === id
      || item.recordId === id
      || item.matchId === id
      || item.dealId === id
    );
    if (existing) {
      window.dispatchEvent(new CustomEvent("iaqar:open-operation", {
        detail: { id: existing.id, matchId: existing.matchId || undefined }
      }));
      return;
    }
    const runtime = office();
    if (runtime?.refs) {
      const matchSnap = await runtime.refs.matches.doc(id).get().catch(() => null);
      if (matchSnap?.exists) {
        await openWorkflowUi({ ...matchSnap.data(), recordId: id, recordType: "match" });
        return;
      }
      const dealSnap = await runtime.refs.deals.doc(id).get().catch(() => null);
      if (dealSnap?.exists) {
        await openWorkflowUi({ ...dealSnap.data(), recordId: id, recordType: "deal", dealId: id });
        return;
      }
    }
    window.dispatchEvent(new CustomEvent("iaqar:open-operation", { detail: { id, matchId: id } }));
  }

  function openNotificationCenter() {
    ensureOperationsHome();
    window.dispatchEvent(new CustomEvent("iaqar:open-operation", { detail: { id: null } }));
  }

  function navigateNotificationTarget(target) {
    if (!target) return openNotificationCenter();
    const user = window.firebase?.auth?.()?.currentUser;
    if (!user) {
      notify("سجل دخول المكتب لعرض هذا الإشعار");
      return;
    }
    const runtime = office();
    if (!runtime?.officeId) return;
    const requestedOffice = String(target.officeId || "").trim();
    if (requestedOffice && requestedOffice !== "platform" && requestedOffice !== runtime.officeId) {
      notify("هذا الإشعار يخص مكتبًا آخر");
      return openNotificationCenter();
    }

    switch (target.kind) {
      case "opportunity":
        if (target.id && window.IAQAR?.openOpportunityManagement) {
          void window.IAQAR.openOpportunityManagement(target.id, { focusFollowUp: target.focusFollowUp });
        } else if (target.id && window.IAQAR?.openOpportunityDetail) {
          void window.IAQAR.openOpportunityDetail(target.id);
        } else if (window.IAQAR?.openOpportunityBank) {
          window.IAQAR.openOpportunityBank();
        } else openNotificationCenter();
        break;
      case "cooperation":
        if (window.IAQAR?.openOpportunityBank) window.IAQAR.openOpportunityBank();
        setTimeout(() => {
          const panel = document.getElementById("bankIncomingRequests");
          if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 600);
        break;
      case "message":
        if (target.id) {
          void openRecordFromNotification(target.id);
        } else openNotificationCenter();
        break;
      case "deal":
      case "match":
        void openRecordFromNotification(target.id);
        break;
      case "operation":
        if (target.id?.startsWith("opp_") && window.IAQAR?.openOpportunityManagement) {
          void window.IAQAR.openOpportunityManagement(target.id.replace(/^opp_/, ""), { focusFollowUp: false });
        } else if (target.id?.startsWith("opp_") && window.IAQAR?.openOpportunityDetail) {
          void window.IAQAR.openOpportunityDetail(target.id);
        } else if (target.id?.startsWith("coop_")) {
          if (window.IAQAR?.openOpportunityBank) window.IAQAR.openOpportunityBank();
        } else {
          void openRecordFromNotification(target.id);
        }
        break;
      case "admin":
        const params = new URLSearchParams();
        params.set("office", "platform");
        params.set("adminApplications", "1");
        if (target.id) params.set("openBrokerApplication", target.id);
        window.location.href = `/?${params.toString()}`;
        break;
      case "url":
        const path = String(target.path || "");
        if (path && path !== "/" && !path.includes("view=public")) {
          window.location.href = path.startsWith("/") ? path : `/${path}`;
        } else openNotificationCenter();
        break;
      case "center":
      default:
        openNotificationCenter();
    }
  }

  function handleNotificationDeepLinkFromData(data = {}) {
    if (window.IAQAR?.buildNotificationTargetFromData) {
      navigateNotificationTarget(window.IAQAR.buildNotificationTargetFromData(data));
    }
  }

  async function preferredFcmBridge() {
    if (!window.IAQAR_FCM_READY) return null;
    try { return await window.IAQAR_FCM_READY; }
    catch (_) { return null; }
  }

  function handleForegroundPayload(payload) {
    const message = payload || {};
    const data = message.data || {};
    const deliveryId = String(data.deliveryId || message.messageId || "");
    if (deliveryId && seenPushDeliveries.has(deliveryId)) return;
    if (deliveryId) {
      seenPushDeliveries.add(deliveryId);
      setTimeout(() => seenPushDeliveries.delete(deliveryId), 60000);
    }
    const title = message.notification && message.notification.title || "مكاتب عقارية ذكية";
    const body = message.notification && message.notification.body || "لديك تنبيه جديد";
    notify(`${title} — ${body}`);
    window.dispatchEvent(new CustomEvent("iaqar:push-received", { detail: { title, body, data } }));
    if (Notification.permission === "granted" && "serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then(registration => registration.showNotification(title, {
        body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        dir: "rtl",
        lang: "ar",
        tag: data.recordId || data.matchId || data.dealId || "iaqar-foreground",
        renotify: true,
        data: { url: notificationUrl(data) }
      })).catch(() => {});
    }
  }

  async function setupForegroundNotifications() {
    if (foregroundMessageUnsubscribe || foregroundSetupPending) return;
    foregroundSetupPending = true;
    try {
      const bridge = await preferredFcmBridge();
      if (bridge && typeof bridge.onMessage === "function") {
        foregroundMessageUnsubscribe = bridge.onMessage(handleForegroundPayload);
        return;
      }
      if (window.firebase && typeof window.firebase.messaging === "function") {
        foregroundMessageUnsubscribe = window.firebase.messaging().onMessage(handleForegroundPayload);
      }
    } catch (error) {
      console.warn("[iaqar] foreground notifications", error);
    } finally {
      foregroundSetupPending = false;
    }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  }

  async function createFcmRegistration(config, serviceWorkerRegistration) {
    const tokenOptions = { serviceWorkerRegistration };
    if (config.vapidKey) tokenOptions.vapidKey = config.vapidKey;
    const bridge = await preferredFcmBridge();
    if (bridge && typeof bridge.register === "function") {
      try {
        const fid = await bridge.register({ vapidKey: config.vapidKey, serviceWorkerRegistration });
        if (fid) return { id: fid, type: "fid" };
      } catch (error) {
        console.warn("[iaqar] FID registration failed; using token fallback", error);
      }
    }
    if (window.firebase && typeof window.firebase.messaging === "function") {
      try {
        const token = await window.firebase.messaging().getToken(tokenOptions);
        if (token) return { id: token, type: "token" };
      } catch (error) {
        console.warn("[iaqar] FCM token registration failed; using Web Push fallback", error);
      }
    }
    if (!config.vapidKey) throw new Error("يلزم مفتاح Web Push في الخادم");
    const subscription = await serviceWorkerRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.vapidKey)
    });
    const pushSubscription = subscription.toJSON();
    return {
      id: JSON.stringify(pushSubscription),
      type: "webpush",
      pushSubscription
    };
  }

  function registrationPayload(runtime, registration, permission) {
    const payload = {
      officeId: runtime.officeId,
      fcmRegistrationId: registration.id,
      registrationType: registration.type,
      fcmToken: registration.type === "token" ? registration.id : "",
      userAgent: navigator.userAgent,
      deviceName: deviceName(),
      installationId: notificationInstallationId(),
      language: navigator.language || "ar-SA",
      notificationPermission: permission,
      appVersion: APP_VERSION
    };
    if (registration.pushSubscription) payload.pushSubscription = registration.pushSubscription;
    return payload;
  }

  async function registerNotificationDevice({ requestPermission = false, sendTest = false, silent = false } = {}) {
    if (!runtimeOfficeReady(silent)) return false;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setNotificationStatus("غير متاحة في هذا المتصفح");
      if (!silent) notify("خدمة الإشعارات غير متاحة في هذا المتصفح");
      return false;
    }
    const config = await getFcmConfig();
    if (!config.serverReady) {
      setNotificationStatus("بانتظار إعداد FCM");
      if (!silent) notify("بيانات Firebase في الخادم غير مكتملة");
      return false;
    }
    if (!config.vapidKey) {
      setNotificationStatus("بانتظار مفتاح Web Push");
      if (!silent) notify("يلزم إكمال مفتاح Web Push في الخادم");
      return false;
    }
    let permission = Notification.permission;
    if (requestPermission && permission !== "granted") permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setNotificationStatus(permission === "denied" ? "محظورة من المتصفح" : "غير مفعّلة");
      if (!silent && permission === "denied") notify("الإشعارات محظورة من إعدادات المتصفح.");
      return false;
    }
    const serviceWorkerRegistration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
    const registration = await createFcmRegistration(config, serviceWorkerRegistration);
    const runtime = office();
    const payload = registrationPayload(runtime, registration, permission);
    const response = await fetch(`${resolveWorkerBase()}/fcm/register`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("تعذر تسجيل الجهاز");
    currentFcmRegistration = registration;
    localStorage.setItem(`iaqar.fcm.enabled.${runtime.officeId}`, "1");
    setupForegroundNotifications();
    setNotificationStatus("مفعّلة لهذا المكتب");
    if (sendTest) {
      const testResponse = await fetch(`${resolveWorkerBase()}/fcm/test`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify(payload)
      });
      const testPayload = await testResponse.json().catch(() => ({}));
      if (!testResponse.ok) throw new Error(testPayload.message || "تم تسجيل الجهاز لكن تعذر إرسال الإشعار التجريبي");
      if (!silent) notify(testPayload.sent > 0 ? "تم التفعيل وإرسال إشعار تجريبي" : "تم التفعيل، وسيبدأ استقبال الإشعارات الجديدة");
    }
    return true;
  }

  async function enableNotifications() {
    try {
      setNotificationStatus("جارٍ التفعيل…");
      const activated = await registerNotificationDevice({ requestPermission: true, sendTest: true, silent: false });
      if (!activated) refreshNotificationStatus();
    } catch (error) {
      setNotificationStatus("تعذر التفعيل");
      const permission = typeof Notification !== "undefined" ? Notification.permission : "default";
      if (permission === "denied") {
        notify("الإشعارات محظورة من إعدادات المتصفح.");
      } else if (String(error?.message || "").includes("Web Push")) {
        notify("يلزم إكمال مفتاح Web Push في الخادم");
      } else if (String(error?.message || "").includes("Firebase") || String(error?.message || "").includes("إعدادات")) {
        notify("بيانات Firebase في الخادم غير مكتملة");
      } else {
        notify(error.message || "تعذر تفعيل الإشعارات");
      }
    }
  }

  async function syncEnabledNotifications() {
    const runtime = office();
    if (!runtime || !runtime.officeId || runtime.officeId === "platform") return;
    const enabled = localStorage.getItem(`iaqar.fcm.enabled.${runtime.officeId}`) === "1";
    if (!enabled || !("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const ok = await registerNotificationDevice({ requestPermission: false, sendTest: false, silent: true });
      if (!ok) setNotificationStatus("مفعّلة — جارٍ إعادة الربط");
    }
    catch (error) {
      console.warn("[iaqar] notification registration refresh", error);
      setNotificationStatus("مفعّلة — تعذر تحديث التسجيل مؤقتًا");
    }
  }

  async function disableNotifications() {
    const runtime = office();
    if (!runtime || !runtime.officeId) return;
    try {
      setNotificationStatus("جارٍ الإيقاف…");
      let registration = currentFcmRegistration;
      if (!registration.id) {
        const config = await getFcmConfig().catch(() => null);
        if (config && config.enabled && config.vapidKey && Notification.permission === "granted") {
          const serviceWorkerRegistration = await navigator.serviceWorker.ready;
          registration = await createFcmRegistration(config, serviceWorkerRegistration).catch(() => ({ id: "", type: "" }));
        }
      }
      if (registration.id) {
        const response = await fetch(`${resolveWorkerBase()}/fcm/unregister`, {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify(registrationPayload(runtime, registration, Notification.permission))
        });
        if (!response.ok) throw new Error("تعذر إيقاف تسجيل الجهاز");
      }
      localStorage.removeItem(`iaqar.fcm.enabled.${runtime.officeId}`);
      currentFcmRegistration = { id: "", type: "" };
      setNotificationStatus("غير مفعّلة");
      notify("تم إيقاف إشعارات هذا المكتب على هذا الجهاز");
    } catch (error) {
      setNotificationStatus("تعذر الإيقاف");
      notify(error.message || "تعذر إيقاف الإشعارات");
    }
  }

  function runtimeOfficeReady(silent = false) {
    const runtime = office();
    if (!runtime || !runtime.officeId || runtime.officeId === "platform") {
      if (!silent) notify("سجّل بحساب المكتب أولًا");
      return false;
    }
    return true;
  }

  async function toggleNotifications() {
    if (!runtimeOfficeReady()) return;
    const runtime = office();
    const enabled = localStorage.getItem(`iaqar.fcm.enabled.${runtime.officeId}`) === "1";
    if (enabled) await disableNotifications(); else await enableNotifications();
  }

  function refreshNotificationStatus() {
    const runtime = office();
    if (!runtime || !runtime.officeId || runtime.officeId === "platform") return setNotificationStatus("سجّل بالمكتب أولًا");
    const enabled = localStorage.getItem(`iaqar.fcm.enabled.${runtime.officeId}`) === "1";
    if (enabled && "Notification" in window && Notification.permission === "denied") {
      localStorage.removeItem(`iaqar.fcm.enabled.${runtime.officeId}`);
      return setNotificationStatus("مرفوضة على الجهاز");
    }
    if (!enabled) return setNotificationStatus("غير مفعّلة");
    if ("Notification" in window && Notification.permission !== "granted") {
      return setNotificationStatus("بانتظار إذن الجهاز");
    }
    setNotificationStatus("مفعّلة لهذا المكتب");
  }

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function refreshInstallStatus() {
    const node = document.getElementById("pwaInstallStatus");
    const btn = document.getElementById("pwaInstallBtn");
    const iosHint = document.getElementById("pwaInstallIosHint");
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isStandalone()) {
      if (node) node.textContent = "مثبّت على الجهاز";
      if (btn) btn.hidden = true;
      if (iosHint) iosHint.hidden = true;
      return;
    }
    if (btn) btn.hidden = !deferredInstallPrompt;
    if (iosHint) iosHint.hidden = !isIos;
    if (!node) return;
    if (deferredInstallPrompt) node.textContent = "اضغط «تثبيت التطبيق» أدناه";
    else if (isIos) node.textContent = "اتبع التعليمات أدناه لإضافة الاختصار";
    else node.textContent = "من قائمة المتصفح ← تثبيت التطبيق";
  }

  async function installAppShortcut() {
    if (isStandalone()) return notify("اختصار الموقع مثبت بالفعل");
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      refreshInstallStatus();
      return;
    }
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) notify("اضغط مشاركة ثم إضافة إلى الشاشة الرئيسية");
    else notify("افتح قائمة المتصفح واختر تثبيت التطبيق أو إضافة إلى الشاشة الرئيسية");
  }

  function init() {
    ensureWorkflowUi();
    window.IAQAR_WORKFLOW = { setOpportunityView };
    window.addEventListener("iaqar:workflow-action", handleAction);
    window.addEventListener("iaqar:operation-opened", event => {
      const detail = event.detail || {};
      if (["match", "deal"].includes(detail.recordType)) loadTimeline(detail.recordType, detail.recordId);
      if (detail.recordType === "operation" && detail.recordId) {
        postOperationAction(detail.recordId, "OPEN").catch((error) => {
          console.warn("[iaqar] operation open", error);
        });
      }
    });

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/firebase-messaging-sw.js").catch(error => console.warn("[iaqar] service worker registration", error));
      navigator.serviceWorker.addEventListener("message", event => {
        const message = event.data || {};
        if (message.type === "IAQAR_FCM_FOREGROUND") handleForegroundPayload(message.payload || {});
      });
    }

    const notificationItem = document.getElementById("officeNotificationControl");
    if (notificationItem) {
      notificationItem.addEventListener("click", toggleNotifications);
      notificationItem.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") toggleNotifications();
      });
    }
    const installBtn = document.getElementById("pwaInstallBtn");
    if (installBtn) {
      installBtn.addEventListener("click", installAppShortcut);
      installBtn.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") installAppShortcut();
      });
    }
    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault();
      deferredInstallPrompt = event;
      refreshInstallStatus();
    });
    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      refreshInstallStatus();
      notify("تم تثبيت اختصار مكاتب عقارية ذكية");
    });
    window.addEventListener("iaqar:workflow-overlay-closed", hideWorkflowOverlay);
    refreshNotificationStatus();
    refreshInstallStatus();

    if (window.firebase && window.firebase.auth) {
      window.firebase.auth().onAuthStateChanged(user => {
        if (user) {
          startLiveData();
          submitPendingShare();
          refreshNotificationStatus();
          setupForegroundNotifications();
          syncEnabledNotifications();
        } else {
          stopLiveData();
          matchItems = [];
          dealItems = [];
          intakeItems = [];
          operationItems = [];
          opportunityItems = [];
          analyticsItem = null;
          emitOperations();
        }
      });
    }
    window.addEventListener("iaqar:firebase-ready", startLiveData);
    window.addEventListener("iaqar:office-rebound", () => startLiveData());
    window.addEventListener("iaqar:access-granted", () => startLiveData());
    window.addEventListener("iaqar:opportunity-ingested", (event) => {
      const detail = event.detail || {};
      loadAnalytics();
      if (detail.opportunityId) {
        pushSavedOpportunityToWorkspace(detail);
      } else {
        emitOperations();
      }
    });
    if (new URLSearchParams(location.search).get("shared") === "1") setTimeout(submitPendingShare, 500);

    const params = new URLSearchParams(location.search);
    const deepLink = window.IAQAR?.parseNotificationSearchParams?.(params);
    if (deepLink) {
      setTimeout(() => navigateNotificationTarget(deepLink), 900);
    }
  }

  async function openOpportunityManagement(opportunityId, options = {}) {
    const runtime = office();
    if (!runtime?.db || !runtime.officeId || !opportunityId) {
      notify("تعذر فتح إدارة الفرصة");
      return;
    }
    try {
      const snap = await runtime.db.collection("offices").doc(runtime.officeId)
        .collection("opportunities").doc(opportunityId).get();
      if (!snap.exists) {
        notify("لم يتم العثور على الفرصة");
        return;
      }
      const data = snap.data() || {};
      if (normalizeOfficeId(data.officeId) && normalizeOfficeId(data.officeId) !== runtime.officeId) {
        notify("لا يمكن فتح هذه الفرصة من هذا المكتب");
        return;
      }
      const isOwner = data.contactType === "owner" || data.recordType === "owner_offer";
      const phoneInfo = LC().resolveOpportunityCanonicalPhone
        ? LC().resolveOpportunityCanonicalPhone(data)
        : { valid: false, local: "", tel: "" };
      const contactPhone = phoneInfo.valid
        ? phoneInfo.local
        : (data.contactPhone || data.advertiserPhone || data.phone || "");
      await openWorkflowUi({
        ...data,
        recordId: opportunityId,
        recordType: "opportunity",
        opportunityId,
        kind: isOwner ? "owner" : "client",
        contactType: isOwner ? "owner" : "buyer",
        contactName: data.contactName || data.advertiserDisplayName || "",
        contactPhone,
        focusFollowUpReminder: Boolean(options.focusFollowUp),
        showFollowUpConfirmation: Boolean(options.focusFollowUp),
        prefillCloseReasonKey: options.prefillCloseReason || "",
        prefillCloseNote: options.prefillCloseNote || ""
      });
      if (options.openLifecycleClose) {
        showLifecycleCloseForm({
          reasonKey: options.prefillCloseReason || "not_interested",
          closureNote: options.prefillCloseNote || ""
        });
      }
    } catch (error) {
      console.warn("[iaqar] open opportunity management", error);
      notify("تعذر فتح إدارة الفرصة");
    }
  }

  function normalizeOfficeId(value) {
    return String(value || "").trim();
  }

  window.addEventListener("beforeunload", stopLiveData);
  window.IAQAR = window.IAQAR || {};
  window.IAQAR.pushSavedOpportunityToWorkspace = pushSavedOpportunityToWorkspace;
  window.IAQAR.openOpportunityManagement = openOpportunityManagement;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
