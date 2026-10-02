/**
 * التعاون بين الوسطاء — brokers per cooperation and the commission agreement.
 * Pure rules shared by the Worker (enforcement) and Office OS (display). Never trust the UI alone:
 * the Worker calls the same functions before it writes.
 *
 * One cooperation = one opportunity. Default two brokers (وسيط العرض ↔ وسيط الطلب); a third,
 * «وسيط مشارك», may be added only inside an active cooperation. Hard maximum: three. No fourth.
 */

export const DEFAULT_BROKERS_PER_COOPERATION = 2;
export const HARD_MAX_BROKERS_PER_COOPERATION = 3;

export const BROKER_ROLE = Object.freeze({
  PROPERTY_BROKER: "PROPERTY_BROKER",
  REQUEST_BROKER: "REQUEST_BROKER",
  PARTICIPATING_BROKER: "PARTICIPATING_BROKER"
});

export const BROKER_ROLE_LABELS = Object.freeze({
  PROPERTY_BROKER: "وسيط العرض",
  REQUEST_BROKER: "وسيط الطلب",
  PARTICIPATING_BROKER: "وسيط مشارك"
});

export const MAX_BROKERS_MESSAGE = "تم الوصول للحد الأعلى للتعاون";

const text = (value) => String(value ?? "").trim();
const lower = (value) => text(value).toLowerCase();
const upper = (value) => text(value).toUpperCase();

/** Which office/broker plays which side. Falls back to origin/target when roles were never stored. */
export function resolveCooperationSides(record = {}) {
  const origin = text(record.originatingOfficeId);
  const target = text(record.targetOfficeId);
  const propertyOfficeId = text(record.propertyOfficeId) || origin;
  const clientOfficeId = text(record.clientOfficeId) || (propertyOfficeId === origin ? target : origin);
  const brokerOf = (officeId) => (lower(officeId) === lower(origin) ? text(record.originatingBrokerId) : text(record.targetBrokerId));
  return {
    propertyOfficeId,
    clientOfficeId,
    propertyBrokerId: brokerOf(propertyOfficeId),
    requestBrokerId: brokerOf(clientOfficeId)
  };
}

export function hasParticipatingBroker(record = {}) {
  return Boolean(text(record.participatingBrokerId));
}

/** Always counts both principal brokers (they exist as soon as the cooperation does) plus the optional third. */
export function cooperationBrokerCount(record = {}) {
  return DEFAULT_BROKERS_PER_COOPERATION + (hasParticipatingBroker(record) ? 1 : 0);
}

/** Roles shown on the cooperation: names only where it is the viewer's own side or the participating broker. */
export function cooperationBrokers(record = {}, { officeId = "" } = {}) {
  const sides = resolveCooperationSides(record);
  const rows = [
    { role: BROKER_ROLE.PROPERTY_BROKER, officeId: sides.propertyOfficeId, uid: sides.propertyBrokerId },
    { role: BROKER_ROLE.REQUEST_BROKER, officeId: sides.clientOfficeId, uid: sides.requestBrokerId }
  ];
  if (hasParticipatingBroker(record)) {
    rows.push({ role: BROKER_ROLE.PARTICIPATING_BROKER, officeId: text(record.participatingBrokerOfficeId), uid: text(record.participatingBrokerId), name: text(record.participatingBrokerName) });
  }
  return rows.map((row) => ({ ...row, label: BROKER_ROLE_LABELS[row.role], mine: lower(row.officeId) === lower(officeId) }));
}

export function isCooperationActive(record = {}) {
  return upper(record.status) === "ACCEPTED" && !["COMPLETED", "REJECTED"].includes(upper(record.currentStage));
}

export function isCooperationParty(record = {}, officeId = "") {
  const id = lower(officeId);
  return Boolean(id) && (id === lower(record.originatingOfficeId) || id === lower(record.targetOfficeId));
}

/** May `officeId` add `brokerId` as the third («مشارك») broker right now? */
export function canAddParticipatingBroker(record = {}, { officeId = "", brokerId = "" } = {}) {
  if (!isCooperationParty(record, officeId)) return { ok: false, error: "cooperation_forbidden", status: 403, message: "هذا المكتب ليس طرفًا في التعاون." };
  if (!isCooperationActive(record)) return { ok: false, error: "cooperation_not_active", status: 409, message: "يمكن إضافة وسيط مشارك داخل التعاون النشط فقط." };
  const id = text(brokerId);
  if (!id) return { ok: false, error: "broker_required", status: 400, message: "اختر الوسيط المشارك." };
  if (hasParticipatingBroker(record)) {
    if (text(record.participatingBrokerId) === id) return { ok: true, duplicate: true };
    return { ok: false, error: "max_brokers", status: 409, message: MAX_BROKERS_MESSAGE };
  }
  if (cooperationBrokerCount(record) >= HARD_MAX_BROKERS_PER_COOPERATION) return { ok: false, error: "max_brokers", status: 409, message: MAX_BROKERS_MESSAGE };
  const sides = resolveCooperationSides(record);
  if (id === sides.propertyBrokerId || id === sides.requestBrokerId) {
    return { ok: false, error: "already_in_cooperation", status: 409, message: "هذا الوسيط طرف في التعاون أصلًا." };
  }
  return { ok: true };
}

/* ───────────── اتفاق التعاون (نسب العمولة) ───────────── */

export const COMMISSION_KEYS = Object.freeze(["propertyBrokerShare", "requestBrokerShare", "participatingBrokerShare"]);

/** Starting point only — editable and agreed between the brokers; not a legal rule. */
export function defaultCommission(brokerCount = DEFAULT_BROKERS_PER_COOPERATION) {
  return brokerCount >= 3
    ? { propertyBrokerShare: 40, requestBrokerShare: 40, participatingBrokerShare: 20 }
    : { propertyBrokerShare: 50, requestBrokerShare: 50, participatingBrokerShare: 0 };
}

/** The last agreed shares, or the default for this many brokers. */
export function readCommission(record = {}) {
  const count = cooperationBrokerCount(record);
  const stored = COMMISSION_KEYS.map((key) => record[key]);
  if (stored.slice(0, 2).every((v) => Number.isFinite(Number(v)) && v !== "" && v != null)) {
    return {
      propertyBrokerShare: Number(stored[0]),
      requestBrokerShare: Number(stored[1]),
      participatingBrokerShare: count >= 3 ? Number(stored[2] || 0) : 0,
      agreed: true
    };
  }
  return { ...defaultCommission(count), agreed: false };
}

/** Whole percents only; the total must be exactly 100; the third share exists only with a third broker. */
export function validateCommission(input = {}, brokerCount = DEFAULT_BROKERS_PER_COOPERATION) {
  const shares = {};
  for (const key of COMMISSION_KEYS) {
    const raw = input[key];
    const n = raw === "" || raw == null ? 0 : Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      return { ok: false, error: "invalid_share", message: "النسبة رقم صحيح من 0 إلى 100." };
    }
    shares[key] = n;
  }
  if (brokerCount < 3 && shares.participatingBrokerShare !== 0) {
    return { ok: false, error: "no_participating_broker", message: "لا يوجد وسيط مشارك لتخصيص نسبة له." };
  }
  const total = shares.propertyBrokerShare + shares.requestBrokerShare + shares.participatingBrokerShare;
  if (total !== 100) return { ok: false, error: "shares_sum", message: `مجموع النسب يجب أن يكون 100% (الآن ${total}%).` };
  return { ok: true, shares };
}
