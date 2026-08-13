/**
 * Phase 7 — client messaging contracts (templates, drafts, adapter handoff).
 * Mirrors worker/src/messaging-domain.js. Never auto-sends. Never fakes delivery.
 */

export const MESSAGE_CHANNELS = Object.freeze({
  WHATSAPP: "whatsapp",
  TELEGRAM: "telegram"
});

export const MESSAGE_SEND_STATE = Object.freeze({
  DRAFT: "DRAFT",
  READY: "READY",
  OPENED_EXTERNAL: "OPENED_EXTERNAL",
  SENT: "SENT",
  FAILED: "FAILED"
});

export const MESSAGE_DELIVERY_STATE = Object.freeze({
  NOT_APPLICABLE: "NOT_APPLICABLE",
  UNKNOWN: "UNKNOWN",
  DELIVERED: "DELIVERED",
  READ: "READ"
});

export const TEMPLATE_CODES = Object.freeze({
  MATCH_OWNER: "MATCH_OWNER",
  MATCH_CLIENT: "MATCH_CLIENT",
  FOLLOWUP: "FOLLOWUP",
  VIEWING_OWNER: "VIEWING_OWNER",
  VIEWING_CLIENT: "VIEWING_CLIENT",
  MEDIA_REQUEST: "MEDIA_REQUEST",
  OWNER_MEDIA_MISSING: "OWNER_MEDIA_MISSING",
  GENERIC_CONTACT: "GENERIC_CONTACT",
  OPERATION_REVIEW: "OPERATION_REVIEW",
  NEGOTIATION: "NEGOTIATION",
  AGREEMENT: "AGREEMENT",
  CLOSING: "CLOSING",
  COMPLETED: "COMPLETED",
  CLOSED: "CLOSED",
  LOST: "LOST"
});

export const MESSAGES_DRAFT_PATH = "/messages/draft";
export const MESSAGES_HANDOFF_PATH = "/messages/handoff";

export function phase7BoundaryGuarantees() {
  return {
    createsSmartMessageDraft: true,
    persistsMessageDraft: true,
    sendsWhatsApp: false,
    sendsTelegram: false,
    autoSendsMessages: false,
    claimsFakeDelivery: false,
    cloudApiOutboundEnabled: false,
    whatsappAdapterStatus: "adapter_ready",
    telegramAdapterStatus: "simulated",
    addsDealsPage: false,
    addsBottomNavigation: false
  };
}

export function normalizeChannel(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === MESSAGE_CHANNELS.TELEGRAM) return MESSAGE_CHANNELS.TELEGRAM;
  return MESSAGE_CHANNELS.WHATSAPP;
}

