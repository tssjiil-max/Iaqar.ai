/**
 * Phase 7 — Smart message templates + adapter contracts + draft builders.
 * Drafts only. Never auto-send. Never claim delivery without provider confirmation.
 */

export const MESSAGE_CHANNELS = Object.freeze({
  WHATSAPP: "whatsapp",
  TELEGRAM: "telegram"
});

export const MESSAGE_SEND_STATE = Object.freeze({
  DRAFT: "DRAFT",
  READY: "READY",
  OPENED_EXTERNAL: "OPENED_EXTERNAL",
  // SENT / FAILED reserved for real provider paths — not set by wa.me / t.me handoff.
  SENT: "SENT",
  FAILED: "FAILED"
});

export const MESSAGE_DELIVERY_STATE = Object.freeze({
  NOT_APPLICABLE: "NOT_APPLICABLE",
  UNKNOWN: "UNKNOWN",
  // DELIVERED / READ require real provider confirmation — never set in Phase 7 handoff.
  DELIVERED: "DELIVERED",
  READ: "READ"
});

export const ADAPTER_STATUS = Object.freeze({
  WHATSAPP_ADAPTER_READY: "adapter_ready",
  TELEGRAM_ADAPTER_SIMULATED: "simulated",
  OUTBOUND_CLOUD_API_DISABLED: "outbound_disabled"
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

/** Map workflow stage / role / mode into a template code. */
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

export function phase7BoundaryGuarantees() {
  return {
    createsSmartMessageDraft: true,
    persistsMessageDraft: true,
    sendsWhatsApp: false,
    sendsTelegram: false,
    autoSendsMessages: false,
    claimsFakeDelivery: false,
    cloudApiOutboundEnabled: false,
    whatsappAdapterStatus: ADAPTER_STATUS.WHATSAPP_ADAPTER_READY,
    telegramAdapterStatus: ADAPTER_STATUS.TELEGRAM_ADAPTER_SIMULATED,
    addsDealsPage: false,
    addsBottomNavigation: false
  };
}

export function normalizeChannel(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === MESSAGE_CHANNELS.TELEGRAM) return MESSAGE_CHANNELS.TELEGRAM;
  return MESSAGE_CHANNELS.WHATSAPP;
}

/** Normalize Saudi mobile numbers for wa.me; invalid shapes return "". */
export function whatsappDigits(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (/^009665\d{8}$/.test(digits)) return digits.slice(2);
  if (/^9665\d{8}$/.test(digits)) return digits;
  if (/^05\d{8}$/.test(digits)) return `966${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) return `966${digits}`;
  return "";
}

export function buildArabicMessageBody({
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
} = {}) {
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
  if (!digits) return { ok: false, error: "phone_required", adapterStatus: ADAPTER_STATUS.WHATSAPP_ADAPTER_READY };
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(String(body || ""))}`;
  return {
    ok: true,
    channel: MESSAGE_CHANNELS.WHATSAPP,
    url,
    adapterStatus: ADAPTER_STATUS.WHATSAPP_ADAPTER_READY,
    // Opening an external app is not a provider send confirmation.
    impliesSent: false,
    impliesDelivered: false
  };
}

export function buildTelegramHandoffUrl({ body = "", shareUrl = "https://iaqar.ai/" } = {}) {
  // Simulated / adapter-ready: Telegram share URL for broker handoff.
  // Does not call Telegram Bot API and does not claim delivery.
  const url = `https://t.me/share/url?url=${encodeURIComponent(String(shareUrl))}&text=${encodeURIComponent(String(body || ""))}`;
  return {
    ok: true,
    channel: MESSAGE_CHANNELS.TELEGRAM,
    url,
    adapterStatus: ADAPTER_STATUS.TELEGRAM_ADAPTER_SIMULATED,
    impliesSent: false,
    impliesDelivered: false
  };
}

export async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function messageDraftId({
  officeId,
  channel,
  operationId = "",
  matchId = "",
  opportunityId = "",
  recipientRole = "",
  templateCode = "",
  body = ""
}) {
  const hex = await sha256Hex([
    officeId, channel, operationId, matchId, opportunityId,
    recipientRole, templateCode, body.slice(0, 120)
  ].join("|"));
  return `msg_${hex.slice(0, 40)}`;
}

/**
 * Build a persisted draft. sendState starts as DRAFT.
 * deliveryState is NOT_APPLICABLE for external handoff channels.
 */
export async function buildMessageDraft({
  officeId,
  brokerId = "",
  channel = MESSAGE_CHANNELS.WHATSAPP,
  templateCode = TEMPLATE_CODES.GENERIC_CONTACT,
  body = "",
  recipientRole = "client",
  recipientName = "",
  recipientPhone = "",
  operationId = "",
  matchId = "",
  opportunityId = "",
  now = new Date()
} = {}) {
  const safeChannel = normalizeChannel(channel);
  const text = String(body || "").trim();
  if (!officeId) return { ok: false, error: "office_id_required" };
  if (!text) return { ok: false, error: "body_required" };

  const id = await messageDraftId({
    officeId,
    channel: safeChannel,
    operationId,
    matchId,
    opportunityId,
    recipientRole,
    templateCode,
    body: text
  });

  const handoff = safeChannel === MESSAGE_CHANNELS.TELEGRAM
    ? buildTelegramHandoffUrl({ body: text })
    : buildWhatsAppHandoffUrl({ phone: recipientPhone, body: text });

  return {
    ok: true,
    draft: {
      id,
      officeId: String(officeId),
      brokerId: String(brokerId || ""),
      channel: safeChannel,
      templateCode: String(templateCode || TEMPLATE_CODES.GENERIC_CONTACT),
      body: text.slice(0, 4000),
      recipientRole: String(recipientRole || ""),
      recipientName: String(recipientName || "").slice(0, 120),
      // Store phone only when needed for WhatsApp handoff; never expose in push previews.
      recipientPhone: safeChannel === MESSAGE_CHANNELS.WHATSAPP
        ? whatsappDigits(recipientPhone)
        : "",
      operationId: String(operationId || ""),
      matchId: String(matchId || ""),
      opportunityId: String(opportunityId || ""),
      sendState: MESSAGE_SEND_STATE.DRAFT,
      deliveryState: MESSAGE_DELIVERY_STATE.NOT_APPLICABLE,
      failureReason: "",
      handoffUrl: handoff.ok ? handoff.url : "",
      adapterStatus: handoff.adapterStatus
        || (safeChannel === MESSAGE_CHANNELS.TELEGRAM
          ? ADAPTER_STATUS.TELEGRAM_ADAPTER_SIMULATED
          : ADAPTER_STATUS.WHATSAPP_ADAPTER_READY),
      openedExternalAt: null,
      sentAt: null,
      deliveredAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      schemaVersion: 1,
      createdBySystem: false,
      // Honesty flags persisted with the draft.
      autoSend: false,
      providerConfirmedSend: false,
      providerConfirmedDelivery: false
    },
    boundaries: phase7BoundaryGuarantees()
  };
}

/** Opening an external handoff URL must not mark SENT or DELIVERED. */
export function applyExternalHandoff(draft, { now = new Date() } = {}) {
  if (!draft) return { ok: false, error: "missing_draft" };
  if (draft.sendState === MESSAGE_SEND_STATE.SENT) {
    return { ok: false, error: "already_sent_by_provider" };
  }
  return {
    ok: true,
    patch: {
      sendState: MESSAGE_SEND_STATE.OPENED_EXTERNAL,
      deliveryState: MESSAGE_DELIVERY_STATE.NOT_APPLICABLE,
      openedExternalAt: now.toISOString(),
      updatedAt: now.toISOString(),
      providerConfirmedSend: false,
      providerConfirmedDelivery: false
    }
  };
}

/** Only a real provider confirmation path may set SENT — Phase 7 has none enabled. */
export function applyProviderSendResult(draft, { confirmed = false, failureReason = "" } = {}) {
  if (!draft) return { ok: false, error: "missing_draft" };
  if (!confirmed) {
    return {
      ok: true,
      patch: {
        sendState: MESSAGE_SEND_STATE.FAILED,
        failureReason: String(failureReason || "provider_send_not_confirmed").slice(0, 200),
        providerConfirmedSend: false,
        providerConfirmedDelivery: false,
        updatedAt: new Date().toISOString()
      }
    };
  }
  return {
    ok: true,
    patch: {
      sendState: MESSAGE_SEND_STATE.SENT,
      sentAt: new Date().toISOString(),
      providerConfirmedSend: true,
      // Delivery still unknown until a real delivery receipt arrives.
      deliveryState: MESSAGE_DELIVERY_STATE.UNKNOWN,
      providerConfirmedDelivery: false,
      updatedAt: new Date().toISOString()
    }
  };
}

export function telegramWebhookValidationFixture() {
  return {
    adapterStatus: ADAPTER_STATUS.TELEGRAM_ADAPTER_SIMULATED,
    requiresSecretTokenHeader: true,
    headerName: "X-Telegram-Bot-Api-Secret-Token",
    outboundEnabled: false,
    inboundEnabled: false,
    note: "Structure only — no production Telegram bot credentials in Phase 7."
  };
}

export function whatsappAdapterContract() {
  return {
    adapterStatus: ADAPTER_STATUS.WHATSAPP_ADAPTER_READY,
    inboundCloudApi: true,
    outboundCloudApi: false,
    brokerHandoff: "wa.me",
    outboundGuard: "paths containing messages|send return 403 outbound_disabled",
    neverAutoSend: true,
    neverFakeDelivery: true
  };
}
