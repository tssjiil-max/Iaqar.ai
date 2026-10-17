/**
 * Guest journey: write the request → see the best three real matches → choose one → continue with the office.
 * No account. Name, phone and consent are asked only after the client chooses a property.
 */
import { h, ic, clear, field, append, surface, pageHeader, feedback } from '../core/dom.js';
import { api, workerBase } from '../core/runtime.js';
import { runAction, openSheet } from '../core/ui.js';
import { formatNumber } from '../domain/format-domain.js';
import { PROPERTY_TYPES } from '../domain/records-domain.js';

const VIEWER_KEY = 'iaqar.guestInterestKey';
// Remembering this browser's own interest key (a hash, not a phone) only stops us telling a client
// that «others» are interested when it was them. Storage can be unavailable; search still works.
const readViewerKey = () => { try { const v = localStorage.getItem(VIEWER_KEY) || ''; return /^[a-f0-9]{32}$/.test(v) ? v : ''; } catch (_) { return ''; } };
const saveViewerKey = (v) => { try { if (/^[a-f0-9]{32}$/.test(v)) localStorage.setItem(VIEWER_KEY, v); } catch (_) { /* private mode */ } };

function resultCard(x, i, onChoose) {
 const meta = [x.city, x.rooms ? `${x.rooms} غرف` : '', x.area ? `${formatNumber(x.area)} م²` : ''].filter(Boolean).join(' · ');
 const reason = x.nearby
  ? `اقتراح قريب — مسافة خطية ${x.distanceKm} كم من الموقع المرجعي للحي`
  : (x.reasons || []).join(' · ');
 const choose = h('button', { type: 'button', class: 'os-btn primary block', 'data-choose-result': x.reference }, ic('check-circle'), 'مهتم بهذا العقار');
 choose.addEventListener('click', () => onChoose(x, i));
 return surface('article', { class: 'os-card os-guest-result', 'data-search-result': x.reference, 'data-listing-status': x.status || 'AVAILABLE' },
  x.imagePath ? h('img', { class: 'os-guest-result-photo', src: workerBase() + x.imagePath, alt: `${x.propertyType} في ${x.district}`, loading: 'lazy', onError: (event) => { event.target.hidden = true; } }) : null,
  h('div', { class: 'os-guest-result-head' },
   h('h3', { class: 'os-h2', text: `${i + 1}. ${x.propertyType} في ${x.district}` }),
   h('strong', { class: 'os-guest-result-price', text: `${formatNumber(x.price)} ريال` })),
  h('div', { class: 'os-guest-result-tags' },
   h('span', { class: `os-badge ${x.status === 'NEGOTIATING' ? 'late' : 'ok'}`, 'data-status-label': '', text: x.statusLabel || 'متاح' }),
   x.nearby ? h('span', { class: 'os-badge muted', text: 'حي قريب' }) : null),
  h('p', { class: 'os-sub', text: [x.officeName, meta].filter(Boolean).join(' · ') }),
  reason ? h('p', { class: 'os-field-note', text: reason }) : null,
  x.othersInterested ? feedback({ class: 'os-alert info', 'data-interest-notice': '', text: x.interestNotice }) : null,
  h('small', { class: 'os-sub', text: `مرجع العقار: ${x.reference}` }),
  h('button', { type: 'button', class: 'os-btn secondary block', 'data-result-details': x.reference, onClick: () => openSheet('تفاصيل العقار', h('div', { class: 'os-form' }, h('h3', { text: `${x.propertyType} في ${x.district}` }), h('p', { text: `${formatNumber(x.price)} ريال · ${meta}` }), reason ? h('p', { text: reason }) : null, h('p', { class: 'os-sub', text: `مرجع العقار: ${x.reference}` }), h('button', { type: 'button', class: 'os-btn primary block', onClick: () => onChoose(x, i) }, 'مهتم بهذا العقار'))) }, 'عرض التفاصيل'),
  choose);
}

