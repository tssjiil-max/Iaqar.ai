/**
 * Budget and price ranges written in Arabic, shared by every reader of requests (public page, office smart fill,
 * WhatsApp agent, inventory enquiries):
 *   «من 2,500,000 إلى 3,500,000» · «بين 2.5 و 3.5 مليون» · «2.5 - 3.5 مليون» · «من مليونين ونص إلى 3 ملايين»
 *   «لا تزيد عن 3 ملايين» (maximum only) · «لا تقل عن مليون» (minimum only)
 * The lower bound is never turned into the maximum, and an area («500 متر») is never read as money.
 * Returns { min, max } (either may be 0 when only one side is written) or null. No DOM, no network.
 */
const latin = (value) => String(value ?? "")
  .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
  .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
  .replace(/٫/g, ".").replace(/٬/g, ",");
const norm = (value) => latin(value).replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ـ/g, "")
  .replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/\s+/g, " ");

const UNIT = "(مليون|ملايين|الف|الاف|k|m)";
const WORDS = [[/^مليونين(?:\s*و\s*(?:نص|نصف))?$/, (m) => (/نص/.test(m) ? 2_500_000 : 2_000_000)], [/^مليون(?:\s*و\s*(?:نص|نصف))?$/, (m) => (/نص/.test(m) ? 1_500_000 : 1_000_000)],
  [/^(?:ثلاث|ثلاثه)\s+ملايين$/, () => 3_000_000], [/^(?:اربع|اربعه)\s+ملايين$/, () => 4_000_000], [/^(?:خمس|خمسه)\s+ملايين$/, () => 5_000_000]];
const AMOUNT = `(\\d+(?:\\.\\d+)?\\s*${UNIT}?(?:\\s*و\\s*(?:نص|نصف))?|مليونين(?:\\s*و\\s*(?:نص|نصف))?|مليون(?:\\s*و\\s*(?:نص|نصف))?|(?:ثلاث|ثلاثه|اربع|اربعه|خمس|خمسه)\\s+ملايين)`;
const AREA_AFTER = /^\s*(?:م2|م²|متر|مترمربع|م\b|مربع)/;
const MONEY_CONTEXT = /(ميزاني|سعر|بسعر|حدود|ريال|ر\.?س|مليون|ملايين|الف|الاف|السوم|قيمه|المبلغ)/;

/** One written amount → riyals; `inherit` is the unit of the other side of a range («2.5 إلى 3.5 مليون»). */
function value(raw, inherit = "") {
  const text = String(raw || "").trim();
  for (const [re, fn] of WORDS) if (re.test(text)) return fn(text);
  const m = text.match(new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*${UNIT}?(\\s*و\\s*(?:نص|نصف))?$`, "i"));
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2] || (n < 1000 ? inherit : "");
  const big = /مليون|ملايين|^m$/i.test(unit);
  const k = /الف|الاف|^k$/i.test(unit);
  const total = n * (big ? 1_000_000 : k ? 1000 : 1) + (m[3] && big ? 500_000 : 0);
  return Math.round(total);
}
const unitOf = (raw) => (String(raw || "").match(new RegExp(UNIT, "i")) || [])[1] || (/مليون|ملايين/.test(raw) ? "مليون" : "");
// A budget is at least a thousand riyals once its unit is applied: «3 إلى 4 غرف» or «الدور 2 إلى 3» are never money.
const sane = (n) => n >= 1000 && n <= 10_000_000_000;
const COUNT_AFTER = /^\s*(?:غرف|غرفه|صالات|صاله|دورات|حمامات|ادوار|دور|طوابق|شقق|محلات)/;

export function priceRangeFrom(raw = "") {
  const text = norm(raw).replace(/(?:\+?966|00966)?0?5\d{8}/g, " ");
  const pair = [
    new RegExp(`(?:من|بين)\\s+${AMOUNT}\\s*(?:ريال\\s*)?(?:الى|الي|ل|لـ|حتى|-|–|و)\\s*${AMOUNT}`, "i"),
    new RegExp(`${AMOUNT}\\s*(?:-|–|الى|الي)\\s*${AMOUNT}`, "i")
  ];
  for (const re of pair) {
    const m = text.match(re);
    if (!m) continue;
    const after = text.slice(m.index + m[0].length);
    if (AREA_AFTER.test(after) || COUNT_AFTER.test(after)) continue;
    const around = text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 12);
    if (!MONEY_CONTEXT.test(around)) continue;
    const a = m[1], b = m[3];
    const lo = value(a, unitOf(b)), hi = value(b, unitOf(a));
    if (sane(lo) && sane(hi) && lo !== hi) return { min: Math.min(lo, hi), max: Math.max(lo, hi) };
  }
  const max = text.match(new RegExp(`(?:لا\\s*(?:يزيد|تزيد|يتجاوز|تتجاوز)\\s*عن|حد\\s*اقصى|كحد\\s*اقصى|بحد\\s*اقصى|ما\\s*يتعدى)\\s*${AMOUNT}`, "i"));
  if (max && !AREA_AFTER.test(text.slice(max.index + max[0].length)) && MONEY_CONTEXT.test(text.slice(max.index, max.index + max[0].length + 12)) && sane(value(max[1]))) return { min: 0, max: value(max[1]) };
  const min = text.match(new RegExp(`(?:لا\\s*(?:يقل|تقل)\\s*عن|حد\\s*ادنى|كحد\\s*ادنى|من)\\s*${AMOUNT}\\s*(?:ريال|ر\\.?س)?\\s*(?:وفوق|فما\\s*فوق|واكثر|فاكثر)?`, "i"));
  if (min && /وفوق|فما\s*فوق|واكثر|فاكثر|لا\s*(?:يقل|تقل)|حد\s*ادنى/.test(min[0]) && !AREA_AFTER.test(text.slice(min.index + min[0].length))
    && MONEY_CONTEXT.test(text.slice(Math.max(0, min.index - 20), min.index + min[0].length + 12)) && sane(value(min[1]))) return { min: value(min[1]), max: 0 };
  return null;
}

/** «من 2,500,000 إلى 3,500,000 ريال» / «حتى 3,500,000 ريال» / «من 2,500,000 ريال فأكثر» — for summaries. */
export function priceRangeLabel({ min = 0, max = 0 } = {}, format = (n) => Number(n).toLocaleString("en-US")) {
  const lo = Number(min) > 0 ? Number(min) : 0, hi = Number(max) > 0 ? Number(max) : 0;
  if (lo && hi) return `من ${format(lo)} إلى ${format(hi)} ريال`;
  if (hi) return `حتى ${format(hi)} ريال`;
  if (lo) return `من ${format(lo)} ريال فأكثر`;
  return "";
}