export function whatsappDigits(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (/^009665\d{8}$/.test(digits)) return digits.slice(2);
  if (/^9665\d{8}$/.test(digits)) return digits;
  if (/^05\d{8}$/.test(digits)) return `966${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) return `966${digits}`;
  return "";
}

export function resolveTemplateCode({
  templateCode = "",
  role = "client",
  stage = "contact",
  messageMode = "",
  ownerMediaMissing = false
} = {}) {
  const explicit = String(templateCode || "").trim().toUpperCase();
  if (explicit && Object.values(TEMPLATE_CODES).includes(explicit)) return explicit;
  if (messageMode === "request" || stage === "request") return TEMPLATE_CODES.MEDIA_REQUEST;
  if (ownerMediaMissing === true && role === "owner"
    && !["viewing", "completed", "closed"].includes(String(stage || ""))) {
    return TEMPLATE_CODES.OWNER_MEDIA_MISSING;
  }
  const status = String(stage || "contact").toLowerCase();
  if (status === "viewing") {
    return role === "owner" ? TEMPLATE_CODES.VIEWING_OWNER : TEMPLATE_CODES.VIEWING_CLIENT;
  }
  if (status === "waiting_response" || status === "followup") return TEMPLATE_CODES.FOLLOWUP;
  if (status === "active") {
    return role === "owner" ? TEMPLATE_CODES.MATCH_OWNER : TEMPLATE_CODES.MATCH_CLIENT;
  }
  if (status === "negotiation") return TEMPLATE_CODES.NEGOTIATION;
  if (status === "agreement") return TEMPLATE_CODES.AGREEMENT;
  if (status === "closing") return TEMPLATE_CODES.CLOSING;
  if (status === "completed") return TEMPLATE_CODES.COMPLETED;
  if (status === "closed") return TEMPLATE_CODES.CLOSED;
  if (status === "lost") return TEMPLATE_CODES.LOST;
  if (status === "operation" || status === "match_review") return TEMPLATE_CODES.OPERATION_REVIEW;
  return TEMPLATE_CODES.GENERIC_CONTACT;
}

export function buildArabicMessageBody(input = {}) {
  const {
    templateCode = TEMPLATE_CODES.GENERIC_CONTACT,
    role = "client",
    officeName = "المكتب العقاري",
    contactName = "",
    propertyType = "",
    district = "",
    appointmentLabel = "",
    requestedItems = [],
    requestNote = "",
    stage = "contact"
  } = input;
  const name = contactName ? ` ${contactName}` : "";
  const greeting = `مرحبًا${name}، معك ${officeName}.`;
  const property = [propertyType, district].filter(Boolean).join(" في ") || "العقار";
  const appointment = appointmentLabel || "لم يحدد بعد";
  const code = String(templateCode || "").toUpperCase();

  if (code === TEMPLATE_CODES.MEDIA_REQUEST || stage === "request") {
    const labels = { photos: "صور العقار", location: "موقع العقار", propertyLink: "رابط العقار" };
    const requested = (requestedItems || []).map((item) => labels[item] || item).filter(Boolean).join("، ");
    return `${greeting}\n\nنرجو تزويدنا بـ${requested || "المعلومات اللازمة لإكمال المطابقة"}.${requestNote ? `\nملاحظة: ${requestNote}` : ""}\n\nمع التحية،\n${officeName}`;
  }
  if (code === TEMPLATE_CODES.MATCH_OWNER || (code === TEMPLATE_CODES.OPERATION_REVIEW && role === "owner")) {
    return `${greeting}\n\nيوجد عميل مهتم بعقار مطابق لـ ${property}. نرغب في استكمال التنسيق معك.\n\nمع التحية،\n${officeName}`;
  }
  if (code === TEMPLATE_CODES.MATCH_CLIENT || (code === TEMPLATE_CODES.OPERATION_REVIEW && role === "client")) {
    return `${greeting}\n\nوجدنا عرضًا مناسبًا لطلبك: ${property}. نرغب في استكمال التنسيق معك.\n\nمع التحية،\n${officeName}`;
  }
  if (code === TEMPLATE_CODES.VIEWING_OWNER) {
    return `${greeting}\n\nتم تحديد موعد معاينة العقار مع عميل مهتم يوم ${appointment}. نرجو تأكيد الموعد.\n\nمع التحية،\n${officeName}`;
  }
  if (code === TEMPLATE_CODES.VIEWING_CLIENT) {
    return `${greeting}\n\nتم تحديد موعد معاينة العقار يوم ${appointment}. نرجو تأكيد حضورك.\n\nمع التحية،\n${officeName}`;
  }
  if (code === TEMPLATE_CODES.FOLLOWUP) {
    return `${greeting}\n\nنتابع معك بخصوص ${property} لاستكمال الخطوة التالية.\n\nمع التحية،\n${officeName}`;
  }
  if (code === TEMPLATE_CODES.OWNER_MEDIA_MISSING) {
    return `${greeting}\n\nنشكرك على إرسال عرض العقار. نأمل تزويدنا بصور واضحة للعقار حتى نتمكن من عرضه ومطابقته مع العملاء المناسبين.\n\nمع التحية،\n${officeName}`;
  }
  if (code === TEMPLATE_CODES.NEGOTIATION) {
    return `${greeting}\n\nبدأت مرحلة التفاوض بخصوص ${property}، وسننسق معك التفاصيل حتى اكتمال الإجراء.\n\nمع التحية،\n${officeName}`;
  }
  if (code === TEMPLATE_CODES.AGREEMENT) {
    return `${greeting}\n\nتم تسجيل الاتفاق بخصوص ${property}، وجارٍ استكمال إجراءات الصفقة.\n\nمع التحية،\n${officeName}`;
  }
  if (code === TEMPLATE_CODES.CLOSING) {
    return `${greeting}\n\nالمعاملة الخاصة بـ ${property} جاهزة للإغلاق.\n\nمع التحية،\n${officeName}`;
  }
  if (code === TEMPLATE_CODES.COMPLETED) {
    return `${greeting}\n\nتم بحمد الله إتمام الصفقة الخاصة بـ ${property}. نشكرك على التعامل مع ${officeName}.\n\nمع التحية،\n${officeName}`;
  }
  if (code === TEMPLATE_CODES.CLOSED) {
    return `${greeting}\n\nتم إغلاق متابعة ${property}. إذا رغبت في إعادة فتح الطلب فتواصل معنا.\n\nمع التحية،\n${officeName}`;
  }
  if (code === TEMPLATE_CODES.LOST) {
    return `${greeting}\n\nلم تكتمل صفقة ${property} حاليًا. يسعدنا خدمتك عند توفر فرصة جديدة.\n\nمع التحية،\n${officeName}`;
  }
  return `${greeting}\n\nنتواصل معك بخصوص ${property} لتأكيد البيانات وترتيب الخطوة التالية.\n\nمع التحية،\n${officeName}`;
}

export function buildWhatsAppHandoffUrl({ phone = "", body = "" } = {}) {
  const digits = whatsappDigits(phone);
  if (!digits) return { ok: false, error: "phone_required" };
  return {
    ok: true,
    channel: MESSAGE_CHANNELS.WHATSAPP,
    url: `https://wa.me/${digits}?text=${encodeURIComponent(String(body || ""))}`,
    impliesSent: false,
    impliesDelivered: false
  };
}