/** Step 2 in a sheet: who the office should contact, by which channel, with explicit consent. */
function chooseSheet(x, i, searchToken) {
 const name = h('input', { class: 'os-input', name: 'contactName', autocomplete: 'name', placeholder: 'اسمك', required: true });
 const phone = h('input', { class: 'os-input', name: 'contactPhone', type: 'tel', inputmode: 'tel', dir: 'ltr', autocomplete: 'tel', placeholder: '05XXXXXXXX', required: true });
 const channel = h('select', { class: 'os-input', name: 'channel', required: true }, h('option', { value: 'whatsapp', text: 'واتساب' }), h('option', { value: 'telegram', text: 'تيليجرام' }));
 const processing = h('input', { type: 'checkbox', name: 'consentProcessing', required: true });
 const contact = h('input', { type: 'checkbox', name: 'consentContact', required: true });
 const status = feedback({ class: 'os-alert info', role: 'status', hidden: true });
 const submit = h('button', { type: 'submit', class: 'os-btn primary block', 'data-guest-select': '' }, ic('send'), 'تابع مع المكتب');
 const outcome = h('div', { 'data-guest-outcome': '' });
 const form = h('form', { class: 'os-form', 'data-guest-select-form': '', novalidate: true },
  h('p', { class: 'os-sub', text: `${i + 1}. ${x.propertyType} في ${x.district} — ${formatNumber(x.price)} ريال · ${x.officeName}` }),
  h('div', { class: 'os-row2' }, field('الاسم', name), field('رقم الجوال', phone)),
  field('كيف تحب نكمل؟', channel),
  h('div', { class: 'os-pref-list' },
   h('label', { class: 'os-pref-row' }, h('span', { text: 'أوافق على معالجة بياناتي لغرض هذا الطلب العقاري وإرسال اختياري للمكتب المسؤول.' }), processing),
   h('label', { class: 'os-pref-row' }, h('span', { text: 'أؤكد أن الرقم يخصني، وأوافق على التواصل معي بخصوص هذا العقار عبر القناة المختارة.' }), contact)),
  status, submit,
  h('p', { class: 'os-field-note', text: 'بياناتك تصل للمكتب المسؤول عن هذا العقار فقط، ولا تظهر لعملاء آخرين.' }));
 const { sheet } = openSheet('أكمل مع المكتب', h('div', {}, form, outcome));
 form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.hidden = true;
  if (!name.value.trim() || !phone.value.trim() || !processing.checked || !contact.checked) {
   status.className = 'os-alert bad os-feedback'; status.querySelector('.os-feedback-copy').textContent = 'اكتب اسمك ورقمك، ووافق على معالجة الطلب والتواصل.'; status.hidden = false; return;
  }
  await runAction(submit, async () => {
   const r = await api('/os/public/search/select', { searchToken, reference: x.reference, name: name.value, phone: phone.value, channel: channel.value, consentProcessing: true, consentContact: true }, { authenticated: false });
   saveViewerKey(r.viewerKey);
   form.hidden = true;
   clear(outcome);
   append(outcome,
    feedback({ class: 'os-alert ok', text: 'وصل اختيارك للمكتب المسؤول عن العقار.' }),
    r.othersInterested ? feedback({ class: 'os-alert info', 'data-interest-notice': '', text: r.interestNotice }) : null,
    r.contact.whatsappUrl ? h('a', { class: 'os-btn whatsapp block', href: r.contact.whatsappUrl, target: '_blank', rel: 'noopener', 'data-whatsapp-handoff': '' }, ic('whatsapp'), 'افتح واتساب وأرسل للمكتب') : null,
    r.contact.telegramLink ? h('a', { class: 'os-btn primary block', href: r.contact.telegramLink, target: '_blank', rel: 'noopener', 'data-telegram-handoff': '' }, ic('telegram'), 'ابدأ المحادثة في تيليجرام') : null,
    h('p', { class: 'os-field-note', 'data-contact-state': r.contact.state, text: r.contact.message }),
    h('p', { class: 'os-field-note', text: 'أي حجز أو سعر نهائي يعتمده المكتب.' }));
  }, { onError: (error) => { status.className = 'os-alert bad os-feedback'; status.querySelector('.os-feedback-copy').textContent = error.message; status.hidden = false; } });
 });
 requestAnimationFrame(() => sheet.querySelector('[name=contactName]')?.focus({ preventScroll: true }));
}

