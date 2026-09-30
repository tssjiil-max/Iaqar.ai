/** Small, side-effect-free helpers for the one-person office profile. */
function clean(value, max = 120) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

export function officeDisplayName(office = {}, member = {}) {
  const raw = clean(office.officeName, 80);
  const broker = clean(office.brokerName || member.displayName || member.name, 80);
  const first = broker.split(" ")[0] || "";
  if (!raw) return first ? `مكتب ${first} العقاري` : "المكتب العقاري";
  if (/مكتب|عقار/.test(raw)) return raw;
  if (first && raw === first) return `مكتب ${raw} العقاري`;
  return raw;
}

export function officeProfileValues(office = {}) {
  return {
    officeName: clean(office.officeName, 80),
    brokerName: clean(office.brokerName, 80),
    phone: clean(office.phone, 20),
    whatsapp: clean(office.whatsapp, 20),
    licenseNumber: clean(office.licenseNumber, 80),
    city: clean(office.city, 60)
  };
}

export function officeProfilePatch(input = {}) {
  const values = officeProfileValues(input);
  if (values.officeName.length < 2) throw new Error("اكتب اسم المكتب");
  if (values.brokerName.length < 2) throw new Error("اكتب اسم الوسيط");
  return {
    ...values,
    officeNameKey: values.officeName.toLowerCase()
  };
}
