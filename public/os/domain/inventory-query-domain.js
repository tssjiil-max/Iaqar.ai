/** Partial inventory enquiries: unspecified constraints stay unspecified. */
import { extractFacts } from './visitor-domain.js';
const normalize = text => String(text || '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
export const normalizeInventoryDistrict = text => normalize(text).replace(/^(?:في\s+)?(?:حي|مخطط)\s+/, '');
export function inventoryInquiry(text = '') {
 const value = String(text).trim();
 if (/عندي|لدي|أملك|املك|عرضي/.test(value)) return null;
 if (!/(?:وش|اش|ايش|ماذا|عندك|عندكم|عروض|عمائر|اقل من|أقل من|تحت)/.test(value) || /(?:تفاصيل|صور|معاينه|معاينة|العرض\s*\d)/.test(value)) return null;
 const facts = extractFacts(value);
 if (/عمائر|عمارات/.test(value)) facts.propertyType = 'عمارة';
 const district = value.match(/(?:في\s+(?:(?:حي|مخطط)\s+)?|(?:حي|مخطط)\s+)([^؟?،,.!]+?)(?=\s+(?:بميزاني|بحدود|تحت|اقل|أقل|للبيع|للايجار|للإيجار)|[؟?،,.!]|$)/);
 if (district && !facts.city) facts.district = district[1].trim();
 else if (district && !facts.district && normalize(district[1]) !== normalize(facts.city)) facts.district = district[1].trim();
 const money = value.replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).match(/(?:تحت|اقل من|أقل من|بحدود)\s*(\d+(?:\.\d+)?)\s*(ملايين|مليون|الف|ألف)?/);
 if (money) facts.price = Number(money[1]) * (/مليون|ملايين/.test(money[2] || '') ? 1e6 : /الف|ألف/.test(money[2] || '') ? 1e3 : 1);
 const criteria = {};
 for (const key of ['propertyType', 'city', 'district', 'price']) if (facts[key]) criteria[key] = facts[key];
 if (money && /تحت|اقل من|أقل من/.test(value)) criteria.priceExclusive = true;
 if (facts.transactionType) criteria.purpose = facts.transactionType === 'sale' ? 'PURCHASE' : 'LEASE_REQUEST';
 return Object.keys(criteria).length ? criteria : null;
}