export function publicSearchForm(office = null, { initialText = '', notice = '', onRequest = null } = {}) {
 const id = office?.id || '';
 let analyzedText = null, requestKey = crypto.randomUUID();
 const description = h('textarea', { class: 'os-textarea', name: 'description', rows: '3', maxlength: '4000', placeholder: 'أبحث عن فيلا للبيع في درة العقيق بالمدينة المنورة، بميزانية 5 ملايين ريال.', required: true });
 // Text carried from «لدي عقار» when it was really a request: kept as written, never retyped.
 if (initialText) description.value = String(initialText).slice(0, 4000);
 const status = feedback({ class: 'os-alert info', role: 'status', hidden: true });
 const say = (tone, text) => { status.className = `os-alert ${tone} os-feedback`; status.querySelector('.os-feedback-copy').textContent = text; status.hidden = false; };
 const scope = h('select', { class: 'os-input', name: 'scope', 'aria-label': 'نطاق البحث' }, id ? h('option', { value: 'office', text: 'عروض هذا المكتب' }) : null, h('option', { value: 'all', text: 'جميع المكاتب المشاركة' }));
 const controls = {
  purpose: h('select', { class: 'os-input', name: 'purpose' }, h('option', { value: '', text: 'اختر الغرض' }), h('option', { value: 'PURCHASE', text: 'شراء' }), h('option', { value: 'LEASE_REQUEST', text: 'استئجار' })),
  propertyType: h('select', { class: 'os-input', name: 'propertyType' }, h('option', { value: '', text: 'اختر نوع العقار' }), PROPERTY_TYPES.map((t) => h('option', { value: t, text: t }))),
  city: h('input', { class: 'os-input', name: 'city', value: '', placeholder: 'المدينة المنورة' }),
  district: h('input', { class: 'os-input', name: 'district', placeholder: 'الحي المطلوب' }),
  price: h('input', { class: 'os-input', name: 'price', inputmode: 'decimal', placeholder: 'ميزانيتك بالريال' }),
  rooms: h('input', { class: 'os-input', name: 'rooms', inputmode: 'numeric', placeholder: 'اختياري' }),
  area: h('input', { class: 'os-input', name: 'area', inputmode: 'decimal', placeholder: 'اختياري' })
 };
 const review = h('details', { 'data-search-criteria': '' }, h('summary', { class: 'os-sub', text: 'تعديل تفاصيل البحث' }), h('div', { class: 'os-form os-guest-criteria' },
  h('div', { class: 'os-row2' }, field('الغرض', controls.purpose), field('نوع العقار', controls.propertyType)),
  h('div', { class: 'os-row2' }, field('المدينة', controls.city), field('الحي', controls.district)),
  field('الميزانية (ريال)', controls.price), h('div', { class: 'os-row2' }, field('عدد الغرف', controls.rooms, { optional: true }), field('المساحة (م²)', controls.area, { optional: true }))));
 const summary = h('p', { class: 'os-search-summary', 'data-search-summary': '', hidden: true });
 const criteriaValue = () => Object.fromEntries(Object.entries(controls).map(([k, v]) => [k, v.value]));
 const updateSummary = () => {
  summary.textContent = [controls.purpose.selectedOptions[0]?.text, controls.propertyType.value, controls.city.value, controls.district.value, controls.price.value ? `حتى ${formatNumber(controls.price.value)} ريال` : ''].filter(Boolean).join(' · ');
  summary.hidden = false;
 };
 const understand = async () => {
  const text = description.value.trim();
  if (!text) { review.open = true; throw new Error('اكتب طلبك أو أدخل تفاصيل البحث.'); }
  say('info', 'نفهم طلبك…');
  const r = await api('/os/public/search/analyze', { officeId: id, text }, { authenticated: false });
  const l = r.listings?.[0];
  if (!l?.understood) throw new Error('وضّح طلبك أو أكمل التفاصيل يدويًا.');
  controls.purpose.value = l.purpose === 'RENT' ? 'LEASE_REQUEST' : l.purpose === 'SALE' ? 'PURCHASE' : l.purpose || '';
  for (const k of ['propertyType', 'city', 'price', 'rooms', 'area']) controls[k].value = l[k] ? String(l[k]) : '';
  controls.district.value = l.districts?.[0] || l.district || '';
  analyzedText = text;
  updateSummary();
 };
 const submit = h('button', { type: 'submit', class: 'os-btn primary block', 'data-guest-search': '', 'data-guest-analyze': '' }, ic('search'), 'ابحث عن العقارات المناسبة');
 const examples = h('div', { class: 'os-search-examples', 'aria-label': 'أمثلة للبحث' }, ['فيلا للبيع', 'شقة للإيجار', 'أرض للبيع'].map(text => h('button', { type: 'button', class: 'os-btn secondary', onClick: () => { description.value = `أبحث عن ${text} `; description.focus(); } }, text)));
 const sendRequest = onRequest ? h('button', { type: 'button', class: 'os-btn secondary block', 'data-send-office-request': '', onClick: () => runAction(sendRequest, async () => { if (description.value.trim() && analyzedText !== description.value.trim()) await understand(); onRequest({ text: description.value, criteria: criteriaValue() }); }, { onError: e => { review.open = true; say('bad', e.message); } }) }, 'أرسل طلبي للمكتب') : null;
 const results = h('section', { 'aria-live': 'polite', 'data-guest-results': '' });
 const form = surface('form', { class: 'os-card os-form os-smart-search-form', 'data-guest-search-form': '', novalidate: true },
  h('div', {}, h('h2', { class: 'os-h2', text: 'وش العقار اللي تدور عليه؟' }), h('p', { class: 'os-sub', text: 'اكتب مواصفات العقار أو الصق رسالة واتساب، ونبحث لك عن الأنسب.' })),
  notice ? feedback({ class: 'os-alert info', 'data-kind-notice': '', text: notice }) : null,
  field('طلبك العقاري', description), examples, field('نطاق البحث', scope), submit, status, summary, review,
  h('p', { class: 'os-sub', text: 'بدون تسجيل · نطلب اسمك وجوالك عند التواصل أو إرسال طلبك للمكتب.' }));
 form.addEventListener('submit', async (event) => {
  event.preventDefault(); status.hidden = true;
  await runAction(submit, async () => {
   if (analyzedText !== description.value.trim() && description.value.trim()) await understand();
   const criteria = criteriaValue();
   say('info', 'نبحث عن العقارات الأنسب…');
   const r = await api('/os/public/search', { officeId: id, scope: scope.value, requestKey, criteria, viewerKey: readViewerKey() }, { authenticated: false });
   clear(results);
   append(results, pageHeader('أفضل العقارات المطابقة', { description: r.results.length ? 'أفضل الخيارات من العروض المصرّح بنشرها والمتاحة الآن' : 'ما لقينا عقارًا مطابقًا حاليًا. أرسل طلبك للمكتب ويتابع معك إذا توفر المناسب.' }));
   const draw = (items, offset = 0) => items.forEach((x, i) => append(results, resultCard(x, offset + i, (item, index) => chooseSheet(item, index, r.searchToken))));
   draw(r.results.slice(0, 3));
   if (r.results.length > 3) {
    const more = h('button', { type: 'button', class: 'os-btn secondary block', 'data-more-results': '', onClick: () => { more.remove(); draw(r.results.slice(3), 3); } }, 'عرض المزيد');
    append(results, more);
   }
   if (sendRequest) sendRequest.textContent = r.results.length ? 'ما ناسبني الموجود — أرسل طلبي للمكتب' : 'أرسل طلبي للمكتب';
   status.hidden = true; updateSummary();
   if (r.coverageLimited) append(results, h('p', { class: 'os-sub', text: 'هذه النتائج من مجموعة العروض التي أمكن فحصها في هذه الجولة.' }));
   results.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, { onError: (error) => { review.open = true; say('bad', error.message); } });
 });
 description.addEventListener('input', () => { requestKey = crypto.randomUUID(); clear(results); summary.hidden = true; });
 scope.addEventListener('change', () => { requestKey = crypto.randomUUID(); clear(results); });
 for (const control of Object.values(controls)) control.addEventListener('change', () => { requestKey = crypto.randomUUID(); clear(results); updateSummary(); });
 return h('div', { class: 'os-guest-search' }, form, results, sendRequest);
}

export function renderPlatformSearch(root) {
 clear(root); append(root, h('main', { class: 'os-app os-public-page', dir: 'rtl' },
  pageHeader('ابحث عن عقارك بذكاء', { description: 'طلب واحد، وعقارات مناسبة من المكاتب المشاركة. بدون تسجيل دخول.' }), publicSearchForm(),
  h('footer', { class: 'os-public-powered' }, h('a', { href: '/', text: 'دخول المكتب العقاري' }))));
 document.title = 'البحث العقاري الذكي | iAqar.ai';
}
