function text(value) {
  return String(value ?? "").trim();
}

function value(source, keys) {
  for (const key of keys) {
    const candidate = source?.[key];
    if (candidate !== undefined && candidate !== null && text(candidate)) return candidate;
  }
  return "";
}

export function negotiationPropertyFacts(property = {}) {
  const type = text(property.propertyType).toLowerCase();
  const common = [
    ["نوع العقار", value(property, ["propertyType"])],
    ["الغرض", value(property, ["purposeLabel", "purpose"])],
    ["الموقع", value(property, ["district", "city"])],
    ["السعر", value(property, ["priceLabel", "salePrice", "rentPrice", "priceOrBudget"])],
    ["المساحة", value(property, ["areaLabel", "area", "areaSqm"])],
    ["الواجهة", value(property, ["facade", "facing"])],
    ["الشارع", value(property, ["streetWidthLabel", "streetWidth"])]
  ];
  const typed = type.includes("أرض") || type.includes("land")
    ? [["نوع الاستخدام", value(property, ["usage", "landUse", "description"])] ]
    : type.includes("شقة") || type.includes("apartment")
      ? [
        ["الغرف", value(property, ["rooms", "bedrooms"])],
        ["دورات المياه", value(property, ["bathrooms"])],
        ["الدور", value(property, ["floorNumber", "floor"])],
        ["المواقف", value(property, ["parking"])],
        ["المصعد", value(property, ["elevator"])]
      ]
      : type.includes("فيلا") || type.includes("villa")
        ? [
          ["الغرف", value(property, ["rooms", "bedrooms"])],
          ["الأدوار", value(property, ["floors"])],
          ["المواقف", value(property, ["parking"])],
          ["العمر", value(property, ["propertyAge", "age"])]
        ]
        : [
          ["الغرف", value(property, ["rooms", "bedrooms"])],
          ["الأدوار", value(property, ["floors"])],
          ["المواقف", value(property, ["parking"])]
        ];
  return [...common, ...typed]
    .filter(([, fact]) => fact !== "")
    .map(([label, fact]) => ({ label, value: text(fact) }));
}

function agreementState(status, label, detail = "") {
  return { key: status, label, detail: text(detail) };
}

export function negotiationAgreementSummary({ coordination = {}, appointment = {}, match = {} } = {}) {
  const client = coordination.clientBundle || {};
  const owner = coordination.ownerBundle || {};
  const outcome = text(coordination.outcome).toUpperCase();
  const rows = [];
  rows.push({
    id: "availability",
    title: "توفر العقار",
    ...agreementState(
      owner.propertyAvailability === "not_available" ? "needs_negotiation" : owner.propertyAvailability ? "agreed" : "waiting",
      owner.propertyAvailability === "not_available" ? "غير متاح" : owner.propertyAvailability ? "متفق عليه" : "بانتظار المالك"
    )
  });
  const priceAgreed = ["PRICE_ALIGNED", "AGREEMENT_READY", "NEGOTIATION_READY"].includes(outcome)
    || owner.negotiationDecision === "accept" || client.negotiationResponse === "accept";
  const priceConflict = owner.negotiationDecision === "reject" || client.negotiationResponse === "reject";
  rows.push({
    id: "price",
    title: "السعر والمرونة",
    ...agreementState(priceAgreed ? "agreed" : priceConflict ? "needs_negotiation" : "waiting", priceAgreed ? "متفق عليه" : priceConflict ? "يحتاج تفاوض" : "بانتظار الطرف الآخر")
  });
  const confirmedDetails = Array.isArray(owner.detailConfirmations) ? owner.detailConfirmations.length : 0;
  rows.push({
    id: "details",
    title: "المعلومات المؤكدة",
    ...agreementState(confirmedDetails ? "agreed" : client.requestedDetailKeys?.length ? "waiting" : "waiting", confirmedDetails ? `${confirmedDetails} معلومة مؤكدة` : "بانتظار التأكيد")
  });
  const appointmentPhase = text(appointment.phase).toLowerCase();
  rows.push({
    id: "viewing",
    title: "المعاينة والموعد",
    ...agreementState(appointmentPhase === "confirmed" ? "agreed" : appointmentPhase && appointmentPhase !== "none" ? "waiting" : "waiting", appointmentPhase === "confirmed" ? "موعد مؤكد" : "بانتظار التنسيق")
  });
  if (text(match.viewingCompletedAt) || text(match.livingStage).toUpperCase() === "VIEWING_COMPLETED") {
    rows.push({ id: "viewing_completed", title: "نتيجة المعاينة", ...agreementState("agreed", "تمت المعاينة") });
  }
  return rows;
}

export function brokerNegotiationActions({ propertyType = "", purpose = "", stage = "", outcome = "" } = {}) {
  const rows = [
    "طلب توضيح معلومة",
    "السعر يحتاج مراجعة",
    "اقترح حلًا وسطًا",
    "تنسيق معاينة",
    "الموعد يحتاج إعادة جدولة",
    "بانتظار قرار المالك",
    "بانتظار قرار العميل",
    "الطرفان متفقان مبدئيًا",
    "تمت المعاينة",
    "يوجد جدية",
    "لا يوجد اتفاق"
  ];
  const context = [propertyType, purpose, stage, outcome].map((item) => text(item).toLowerCase()).join(" ");
  if (context.includes("viewing") || context.includes("معاينة")) return rows.slice(3);
  if (context.includes("price") || context.includes("سعر") || context.includes("negotiation")) return rows.slice(1);
  return rows;
}

export function negotiationManagementBoundaryGuarantees() {
  return {
    areaRequired: false,
    hidesEmptyPropertyFacts: true,
    keepsOneSessionPerMatch: true,
    exposesContactDetails: false,
    viewingCompletionClosesDeal: false,
    seriousIntentRequiredForDeal: true,
    dealStageSkippingAllowed: false,
    closesMatchWithoutDeletingOpportunities: true
  };
}
