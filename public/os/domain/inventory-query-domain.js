/** Partial inventory enquiries: unspecified constraints stay unspecified. */
import { extractFacts } from './visitor-domain.js';
import { priceRangeFrom } from './price-range-domain.js';
/** The district name only: «درة العقيق أو الأحياء القريبة» → «درة العقيق»; «درة العقيق من 2.5 …» → «درة العقيق». */
const districtOnly = (text) => String(text || '').split(/\s+(?:او|أو|والاحياء|والأحياء|و\s+الاحياء|و\s+الأحياء|من\s+[\d٠-٩]|بين|ب\s*[\d٠-٩]|[\d٠-٩])/)[0].trim();
const normalize = text => String(text || '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
export const normalizeInventoryDistrict = text => normalize(text).replace(/^(?:في\s+)?(?:حي|مخطط)\s+/, '');
export function inventoryInquiry(text = '') {
 const value = String(text).trim();
 if (/عندي|لدي|أملك|املك|عرضي/.test(value)) return null;
 if (!/(?:وش|اش|ايش|ماذا|عندك|عندكم|عروض|عمائر|اقل من|أقل من|تحت)/.test(value) || /(?:تفاصيل|صور|معاينه|معاينة|العرض\s*\d)/.test(value)) return null;
 const facts = extractFacts(value);
 if (/عمائر|عمارات/.test(value)) facts.propertyType = 'عمارة';
 const district = value.match(/(?:في\s+(?:(?:حي|مخطط)\s+)?|(?:حي|مخطط)\s+)([^؟?،,.!]+?)(?=\s+(?:بميزاني|بحدود|تحت|اقل|أقل|للبيع|للايجار|للإيجار)|[؟?،,.!]|$)/);
 const named = district ? districtOnly(district[1]) : '';
 if (named && !facts.city) facts.district = named;
 else if (named && !facts.district && normalize(named) !== normalize(facts.city)) facts.district = named;
 const money = value.replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).match(/(?:تحت|اقل من|أقل من|بحدود)\s*(\d+(?:\.\d+)?)\s*(ملايين|مليون|الف|ألف)?/);
 if (money) facts.price = Number(money[1]) * (/مليون|ملايين/.test(money[2] || '') ? 1e6 : /الف|ألف/.test(money[2] || '') ? 1e3 : 1);
 const range = priceRangeFrom(value);
 if (range?.max) facts.price = range.max;
 const criteria = {};
 for (const key of ['propertyType', 'city', 'district', 'price']) if (facts[key]) criteria[key] = facts[key];
 if (range?.min) criteria.priceMin = range.min;
 if (money && /تحت|اقل من|أقل من/.test(value)) criteria.priceExclusive = true;
 if (facts.transactionType) criteria.purpose = facts.transactionType === 'sale' ? 'PURCHASE' : 'LEASE_REQUEST';
 return Object.keys(criteria).length ? criteria : null;
}
