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
  let cooperationItems = [];
  let dealItems = [];
  let intakeItems = [];
  let operationItems = [];
  let savedOpportunityWorkspaceItems = [];
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

    let actionLabel = appointmentAt ? "إنهاء الفرصة" : "تحديد المعاينة";
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
      closingReadinessKey: readiness.key
    };
  }

  function cooperationOperation(doc) {
    const item = doc.data();
    const statusLabels = { pending: "بانتظار الرد", accepted: "مقبولة", declined: "مرفوضة", closed: "مغلقة" };
    const isNearby = item.matchType === "nearby_neighborhood" || item.isNearbyMatch === true;
    const lines = [
      isNearby ? "فرصة قريبة قد تناسب العميل" : "فرصة تعاون — نفس الحي",
      `نسبة المطابقة: ${Number(item.matchScore || 0)}%`,
      item.requestedNeighborhood ? `الحي المطلوب: ${item.requestedNeighborhood}` : "",
      item.listingNeighborhood && isNearby ? `عرض في: ${item.listingNeighborhood}` : "",
      `الحالة: ${statusLabels[item.status] || item.status || "بانتظار الرد"}`,
      item.perspectiveRole === "listing_owner"
        ? "بيانات العميل الخاصة غير مكشوفة قبل قبول التعاون"
        : "ملكية العميل تبقى في مكتبك — التعاون لا ينقل العميل"
    ].filter(Boolean);
    lines.push(...timelineLines("cooperation", doc.id));

    let priority = item.status === "pending" ? 1 : 4;
    if (isNearby) priority = 2;

    return {
      id: doc.id,
      recordId: doc.id,
      recordType: "cooperation",
      main: "opportunities",
      priority,
      isAlert: item.status === "pending",
      icon: "i-match",
      title: item.title || (isNearby ? `فرصة تعاون — حي قريب (${Number(item.matchScore || 0)}%)` : `فرصة تعاون — نفس الحي (${Number(item.matchScore || 0)}%)`),
      subtitle: item.subtitle || [item.propertyType, item.requestedNeighborhood, isNearby ? "حي قريب" : "نفس الحي"].filter(Boolean).join(" — "),
      propertyType: item.propertyType || "",
      district: item.requestedNeighborhood || "",
      listingNeighborhood: item.listingNeighborhood || "",
      time: relativeTime(item.updatedAt || item.createdAt),
      detailsLines: lines,
      status: item.status || "pending",
      statusLabel: statusLabels[item.status] || item.status || "بانتظار الرد",
      matchType: item.matchType || "",
      isNearbyMatch: isNearby,
      isCooperation: true,
      actionLabel: item.status === "pending" ? "إدارة التعاون" : "عرض التعاون",
      secondaryActionLabel: "عرض التفاصيل",
      cooperationId: doc.id,
      perspectiveRole: item.perspectiveRole || ""
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
      main: "deals",
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
      healthScore: health.score
    };
  }


  function intakeOperation(doc) {
    const item = doc.data() || {};
    const isOwner = item.kind === "owner";
    const amountLabel = isOwner ? "السعر المطلوب" : "الميزانية";
    return {
      id: `intake-${doc.id}`,
      recordId: doc.id,
      recordType: "intake",
      main: "opportunities",
      priority: 0,
      isAlert: item.status === "new",
      icon: isOwner ? "i-house-check" : "i-user-clock",
      title: isOwner ? "عرض جديد من مالك" : "طلب جديد من عميل",
      subtitle: [item.propertyType, item.district, item.name].filter(Boolean).join(" — "),
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
    };
  }


  // Phase 8: client-side matcher removed — Worker matching-engine is authoritative.

  async function showLocalMatchNotification(matchCount, topMatch) {
    const title = matchCount > 1 ? `تم اكتشاف ${matchCount} مطابقات جديدة` : "تم اكتشاف مطابقة جديدة";
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
      subtitle: matches > 0 ? `تم العثور على ${matches} مطابقة` : "أُضيفت إلى بنك الفرص",
      time: "الآن",
      detailsLines: [
        matches > 0
          ? `تم حفظ الفرصة وإنشاء ${matches} مطابقة جديدة.`
          : "تم حفظ الفرصة بنجاح — راجع التفاصيل في بنك الفرص."
      ],
      actionLabel: "فتح بنك الفرص",
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
      savedItem.title = "فرصة محفوظة مسبقًا";
      savedItem.subtitle = "لم يُنشأ سجل جديد";
      savedItem.detailsLines = ["هذه الفرصة موجودة بالفعل في بنك الفرص."];
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
        actionLabel: "فتح بنك الفرص",
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

  function emitOperations() {
    // Phase 5: Operations Center shows persisted Operations; hide save-success feedback only.
    pruneSavedOpportunityWorkspaceItems();
    const workspaceItems = savedOpportunityWorkspaceItems.filter(
      (item) => !isSavedOpportunityPresentationItem(item)
    );
    const items = [...cooperationItems, ...operationItems, ...workspaceItems]
      .sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2));
    window.dispatchEvent(new CustomEvent("iaqar:operations-data", { detail: { items, authoritative: true } }));
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
    const cooperationUnsub = runtime.refs.cooperations.orderBy("createdAt", "desc").limit(100).onSnapshot(snapshot => {
      cooperationItems = snapshot.docs.map(cooperationOperation);
      emitOperations();
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

    liveUnsubscribers = [matchUnsub, cooperationUnsub, dealUnsub, intakeUnsub, opsUnsub];
    // Ensure empty authoritative state until the first operations snapshot arrives.
    if (!operationItems.length) emitOperations();
  }

  async function loadTimeline(recordType, recordId) {
    if (!recordId || !["match", "deal", "cooperation"].includes(recordType)) return;
    const cacheKey = `${recordType}:${recordId}`;
    if (timelinePending.has(cacheKey)) return;
    timelinePending.add(cacheKey);
    try {
      const runtime = office();
      if (!runtime || !runtime.refs) return;
      const collection = recordType === "deal"
        ? runtime.refs.deals
        : (recordType === "cooperation" ? runtime.refs.cooperations : runtime.refs.matches);
      const snapshot = await collection.doc(recordId).collection("timeline").orderBy("createdAt", "desc").limit(20).get();
      timelineCache.set(cacheKey, snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      // إعادة قراءة المستند نفسه تضمن تحديث النص بدون إنشاء مستمعات فرعية دائمة.
      const currentDoc = await collection.doc(recordId).get();
      if (currentDoc.exists) {
        if (recordType === "match") matchItems = replaceOperation(matchItems, matchOperation(currentDoc));
        else if (recordType === "deal") dealItems = replaceOperation(dealItems, dealOperation(currentDoc));
        else cooperationItems = replaceOperation(cooperationItems, cooperationOperation(currentDoc));
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
    const digits = String(value || "").replace(/\D/g, "");
    if (/^009665\d{8}$/.test(digits)) return digits.slice(2);
    if (/^9665\d{8}$/.test(digits)) return digits;
    if (/^05\d{8}$/.test(digits)) return `966${digits.slice(1)}`;
    if (/^5\d{8}$/.test(digits)) return `966${digits}`;
    return "";
  }

  function officeDisplayName() {
    return String(document.getElementById("officeDisplayName")?.textContent || "المكتب العقاري").trim();
  }

  function escapeUi(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  function appointmentValue(detail) {
    return detail.appointmentAt || detail.viewingAt || null;
  }

  function appointmentText(detail) {
    const value = appointmentValue(detail);
    return value ? dateTimeLabel(value) : "لم يحدد بعد";
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
    const popup = window.open("", "_blank");
    if (popup) popup.opener = null;
    const runtime = office();
    const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
    const domain = messagingDomain();
    if (!runtime || !runtime.officeId || !user) {
      if (popup) popup.close();
      return notify("سجل دخول المكتب أولًا");
    }
    const role = detail.recipientRole === "owner" ? "owner" : "client";
    const enriched = await enrichDetailForMessaging(detail);
    const contact = await workflowContact(enriched, role);
    const safeChannel = channel === "telegram" ? "telegram" : "whatsapp";
    if (safeChannel === "whatsapp") {
      const phone = whatsappPhone(contact && contact.phone);
      if (!phone) {
        if (popup) popup.close();
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
        if (popup) popup.close();
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

    if (!handoffUrl) {
      if (safeChannel === "whatsapp") {
        const phone = whatsappPhone(contact && contact.phone);
        handoffUrl = phone
          ? `https://wa.me/${phone}?text=${encodeURIComponent(bodyText)}`
          : "";
      } else if (domain && typeof domain.buildTelegramHandoffUrl === "function") {
        handoffUrl = domain.buildTelegramHandoffUrl({ body: bodyText }).url;
      } else {
        handoffUrl = `https://t.me/share/url?url=${encodeURIComponent("https://iaqar.ai/")}&text=${encodeURIComponent(bodyText)}`;
      }
    }

    if (!handoffUrl) {
      if (popup) popup.close();
      return notify("تعذر تجهيز رابط الرسالة");
    }
    if (popup) popup.location.replace(handoffUrl);
    else window.location.href = handoffUrl;
    notify(safeChannel === "telegram"
      ? "فُتح تليجرام — أكّد الإرسال بنفسك"
      : "فُتح واتساب — أكّد الإرسال بنفسك");
  }

  async function openWorkflowWhatsApp(detail) {
    return persistAndOpenMessageDraft(detail, "whatsapp");
  }

  async function openWorkflowTelegram(detail) {
    return persistAndOpenMessageDraft(detail, "telegram");
  }

  let activeWorkflowDetail = null;
  let activeWorkflowContacts = { owner: null, client: null };
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
    if (document.getElementById("iaqarWorkflowOverlay")) return;
    document.head.insertAdjacentHTML("beforeend", `<style id="iaqarWorkflowStyles">
      .iaqar-workflow-overlay[hidden]{display:none!important}.iaqar-workflow-overlay{position:fixed;inset:0;z-index:2000;background:rgba(8,36,31,.55);display:flex;align-items:flex-end;justify-content:center;padding:12px;box-sizing:border-box;direction:rtl}
      .iaqar-workflow-panel{width:min(100%,560px);max-height:92svh;overflow:auto;background:#fff;border-radius:24px 24px 18px 18px;box-shadow:0 24px 70px rgba(0,0,0,.24);font-family:Tajawal,Arial,sans-serif;color:#173d35}
      .iaqar-workflow-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:17px 18px;background:#fff;border-bottom:1px solid #e2ece8}.iaqar-workflow-head h2{margin:0;color:#087064;font-size:21px}.iaqar-workflow-close{width:38px;height:38px;border:0;border-radius:12px;background:#edf6f3;color:#087064;font-size:25px;cursor:pointer}
      .iaqar-workflow-body{padding:16px}.iaqar-workflow-summary{background:#f4f8f6;border:1px solid #dce8e4;border-radius:16px;padding:12px;margin-bottom:12px;font-size:14px;line-height:1.8}.iaqar-workflow-steps{display:grid;gap:10px}.iaqar-workflow-step{border:1px solid #dce8e4;border-radius:18px;padding:14px}.iaqar-workflow-step.is-done{border-color:#9fd1c5;background:#f1faf7}.iaqar-workflow-step h3{margin:0 0 5px;font-size:17px;color:#0a695d}.iaqar-workflow-step p{margin:0 0 10px;color:#657b74;font-size:13px;line-height:1.6}
      .iaqar-workflow-actions,.iaqar-whatsapp-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:10px}.iaqar-workflow-btn{min-height:47px;border:0;border-radius:14px;padding:10px 12px;font:800 14px Tajawal;cursor:pointer;background:#128c7e;color:#fff}.iaqar-workflow-btn.secondary{background:#edf7f4;color:#087064;border:1px solid #b9ddd4}.iaqar-workflow-btn.danger{background:#fff1f1;color:#a33a3a;border:1px solid #efc4c4}.iaqar-workflow-btn.success{background:#087064;color:#fff}.iaqar-workflow-btn.whatsapp{background:#25d366;color:#063c27}.iaqar-workflow-btn:disabled{opacity:.48;cursor:not-allowed}
      .iaqar-workflow-form{display:grid;gap:11px}.iaqar-workflow-form label{display:grid;gap:5px;font-size:13px;font-weight:700}.iaqar-workflow-form input,.iaqar-workflow-form select,.iaqar-workflow-form textarea{width:100%;box-sizing:border-box;border:1px solid #cedfda;border-radius:13px;padding:12px;font:500 15px Tajawal;background:#fff}.iaqar-workflow-form textarea{min-height:82px;resize:vertical}.iaqar-workflow-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.iaqar-checks{display:grid;gap:8px;background:#f7faf9;border-radius:14px;padding:12px}.iaqar-checks label{display:flex;align-items:center;gap:8px}.iaqar-workflow-note{font-size:12px;color:#70817c;line-height:1.6}.iaqar-workflow-result{padding:18px;border-radius:17px;text-align:center;font-weight:800}.iaqar-workflow-result.success{background:#eaf8f3;color:#087064}.iaqar-workflow-result.closed{background:#fff1f1;color:#9c3c3c}.iaqar-internal-details{margin-top:12px;border:1px solid #e1ebe7;border-radius:15px;padding:10px}.iaqar-internal-details summary{cursor:pointer;font-weight:700;color:#54716a}
      @media(min-width:700px){.iaqar-workflow-overlay{align-items:center}.iaqar-workflow-panel{border-radius:24px}}@media(max-width:420px){.iaqar-workflow-actions,.iaqar-whatsapp-grid,.iaqar-workflow-form-grid{grid-template-columns:1fr}}
    </style>`);
    document.body.insertAdjacentHTML("beforeend", `<div class="iaqar-workflow-overlay" id="iaqarWorkflowOverlay" hidden>
      <section class="iaqar-workflow-panel" role="dialog" aria-modal="true" aria-labelledby="iaqarWorkflowTitle">
        <header class="iaqar-workflow-head"><h2 id="iaqarWorkflowTitle">إدارة الفرصة</h2><button class="iaqar-workflow-close" type="button" data-ui-action="close-overlay" aria-label="إغلاق">×</button></header>
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

  function workflowBody() {
    return document.getElementById("iaqarWorkflowBody");
  }

  function closeWorkflowUi() {
    const overlay = document.getElementById("iaqarWorkflowOverlay");
    if (!overlay || overlay.hidden) return;
    window.dispatchEvent(new CustomEvent("iaqar:nav-close-request"));
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
    const overlay = document.getElementById("iaqarWorkflowOverlay");
    overlay.hidden = false;
    if (detail.recordType === "cooperation") {
      window.dispatchEvent(new CustomEvent("iaqar:nav-open", { detail: { view: "iaqarWorkflowOverlay" } }));
      renderCooperationUi();
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

  function renderCooperationUi() {
    const detail = activeWorkflowDetail;
    if (!detail) return;
    const body = workflowBody();
    document.getElementById("iaqarWorkflowTitle").textContent = "فرصة تعاون بين المكاتب";
    const isNearby = detail.isNearbyMatch === true || detail.matchType === "nearby_neighborhood";
    const summary = `<div class="iaqar-workflow-summary"><strong>${escapeUi(detail.title || "فرصة تعاون")}</strong><br>${escapeUi(detail.subtitle || "")}<br>${isNearby ? "حي قريب موثق — الحي المطلوب لم يُغيَّر" : "نفس الحي"}<br>ملكية العميل والعرض تبقى في مكتبيها الأصليين.</div>`;
    const lines = (detail.detailsLines || []).map(line => `<div>${escapeUi(line)}</div>`).join("");
    const pending = detail.status === "pending";
    body.innerHTML = `${summary}<div class="iaqar-workflow-step">${lines}</div>${pending ? `<div class="iaqar-workflow-actions"><button class="iaqar-workflow-btn success" data-ui-action="accept-cooperation">قبول التعاون</button><button class="iaqar-workflow-btn danger" data-ui-action="decline-cooperation">رفض التعاون</button></div>` : `<div class="iaqar-workflow-result closed">الحالة: ${escapeUi(detail.statusLabel || detail.status || "")}</div>`}`;
  }

  function contactButtonLabel(role) {
    const contact = activeWorkflowContacts[role];
    const label = role === "owner" ? "المالك" : "العميل";
    return contact && contact.name ? `واتساب ${label}: ${contact.name}` : `واتساب ${label}`;
  }

  function renderWorkflowUi() {
    const detail = activeWorkflowDetail;
    if (!detail) return;
    const body = workflowBody();
    const isMatch = detail.recordType === "match";
    const isCompleted = detail.status === "completed" || (detail.recordType === "deal" && detail.status === "closed");
    const isClosed = detail.status === "closed" || detail.status === "lost";
    const hasAppointment = Boolean(appointmentValue(detail));
    document.getElementById("iaqarWorkflowTitle").textContent = isMatch ? "إدارة الفرصة" : "إدارة الصفقة";

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
      body.innerHTML = `${summary}<div class="iaqar-workflow-step"><h3>إنهاء الصفقة</h3><p>يمكن إتمام الصفقة مباشرة، أو إيقافها مع حفظ السبب.</p><div class="iaqar-workflow-actions"><button class="iaqar-workflow-btn success" data-ui-action="complete">تمت الصفقة</button><button class="iaqar-workflow-btn danger" data-ui-action="open-close">لم تتم الصفقة</button></div></div>
        <div class="iaqar-whatsapp-grid"><button class="iaqar-workflow-btn whatsapp" data-ui-action="whatsapp-client">${escapeUi(contactButtonLabel("client"))}</button><button class="iaqar-workflow-btn whatsapp" data-ui-action="whatsapp-owner">${escapeUi(contactButtonLabel("owner"))}</button></div>${internalDealFields()}`;
      return;
    }

    body.innerHTML = `${summary}<div class="iaqar-workflow-steps">
      <article class="iaqar-workflow-step ${hasAppointment ? "is-done" : ""}"><h3>1. تحديد المعاينة</h3><p>${hasAppointment ? `الموعد: ${escapeUi(appointmentText(detail))}` : "اختر التاريخ والوقت ثم احفظ الموعد."}</p><button class="iaqar-workflow-btn secondary" data-ui-action="open-schedule">${hasAppointment ? "تغيير الموعد" : "تحديد المعاينة"}</button></article>
      <article class="iaqar-workflow-step"><h3>2. إنهاء الفرصة</h3><p>${hasAppointment ? "بعد المعاينة اختر النتيجة مباشرة." : "يتاح إتمام الصفقة بعد حفظ موعد المعاينة."}</p><div class="iaqar-workflow-actions"><button class="iaqar-workflow-btn success" data-ui-action="complete" ${hasAppointment ? "" : "disabled"}>تمت الصفقة</button><button class="iaqar-workflow-btn danger" data-ui-action="open-close">لم تتم الصفقة</button></div></article>
    </div>${hasAppointment ? `<div class="iaqar-whatsapp-grid"><button class="iaqar-workflow-btn whatsapp" data-ui-action="whatsapp-client">${escapeUi(contactButtonLabel("client"))}</button><button class="iaqar-workflow-btn whatsapp" data-ui-action="whatsapp-owner">${escapeUi(contactButtonLabel("owner"))}</button></div>` : ""}
    <div class="iaqar-workflow-actions"><button class="iaqar-workflow-btn secondary" data-ui-action="open-request">طلب الصور أو الموقع أو رابط العقار</button></div>${internalDealFields()}`;
  }

  function internalDealFields() {
    return `<details class="iaqar-internal-details"><summary>بيانات داخلية اختيارية</summary><div class="iaqar-workflow-form" style="margin-top:10px"><label>السعر النهائي<input id="iaqarFinalPrice" inputmode="decimal" placeholder="اختياري"></label><label>العمولة<input id="iaqarCommission" inputmode="decimal" placeholder="اختياري"></label><label>ملاحظة داخلية<textarea id="iaqarInternalNote" placeholder="لا تظهر للعميل أو المالك"></textarea></label></div></details>`;
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
    const runtime = office();
    if (!runtime || !runtime.refs || !runtime.refs.matches) return;
    await runtime.refs.matches.doc(detail.recordId).set({
      officeId: runtime.officeId,
      viewingAt: window.firebase.firestore.Timestamp.fromDate(date),
      nextFollowUpAt: window.firebase.firestore.Timestamp.fromDate(date),
      lastNote: note || "تم تحديد موعد المعاينة",
      updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
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
      activeWorkflowDetail = { ...detail, status: status === "negotiation" ? "negotiation" : "viewing", appointmentAt: iso, viewingAt: iso, nextFollowUpAt: iso };
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
    setUiBusy(button, true, "جارٍ تجهيز الرسالة...");
    try {
      const detail = { ...activeWorkflowDetail, recipientRole: "owner", messageMode: "request", requestedItems: items, requestNote: note };
      if (detail.recordType === "match") {
        await workflowAction("add_match_followup", detail.recordId, {
          note: `تم طلب: ${items.join("، ")}${note ? ` — ${note}` : ""}`,
          nextFollowUpAt: new Date(Date.now() + 24 * 3600000).toISOString()
        });
      }
      await openWorkflowWhatsApp(detail);
      renderWorkflowUi();
    } catch (error) {
      notify(error.message || "تعذر تجهيز الرسالة");
    } finally {
      setUiBusy(button, false);
    }
  }

  async function updateCooperationStatus(button, action) {
    if (!activeWorkflowDetail || activeWorkflowDetail.recordType !== "cooperation") return;
    setUiBusy(button, true);
    try {
      const result = await workflowAction(action, activeWorkflowDetail.recordId, {});
      activeWorkflowDetail = {
        ...activeWorkflowDetail,
        status: result.status || activeWorkflowDetail.status,
        statusLabel: result.status === "accepted" ? "مقبولة" : result.status === "declined" ? "مرفوضة" : activeWorkflowDetail.statusLabel
      };
      renderCooperationUi();
      notify(result.status === "accepted" ? "تم قبول التعاون" : "تم رفض التعاون");
    } catch (error) {
      notify(error.message || "تعذر تحديث التعاون");
    } finally {
      setUiBusy(button, false);
    }
  }

  async function handleWorkflowUiClick(event) {
    const button = event.target.closest("[data-ui-action]");
    if (!button) return;
    const action = button.dataset.uiAction;
    if (action === "close-overlay") return closeWorkflowUi();
    if (action === "back") return activeWorkflowDetail?.recordType === "cooperation" ? renderCooperationUi() : renderWorkflowUi();
    if (action === "open-schedule") return showScheduleForm();
    if (action === "open-close") return showCloseForm();
    if (action === "open-request") return showRequestForm();
    if (action === "accept-cooperation") return updateCooperationStatus(button, "accept_cooperation");
    if (action === "decline-cooperation") return updateCooperationStatus(button, "decline_cooperation");
    if (action === "save-schedule") return saveViewingSchedule(button);
    if (action === "complete") return completeFastDeal(button);
    if (action === "save-close") return saveCloseReason(button);
    if (action === "send-request") return sendOwnerRequest(button);
    const messageStage = activeWorkflowDetail.status === "closed" && activeWorkflowDetail.workflowStage === "closed" ? "completed" : activeWorkflowDetail.status;
    if (action === "whatsapp-client") return openWorkflowWhatsApp({ ...activeWorkflowDetail, recipientRole: "client", messageStage });
    if (action === "whatsapp-owner") return openWorkflowWhatsApp({ ...activeWorkflowDetail, recipientRole: "owner", messageStage });
    if (action === "telegram-client") return openWorkflowTelegram({ ...activeWorkflowDetail, recipientRole: "client", messageStage });
    if (action === "telegram-owner") return openWorkflowTelegram({ ...activeWorkflowDetail, recipientRole: "owner", messageStage });
  }

  async function handleOperationPrimary(detail) {
    const operationId = detail.recordId || detail.id;
    await postOperationAction(operationId, "START");
    notify(detail.actionLabel || "تم تسجيل بدء الإجراء");
    if (detail.operationType === "MISSING_DATA") {
      const opportunityId = String(detail.opportunityId || "").trim();
      if (opportunityId && window.IAQAR?.openOpportunityDetail) {
        void window.IAQAR.openOpportunityDetail(opportunityId);
      } else if (window.IAQAR?.openOpportunityBank) {
        window.IAQAR.openOpportunityBank();
      }
      return;
    }
    if (detail.operationType === "COOPERATION_REQUEST" || detail.operationType === "COOPERATION_RESPONSE") {
      const coopId = String(detail.cooperationId || detail.recordId || "").trim();
      const coop = cooperationItems.find(item => item.id === coopId || item.recordId === coopId);
      if (coop) {
        await openWorkflowUi(coop);
        return;
      }
      if (coopId) {
        window.dispatchEvent(new CustomEvent("iaqar:open-operation", { detail: { id: coopId, main: "opportunities" } }));
        return;
      }
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
      if (window.IAQAR && typeof window.IAQAR.openOpportunityBank === "function") {
        window.IAQAR.openOpportunityBank();
      }
      return;
    }
    if (["match", "deal", "cooperation"].includes(detail.recordType)) {
      await openWorkflowUi(detail);
      return;
    }
    if (detail.recordType === "intake") notify("تم استلام البيانات وسيتم تشغيل المطابقة تلقائيًا");
  }

  async function handleSecondaryAction(detail) {
    if (detail.recordType === "summary") return;
    if (detail.recordType === "operation") {
      await handleOperationSecondary(detail);
      return;
    }
    if (detail.recordType === "opportunity") {
      savedOpportunityWorkspaceItems = savedOpportunityWorkspaceItems.filter(
        item => item.recordId !== (detail.recordId || detail.id)
      );
      emitOperations();
      return;
    }
    if (["match", "deal", "cooperation"].includes(detail.recordType)) {
      await openWorkflowUi(detail);
      return;
    }
  }

  async function handleAction(event) {
    const detail = event.detail || {};
    try {
      if (detail.actionMode === "whatsapp" || detail.actionMode === "telegram") {
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

  function openNotificationCenter() {
    const workspace = document.getElementById("workspace");
    if (workspace) workspace.scrollIntoView({ behavior: "smooth", block: "start" });
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
        if (target.id && window.IAQAR?.openOpportunityDetail) {
          void window.IAQAR.openOpportunityDetail(target.id);
        } else if (window.IAQAR?.openOpportunityBank) {
          window.IAQAR.openOpportunityBank();
        } else openNotificationCenter();
        break;
      case "cooperation":
        if (target.id) {
          window.dispatchEvent(new CustomEvent("iaqar:open-operation", { detail: { id: target.id, main: "opportunities" } }));
        } else openNotificationCenter();
        break;
      case "message":
        if (target.id) {
          window.dispatchEvent(new CustomEvent("iaqar:open-operation", { detail: { id: target.id, main: "opportunities" } }));
        } else openNotificationCenter();
        break;
      case "deal":
        window.dispatchEvent(new CustomEvent("iaqar:open-operation", { detail: { id: target.id, main: "deals" } }));
        break;
      case "match":
        if (target.id?.startsWith("opp_") && window.IAQAR?.openOpportunityDetail) {
          void window.IAQAR.openOpportunityDetail(target.id);
        } else {
          window.dispatchEvent(new CustomEvent("iaqar:open-operation", { detail: { id: target.id, main: "opportunities" } }));
        }
        break;
      case "operation":
        if (target.id?.startsWith("opp_") && window.IAQAR?.openOpportunityDetail) {
          void window.IAQAR.openOpportunityDetail(target.id);
        } else if (target.id?.startsWith("coop_")) {
          window.dispatchEvent(new CustomEvent("iaqar:open-operation", { detail: { id: target.id, main: "opportunities" } }));
        } else {
          window.dispatchEvent(new CustomEvent("iaqar:open-operation", { detail: { id: target.id, main: "opportunities" } }));
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
    window.addEventListener("iaqar:workflow-action", handleAction);
    window.addEventListener("iaqar:operation-opened", event => {
      const detail = event.detail || {};
      if (["match", "deal", "cooperation"].includes(detail.recordType)) loadTimeline(detail.recordType, detail.recordId);
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
          cooperationItems = [];
          dealItems = [];
          intakeItems = [];
          operationItems = [];
          analyticsItem = null;
          emitOperations();
        }
      });
    }
    window.addEventListener("iaqar:firebase-ready", startLiveData);
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
    } else {
      const openMatch = params.get("openMatch");
      const openDeal = params.get("openDeal");
      const openOperation = params.get("openOperation");
      if (openOperation) setTimeout(() => window.dispatchEvent(new CustomEvent("iaqar:open-operation", { detail: { id: openOperation, main: "opportunities" } })), 900);
      if (openMatch) setTimeout(() => {
        const byMatch = operationItems.find((item) =>
          item.id === openMatch || item.matchId === openMatch || item.recordId === openMatch
        );
        window.dispatchEvent(new CustomEvent("iaqar:open-operation", {
          detail: { id: byMatch?.id || openMatch, matchId: openMatch, main: "opportunities" }
        }));
      }, 900);
      if (openDeal) setTimeout(() => window.dispatchEvent(new CustomEvent("iaqar:open-operation", { detail: { id: openDeal, main: "deals" } })), 900);
    }
  }

  window.addEventListener("beforeunload", stopLiveData);
  window.IAQAR = window.IAQAR || {};
  window.IAQAR.pushSavedOpportunityToWorkspace = pushSavedOpportunityToWorkspace;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
