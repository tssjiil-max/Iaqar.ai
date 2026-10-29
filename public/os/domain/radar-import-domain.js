/** Android OfficeExport v1 -> internal scout feed. No account access or network. */
export const RADAR_LIMITS = Object.freeze({ bytes: 200000, items: 20, text: 4000 });
const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const positive = v => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e10 ? v : 0;
const fail = message => { throw new Error(message); };
export function parseRadarExport(input, { includeContacts = false } = {}) {
  let value = input;
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).length > RADAR_LIMITS.bytes) fail('ملف الرادار أكبر من الحد المسموح (200 كيلوبايت).');
    try { value = JSON.parse(input); } catch { fail('ملف JSON غير صالح.'); }
  }
  const rows = Array.isArray(value) ? value : [value];
  if (!rows.length || rows.length > RADAR_LIMITS.items) fail('اختر من إعلان واحد إلى 20 إعلانًا.');
  const items = rows.map(raw => {
    if (!raw || typeof raw !== 'object' || raw.schemaVersion !== 1) fail('يلزم تصدير رادار الوسيط بالإصدار 1.');
    const sourceId = str(raw.listingId, 160), originalText = str(raw.originalText, RADAR_LIMITS.text);
    if (!sourceId || !originalText || typeof raw.originalText !== 'string' || raw.originalText.length > RADAR_LIMITS.text) fail('الإعلان بلا معرّف أو نص، أو نصه أطول من الحد المسموح.');
    const kind = ({'عرض':'OFFER','طلب':'REQUEST'})[raw.intent];
    if (!kind) fail('تعذر تحديد هل الإعلان عرض أم طلب.');
    const contacts = includeContacts && Array.isArray(raw.contacts) ? raw.contacts.slice(0, 20).flatMap(c => {
      const phone = str(c?.phone, 20);
      return /^(?:\+?966|0)?5\d{8}$/.test(phone) ? [{phone, role:str(c.role,40), source:str(c.source,60)}] : [];
    }) : [];
    const structured = {kind, tx:['إيجار','تأجير','استئجار'].includes(raw.operation)?'rent':['بيع','شراء'].includes(raw.operation)?'sale':'', propertyType:str(raw.category,40), city:raw.cityBasis === 'assumed_default'?'':str(raw.city,60),district:str(raw.district,60),price:positive(raw.price),area:positive(raw.areaSqm)};
    return {sourceId,originalText,structured,contacts,capturedAt:positive(raw.capturedAt),cityAssumed:raw.cityBasis === 'assumed_default'};
  });
  return {items};
}
