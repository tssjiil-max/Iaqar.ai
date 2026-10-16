/**
 * Guest journey: write the request → see up to 10 real matches → choose one → continue with the office.
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
 const choose = h('button', { type: 'button', class: 'os-btn primary block', 'data-choose-result': x.reference }, ic('check-circle'), 'اختر هذا العقار');
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

export function publicSearchForm(office = null) {
 const id = office?.id || '', requestKey = crypto.randomUUID();
 const description = h('textarea', { class: 'os-textarea', name: 'description', rows: '3', maxlength: '4000', placeholder: 'أبغى شقة تمليك في الجماوات، أربع غرف، بحدود 500 ألف', required: true });
 const status = feedback({ class: 'os-alert info', role: 'status', hidden: true });
 const say = (tone, text) => { status.className = `os-alert ${tone} os-feedback`; status.querySelector('.os-feedback-copy').textContent = text; status.hidden = false; };
 const scope = h('select', { class: 'os-input', name: 'scope', 'aria-label': 'نطاق البحث' }, id ? h('option', { value: 'office', text: 'عروض هذا المكتب' }) : null, h('option', { value: 'all', text: 'جميع المكاتب المشاركة' }));
 const controls = {
  purpose: h('select', { class: 'os-input', name: 'purpose' }, h('option', { value: '', text: 'اختر الغرض' }), h('option', { value: 'PURCHASE', text: 'شراء' }), h('option', { value: 'LEASE_REQUEST', text: 'استئجار' })),
  propertyType: h('select', { class: 'os-input', name: 'propertyType' }, h('option', { value: '', text: 'اختر نوع العقار' }), PROPERTY_TYPES.map((t) => h('option', { value: t, text: t }))),
  city: h('input', { class: 'os-input', name: 'city', value: office?.city || 'المدينة المنورة', placeholder: 'المدينة المنورة' }),
  district: h('input', { class: 'os-input', name: 'district', placeholder: 'الحي المطلوب' }),
  price: h('input', { class: 'os-input', name: 'price', inputmode: 'decimal', placeholder: 'ميزانيتك بالريال' }),
  rooms: h('input', { class: 'os-input', name: 'rooms', inputmode: 'numeric', placeholder: 'اختياري' }),
  area: h('input', { class: 'os-input', name: 'area', inputmode: 'decimal', placeholder: 'اختياري' })
 };
 const review = h('details', { 'data-search-criteria': '' }, h('summary', { class: 'os-sub', text: 'راجع مواصفات طلبك وعدّلها' }), h('div', { class: 'os-form os-guest-criteria' },
  h('div', { class: 'os-row2' }, field('الغرض', controls.purpose), field('نوع العقار', controls.propertyType)),
  h('div', { class: 'os-row2' }, field('المدينة', controls.city), field('الحي', controls.district)),
  field('الميزانية (ريال)', controls.price), h('div', { class: 'os-row2' }, field('عدد الغرف', controls.rooms, { optional: true }), field('المساحة (م²)', controls.area, { optional: true }))));
 const analyze = h('button', { type: 'button', class: 'os-btn secondary block', 'data-guest-analyze': '' }, ic('sparkles'), 'افهم طلبي');
 analyze.addEventListener('click', () => runAction(analyze, async () => {
  const r = await api('/os/public/search/analyze', { officeId: id, text: description.value }, { authenticated: false }); const l = r.listings?.[0];
  if (!l?.understood) throw new Error('ما اكتملت قراءة طلبك. وضّح التفاصيل أو أدخل المواصفات يدويًا.');
  controls.purpose.value = l.purpose === 'RENT' ? 'LEASE_REQUEST' : l.purpose === 'SALE' ? 'PURCHASE' : l.purpose || '';
  for (const k of ['propertyType', 'city', 'price', 'rooms', 'area']) if (l[k]) controls[k].value = String(l[k]);
  controls.district.value = l.districts?.[0] || l.district || '';
  review.open = true; say('info', 'فهمنا طلبك. راجع المواصفات وأكمل الناقص، ثم اعرض العقارات.');
 }, { onError: (e) => { say('bad', e.message); review.open = true; } }));
 const submit = h('button', { type: 'submit', class: 'os-btn primary block', 'data-guest-search': '' }, ic('search'), 'اعرض العقارات المناسبة');
 const results = h('section', { 'aria-live': 'polite', 'data-guest-results': '' });
 const form = surface('form', { class: 'os-card os-form', 'data-guest-search-form': '', novalidate: true },
  h('div', {}, h('h2', { class: 'os-h2', text: 'وش العقار اللي تدور عليه؟' }), h('p', { class: 'os-sub', text: 'اكتب طلبك أو الصق رسالة واتساب، ونعرض لك حتى 10 عقارات مناسبة.' })),
  field('نطاق البحث', scope), field('طلبك العقاري', description), analyze, review, status, submit,
  h('p', { class: 'os-sub', text: 'بدون حساب. نطلب اسمك ورقمك فقط إذا اخترت عقارًا.' }));
 form.addEventListener('submit', async (event) => {
  event.preventDefault(); status.hidden = true;
  await runAction(submit, async () => {
   const criteria = Object.fromEntries(Object.entries(controls).map(([k, v]) => [k, v.value]));
   const r = await api('/os/public/search', { officeId: id, scope: scope.value, requestKey, criteria, viewerKey: readViewerKey() }, { authenticated: false });
   clear(results);
   append(results, pageHeader('العقارات الأقرب لطلبك', { description: r.results.length ? `${r.results.length} من العروض المصرّح بنشرها ومتاحة الآن` : 'ما وجدنا عروضًا منشورة تطابق طلبك حاليًا. عدّل المواصفات أو وسّع البحث لجميع المكاتب.' }));
   r.results.forEach((x, i) => append(results, resultCard(x, i, (item, index) => chooseSheet(item, index, r.searchToken))));
   if (r.coverageLimited) append(results, h('p', { class: 'os-sub', text: 'هذه النتائج من مجموعة العروض التي أمكن فحصها في هذه الجولة.' }));
   results.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, { onError: (error) => { review.open = true; say('bad', error.message); } });
 });
 return h('div', { class: 'os-guest-search' }, form, results);
}

export function renderPlatformSearch(root) {
 clear(root); append(root, h('main', { class: 'os-app os-public-page', dir: 'rtl' },
  pageHeader('ابحث عن عقارك بذكاء', { description: 'طلب واحد، وعقارات مناسبة من المكاتب المشاركة. بدون تسجيل دخول.' }), publicSearchForm(),
  h('footer', { class: 'os-public-powered' }, h('a', { href: '/', text: 'دخول المكتب العقاري' }))));
 document.title = 'البحث العقاري الذكي | iAqar.ai';
}
