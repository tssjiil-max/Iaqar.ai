/** Pure, offline completeness assessment. Never authorizes access to records. */
const FIELDS = Object.freeze([
  ['propertyType','نوع العقار',12],['operation','العملية',10],['city','المدينة',12],
  ['district','الحي',12],['price','السعر',16],['area','المساحة',14],
  ['source','المصدر',12],['updatedAt','تاريخ التحديث',12],
]);
const hasValue = (key, value) => {
  if (key === 'price' || key === 'area') return typeof value === 'number' && Number.isFinite(value) && value > 0;
  if (key === 'updatedAt') return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));
  return typeof value === 'string' && value.trim().length > 0;
};
export function assessListing(listing) {
  if (!listing || typeof listing !== 'object' || Array.isArray(listing)) throw new TypeError('listing must be an object');
  const missing = FIELDS.filter(([key]) => !hasValue(key, listing[key])).map(([key]) => key);
  const score = FIELDS.reduce((sum,[key,,weight]) => sum + (hasValue(key,listing[key]) ? weight : 0),0);
  const reasons = FIELDS.filter(([key]) => missing.includes(key)).map(([,label]) => `يلزم استكمال ${label}`);
  if (listing.approvalStatus !== 'approved') reasons.push('الإعلان غير معتمد');
  if (listing.availabilityStatus !== 'available') reasons.push('توفر العقار غير مؤكد');
  return {score, missing, reasons, canPublish: score===100 && listing.approvalStatus==='approved' && listing.availabilityStatus==='available'};
}
export function draftMissingInfoMessage(listing) {
  const {missing} = assessListing(listing);
  if (!missing.length) return 'السلام عليكم، نرجو تأكيد استمرار توفر العقار وصحة بياناته. شكرًا لكم.';
  const labels = FIELDS.filter(([key])=>missing.includes(key)).map(([,label])=>label);
  return `السلام عليكم، نرجو استكمال بيانات العقار التالية: ${labels.join('، ')}. شكرًا لكم.`;
}