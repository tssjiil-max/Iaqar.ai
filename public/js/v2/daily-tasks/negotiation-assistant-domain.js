/* Broker negotiation assistant: pure derived view-model. No writes, no matching mutations. */

const STAGES = Object.freeze([
  { id: "availability", label: "التوفر" },
  { id: "information", label: "المعلومات" },
  { id: "price", label: "السعر" },
  { id: "viewing", label: "المعاينة" },
  { id: "agreement", label: "الاتفاق" }
]);

function text(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function blob(task) {
  return [task.coordinationClientSummary, task.coordinationOwnerSummary, task.coordinationBrokerLine,
    ...(Array.isArray(task.timeline) ? task.timeline.map((e) => e?.label) : [])].map(text).join(" • ");
}

function percentFrom(value) {
  const match = text(value).match(/(?:^|\s)([0-9]+(?:\.[0-9]+)?)\s*%/);
  return match ? Number(match[1]) : null;
}

function priceGap(task = {}) {
  const client = Number.isFinite(Number(task.clientPriceAdjustmentPct)) ? Math.abs(Number(task.clientPriceAdjustmentPct)) : percentFrom(task.coordinationClientSummary);
  const owner = Number.isFinite(Number(task.ownerPriceAdjustmentPct)) ? Math.abs(Number(task.ownerPriceAdjustmentPct)) : percentFrom(task.coordinationOwnerSummary);
  if (!Number.isFinite(client) || !Number.isFinite(owner)) return null;
  return Math.max(0, Math.abs(client - owner));
}

function bothPartiesSerious(task = {}) {
  const all = blob(task);
  return /الطرفان جادان/.test(all) || (/جدي ونكمل/.test(all) && /موافق نكمل/.test(all));
}

function stageIndex(task = {}) {
  const stage = upper(task.livingStage || task.stage);
  const all = blob(task);
  if (stage === "COMPLETED" || /اتفاق/.test(all) || bothPartiesSerious(task)) return 4;
  if (["APPOINTMENT_COORDINATION", "APPOINTMENT_CONFIRMED", "VIEWING_COMPLETED", "FOLLOW_UP"].includes(stage) || /معاين/.test(all)) return 3;
  if (["PROPERTY_AVAILABLE", "VIEWING_DECISION"].includes(stage) || /السعر|%|حل وسط/.test(all)) return 2;
  if (["CLIENT_NEEDS_DETAILS", "CLIENT_NEEDS_MISSING_INFO", "CLIENT_INTERESTED", "WAITING_PROPERTY_CONFIRMATION"].includes(stage) || /معلوم|تفاصيل/.test(all)) return 1;
  return 0;
}

function clientStatus(task = {}) {
  const value = text(task.coordinationClientSummary);
  if (value) return value;
  const all = blob(task);
  if (/غير مهتم|غير مناسب/.test(all)) return "غير مهتم";
  if (/العميل.*جاد|العميل.*مهتم/.test(all)) return "مهتم";
  return "بانتظار الرد";
}

function ownerStatus(task = {}) {
  const value = text(task.coordinationOwnerSummary);
  if (value) return value;
  const all = blob(task);
  if (/غير متاح/.test(all)) return "العقار غير متاح";
  if (/العقار متاح|المالك.*موافق/.test(all)) return "العقار متاح";
  return "بانتظار الرد";
}

export function buildNegotiationAssistant(task = {}) {
  const current = stageIndex(task);
  const gap = priceGap(task);
  const outcome = upper(task.coordinationOutcome);
  const all = blob(task);
  const scheduleConflict = outcome === "SCHEDULE_CONFLICT" || /تعارض/.test(text(task.coordinationBrokerLine));
  const infoNeedsBroker = Boolean(text(task.missingInfoKey)) || /يحتاج (?:تحديث|تأكيد)|معلومة.*تأكيد/.test(all);
  const bothSerious = bothPartiesSerious(task);
  const priceNeedsBroker = Number.isFinite(gap) && gap > 0;

  let intervention = "";
  if (scheduleConflict) intervention = "يوجد تعارض في موعد المعاينة — نسّق موعدًا موحدًا";
  else if (priceNeedsBroker) intervention = `الفجوة المتبقية ${gap}% — اقترح حلًا وسطًا`;
  else if (infoNeedsBroker) intervention = "توجد معلومة تحتاج تأكيدًا قبل استمرار التفاوض";
  else if (bothSerious) intervention = "الطرفان جادان — ابدأ إجراءات اتفاق الوساطة/الصفقة";

  const summary = [
    ownerStatus(task),
    `العميل: ${clientStatus(task)}`,
    current >= 1 ? "المعلومات مؤكدة" : "المعلومات قيد التأكيد",
    Number.isFinite(gap) ? (gap > 0 ? `فرق السعر ${gap}%` : "السعر متوافق") : "السعر قيد التفاوض",
    scheduleConflict ? "يوجد تعارض في موعد المعاينة" : (current >= 3 ? "المعاينة قيد التنسيق" : "")
  ].filter(Boolean).join(" • ");

  return {
    stages: STAGES.map((stage, index) => ({ ...stage, state: index < current ? "done" : index === current ? "current" : "pending" })),
    currentStage: STAGES[current]?.id || "availability",
    clientStatus: clientStatus(task),
    ownerStatus: ownerStatus(task),
    priceGapPct: Number.isFinite(gap) ? gap : null,
    smartSummary: summary,
    interventionRequired: Boolean(intervention),
    interventionLine: intervention
  };
}

export const POST_VIEWING_CHOICES = Object.freeze({
  client: Object.freeze([
    { id: "serious_continue", label: "جدي ونكمل" },
    { id: "needs_negotiation", label: "أحتاج تفاوض" },
    { id: "not_interested", label: "غير مهتم" }
  ]),
  owner: Object.freeze([
    { id: "approve_continue", label: "موافق نكمل" },
    { id: "needs_negotiation", label: "أحتاج تفاوض" },
    { id: "not_interested", label: "غير مهتم" }
  ])
});