export function buildTelegramHandoffUrl({ body = "", shareUrl = "https://iaqar.ai/" } = {}) {
  return {
    ok: true,
    channel: MESSAGE_CHANNELS.TELEGRAM,
    url: `https://t.me/share/url?url=${encodeURIComponent(String(shareUrl))}&text=${encodeURIComponent(String(body || ""))}`,
    impliesSent: false,
    impliesDelivered: false,
    adapterStatus: "simulated"
  };
}

async function postWorkerJson({
  workerBase,
  path,
  idToken,
  body,
  fetchImpl = globalThis.fetch
}) {
  if (!workerBase) return { ok: false, error: "worker_base_required" };
  if (!idToken) return { ok: false, error: "auth_required" };
  const response = await fetchImpl(new URL(path, workerBase).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify(body || {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      error: payload.error || "messages_request_failed",
      message: payload.message || "",
      status: response.status,
      payload
    };
  }
  return { ok: true, ...payload, payload };
}

export function requestCreateMessageDraft({
  workerBase,
  idToken,
  officeId,
  channel = MESSAGE_CHANNELS.WHATSAPP,
  templateCode,
  role = "client",
  contactName = "",
  contactPhone = "",
  propertyType = "",
  district = "",
  appointmentLabel = "",
  officeName = "",
  stage = "",
  messageMode = "",
  ownerMediaMissing = false,
  requestedItems = [],
  requestNote = "",
  operationId = "",
  matchId = "",
  opportunityId = "",
  body = "",
  fetchImpl = globalThis.fetch
} = {}) {
  return postWorkerJson({
    workerBase,
    path: MESSAGES_DRAFT_PATH,
    idToken,
    body: {
      officeId,
      channel,
      templateCode,
      role,
      contactName,
      contactPhone,
      propertyType,
      district,
      appointmentLabel,
      officeName,
      stage,
      messageMode,
      ownerMediaMissing,
      requestedItems,
      requestNote,
      operationId,
      matchId,
      opportunityId,
      body
    },
    fetchImpl
  });
}

export function requestMessageHandoff({
  workerBase,
  idToken,
  officeId,
  messageId,
  fetchImpl = globalThis.fetch
} = {}) {
  return postWorkerJson({
    workerBase,
    path: MESSAGES_HANDOFF_PATH,
    idToken,
    body: { officeId, messageId },
    fetchImpl
  });
}

export function sendStateLabelAr(state) {
  switch (String(state || "").toUpperCase()) {
    case MESSAGE_SEND_STATE.DRAFT: return "مسودة";
    case MESSAGE_SEND_STATE.READY: return "جاهزة للمراجعة";
    case MESSAGE_SEND_STATE.OPENED_EXTERNAL: return "فُتحت خارجيًا (لم يُؤكد الإرسال)";
    case MESSAGE_SEND_STATE.SENT: return "أُرسلت (مؤكد من المزود)";
    case MESSAGE_SEND_STATE.FAILED: return "فشل الإرسال";
    default: return "مسودة";
  }
}

export function deliveryStateLabelAr(state) {
  switch (String(state || "").toUpperCase()) {
    case MESSAGE_DELIVERY_STATE.NOT_APPLICABLE: return "التسليم غير منطبق (تسليم يدوي خارجي)";
    case MESSAGE_DELIVERY_STATE.UNKNOWN: return "التسليم غير مؤكد";
    // Honest labels only — Phase 7 never persists these states from handoff.
    case MESSAGE_DELIVERY_STATE.DELIVERED: return "تسليم مؤكد من المزود فقط";
    case MESSAGE_DELIVERY_STATE.READ: return "قراءة مؤكدة من المزود فقط";
    default: return "التسليم غير مؤكد";
  }
}
