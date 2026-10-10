/** Optional external participant metadata. Claims never constitute verification. */
export const EXTERNAL_BROKER = "EXTERNAL_BROKER";
export const isExternalBroker = (record = {}) => record.submitterRole === EXTERNAL_BROKER;
export const cooperationEligible = (record = {}) => !isExternalBroker(record) ||
  (record.representationStatus === "VERIFIED" && record.cooperationStatus === "ACCEPTED");
export function externalBrokerClaim(input = {}) {
  if (!isExternalBroker(input)) return { ok: true, value: {} , errors: {} };
  const text = (value, max) => String(value ?? "").trim().slice(0, max);
  const claim = text(input.representationClaim, 20);
  const errors = {};
  const allowed = input.kind === "owner" ? ["OWNER", "NOT_AUTHORIZED"] : ["BUYER", "TENANT"];
  if (!allowed.includes(claim)) errors.representationClaim = "حدد صفة التمثيل";
  const purpose = String(input.purpose || "").toUpperCase();
  if ((purpose === "PURCHASE" && claim !== "BUYER") || (purpose === "LEASE_REQUEST" && claim !== "TENANT")) errors.representationClaim = "صفة التمثيل لا تتوافق مع غرض الطلب";
  const license = text(input.externalBrokerLicense, 40);
  if (license && !/^\d{5,40}$/.test(license)) errors.externalBrokerLicense = "تحقق من رقم رخصة فال";
  return { ok: !Object.keys(errors).length, errors, value: {
    submitterRole: EXTERNAL_BROKER,
    externalBrokerOffice: text(input.externalBrokerOffice, 100),
    externalBrokerLicense: license,
    representationClaim: claim,
    representationReference: text(input.representationReference, 240),
    representationStatus: "PENDING", cooperationStatus: "REQUESTED", commissionStatus: "NONE",
    contactType: "broker", advertiserRole: "BROKER"
  } };
}
