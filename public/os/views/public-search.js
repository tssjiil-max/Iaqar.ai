/**
 * Guest journey: write the request → «ابحث عن العقارات الآن» reads it and shows real matches at once (the closest
 * three first) → choose one and continue with its office, or «أرسل طلبي للمكتب العقاري» so the office follows it up
 * (also when nothing matches yet). No account. Name, phone and consent are asked only for those two steps.
 */
import { h, ic, clear, field, append, surface, pageHeader, feedback } from '../core/dom.js';
import { api, workerBase } from '../core/runtime.js';
import { runAction, openSheet } from '../core/ui.js';
import { formatNumber, toNumber } from '../domain/format-domain.js';
import { PROPERTY_TYPES, transactionTypeFor } from '../domain/records-domain.js';
import { CONTACT_PREFERENCE, dataNotice, fullNameOk, newIntakeRef, processIntake, publicReferenceOf, saudiMobile, saveIntake } from './public-intake.js';

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

/**
 * «أرسل طلبي للمكتب العقاري»: the request the client searched for becomes a real request in the office (its record,
 * contact and opportunity, central matching and the office's notice), through the same intake as the office link.
 * One intake per search: a second press, a retry or a reopened sheet never creates a second one.
 */
function requestSheet(office, state, onSent) {
 const sent = state.reference;
 const name = h('input', { class: 'os-input', name: 'contactName', autocomplete: 'name', placeholder: 'الاسم الأول واسم العائلة', maxlength: '80', required: true });
 const phone = h('input', { class: 'os-input', name: 'contactPhone', type: 'tel', inputmode: 'tel', dir: 'ltr', autocomplete: 'tel', placeholder: '05XXXXXXXX', required: true });
 const preference = h('select', { class: 'os-input', name: 'contactPreference', required: true }, Object.entries(CONTACT_PREFERENCE).map(([value, text]) => h('option', { value, text })));
 const consent = h('input', { type: 'checkbox', name: 'consentProcessing', required: true });
 const status = feedback({ class: 'os-alert bad', role: 'alert', hidden: true });
 const submit = h('button', { type: 'submit', class: 'os-btn primary block', 'data-guest-request': '' }, ic('send'), 'أرسل طلبي للمكتب');
 const outcome = h('div', { 'data-guest-request-outcome': '' });
 const form = h('form', { class: 'os-form', 'data-guest-request-form': '', novalidate: true },
  h('p', { class: 'os-sub', text: `${state.criteria.propertyType} في ${state.criteria.district || state.criteria.city} — حتى ${formatNumber(state.criteria.price)} ريال` }),
  h('div', { class: 'os-row2' }, field('الاسم الكامل', name), field('رقم الجوال', phone)),
  field('وسيلة التواصل المفضلة', preference),
  h('div', { class: 'os-pref-list' },
   h('label', { class: 'os-pref-row' }, h('span', { text: `أوافق على مشاركة اسمي ورقمي وطلبي مع ${office.officeName || 'المكتب'} ليتواصل معي بخصوص هذا الطلب.` }), consent)),
  dataNotice(office), status, submit,
  h('p', { class: 'os-field-note', text: 'يتواصل معك المكتب بنفسه. لا نرسل لك رسائل آلية.' }));
 const show = (reference, answer = {}) => {
  form.hidden = true; clear(outcome);
  append(outcome,
   feedback({ class: 'os-alert ok', text: `وصل طلبك إلى ${office.officeName || 'المكتب'}، وسيتابع لك العقارات المناسبة.` }),
   h('p', { class: 'os-public-reference', 'data-request-reference': reference }, 'رقم طلبك: ', h('b', { dir: 'ltr', text: reference })),
   answer.duplicate && answer.duplicateMessage ? h('p', { class: 'os-field-note', text: 'طلبك مسجّل مسبقًا لدى المكتب، وحدّثناه بدل إنشاء طلب مكرر.' }) : null,
   h('p', { class: 'os-field-note', text: `سيتواصل معك المكتب عبر ${CONTACT_PREFERENCE[state.preference] || 'واتساب'}. أي حجز أو سعر نهائي يعتمده المكتب.` }));
 };
 if (sent) show(sent, state.answer);
 const say = (text) => { status.querySelector('.os-feedback-copy').textContent = text; status.hidden = false; };
 // A message about the last press goes away as soon as the client corrects the form.
 for (const type of ['input', 'change']) form.addEventListener(type, () => { status.hidden = true; });
 form.addEventListener('submit', async (event) => {
  event.preventDefault(); status.hidden = true;
  const local = saudiMobile(phone.value);
  if (!fullNameOk(name.value)) return say('اكتب الاسم الأول واسم العائلة.');
  if (!local) return say('اكتب رقم جوال سعودي صحيح يبدأ بـ 05.');
  if (!consent.checked) return say('الموافقة على مشاركة بياناتك مع المكتب مطلوبة لإرسال الطلب.');
  await runAction(submit, async () => {
   const ref = state.ref ||= newIntakeRef(office.id);
   const c = state.criteria;
   if (!state.stored) {
    await saveIntake(ref, {
     officeId: office.id, kind: 'client', submitterRole: 'CLIENT', submitterCapacity: c.purpose === 'LEASE_REQUEST' ? 'TENANT' : 'BUYER',
     name: name.value.trim().replace(/\s+/g, ' ').slice(0, 80), phone: local, contactPreference: preference.value,
     propertyType: String(c.propertyType || '').slice(0, 40), district: String(c.district || '').slice(0, 80), city: c.city || office.city || '',
     purpose: c.purpose, transactionType: transactionTypeFor(c.purpose), amount: toNumber(c.price), area: toNumber(c.area) || 0, rooms: toNumber(c.rooms) || 0,
     // The client's own words, kept as written, beside what was understood from them.
     details: String(state.text || '').slice(0, 1000), searchReferences: state.references.slice(0, 10), searchResultCount: state.references.length,
     mediaPaths: [], imageCount: 0, hasVideo: false, source: 'office_public_link', fillMethod: 'GUEST_SEARCH',
     consentProcessing: true, consentWhatsapp: false
    });
    // Saved: from here a retry only re-asks the Worker to process this same intake.
    state.stored = true; state.preference = preference.value;
   }
   const { answer } = await processIntake(office.id, ref.id);
   state.reference = publicReferenceOf(ref.id); state.answer = answer;
   show(state.reference, answer); onSent(state.reference);
  }, { onError: (error) => say(state.stored ? `حفظنا طلبك، لكن تعذر إكمال إرساله للمكتب: ${error.message} — اضغط «أرسل» مرة أخرى.` : (error?.message || 'تعذر إرسال الطلب. بياناتك ما زالت هنا، حاول مرة أخرى.')) });
 });
 const { sheet } = openSheet('أرسل طلبك للمكتب', h('div', {}, form, outcome));
 if (!sent) requestAnimationFrame(() => sheet.querySelector('[name=contactName]')?.focus({ preventScroll: true }));
}

const TOP = 3;

export function publicSearchForm(office = null, { initialText = '', notice = '' } = {}) {
 const id = office?.id || '', requestKey = crypto.randomUUID();
 const description = h('textarea', { class: 'os-textarea', name: 'description', rows: '3', maxlength: '4000', placeholder: 'أبحث عن شقة تمليك في حي الجماوات بالمدينة المنورة، أربع غرف، بحدود 500 ألف ريال', required: true });
 // Text carried from «لدي عقار» when it was really a request: kept as written, never retyped.
 if (initialText) description.value = String(initialText).slice(0, 4000);
 const status = feedback({ class: 'os-alert info', role: 'status', hidden: true });
 const say = (tone, text) => { status.className = `os-alert ${tone} os-feedback`; status.querySelector('.os-feedback-copy').textContent = text; status.hidden = false; };
 const scope = h('select', { class: 'os-input', name: 'scope', 'aria-label': 'نطاق البحث' }, id ? h('option', { value: 'office', text: 'عروض هذا المكتب' }) : null, h('option', { value: 'all', text: 'جميع العروض المتاحة في المنصة' }));
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
 // Understanding is part of the search: the text is read once, and again only when it changes.
 // What the client corrects in «راجع مواصفات طلبك» is kept until he rewrites the text.
 let understoodText = '';
 const understand = async () => {
  const text = description.value.trim();
  if (!text || text === understoodText) return;
  const r = await api('/os/public/search/analyze', { officeId: id, text }, { authenticated: false }); const l = r.listings?.[0];
  if (!l?.understood) {
   // Specifications already entered by hand still let the search run.
   if (controls.propertyType.value && controls.price.value && controls.purpose.value) return;
   throw new Error('ما اكتملت قراءة طلبك. وضّح التفاصيل أو أدخل المواصفات يدويًا.');
  }
  controls.purpose.value = l.purpose === 'RENT' ? 'LEASE_REQUEST' : l.purpose === 'SALE' ? 'PURCHASE' : l.purpose || controls.purpose.value;
  for (const k of ['propertyType', 'city', 'price', 'rooms', 'area']) if (l[k]) controls[k].value = String(l[k]);
  controls.district.value = l.districts?.[0] || l.district || controls.district.value;
  understoodText = text;
 };
 const submit = h('button', { type: 'submit', class: 'os-btn primary block', 'data-guest-search': '' }, ic('search'), 'ابحث عن العقارات الآن');
 const results = h('section', { 'aria-live': 'polite', 'data-guest-results': '' });
 const form = surface('form', { class: 'os-card os-form', 'data-guest-search-form': '', novalidate: true },
  h('div', {}, h('h2', { class: 'os-h2', text: 'وش العقار اللي تدور عليه؟' }), h('p', { class: 'os-sub', text: 'اكتب طلبك أو الصق رسالة واتساب، ونعرض لك العقارات المناسبة فورًا.' })),
  notice ? feedback({ class: 'os-alert info', 'data-kind-notice': '', text: notice }) : null,
  field('طلبك العقاري', description), field('نطاق البحث', scope), review, status, submit,
  h('p', { class: 'os-sub', text: 'بدون حساب. نطلب اسمك ورقمك فقط إذا أرسلت طلبك للمكتب أو اخترت عقارًا.' }));
 // One request per search: a new search (new criteria) starts a new one; the same search keeps the one sent.
 let request = null;
 const requestAction = () => {
  if (!id) return h('p', { class: 'os-field-note', 'data-guest-request-hint': '', text: 'اختر عقارًا من النتائج لتتابع مع المكتب المسؤول عنه.' });
  return surface('div', { class: 'os-card os-guest-request', 'data-guest-request': '' },
   h('h3', { class: 'os-h2', text: 'تبي المكتب يتابع طلبك؟' }),
   h('p', { class: 'os-sub', text: 'أرسل طلبك باسمك ورقمك، ويتابع لك المكتب العقارات المناسبة الحالية والجديدة.' }),
   requestButton());
 };
 const requestButton = () => {
  const button = h('button', { type: 'button', class: `os-btn ${request.reference ? 'secondary' : 'primary'} block`, 'data-guest-request-open': request.reference ? 'sent' : '' }, ic(request.reference ? 'check-circle' : 'send'), request.reference ? `أُرسل طلبك · ${request.reference}` : 'أرسل طلبي للمكتب العقاري');
  button.addEventListener('click', () => requestSheet(office, request, () => button.replaceWith(requestButton())));
  return button;
 };
 const draw = (r, criteria) => {
  clear(results);
  const key = JSON.stringify(criteria);
  if (!request || request.key !== key) request = { key, criteria, text: description.value.trim(), references: r.results.map((x) => x.reference), ref: null, stored: false, reference: '', preference: 'whatsapp' };
  const none = !r.results.length;
  append(results, pageHeader('العقارات الأقرب لطلبك', { description: none ? 'لا توجد عروض منشورة مطابقة الآن.' : `${r.results.length} من العروض المصرّح بنشرها ومتاحة الآن — الأقرب لطلبك أولًا` }));
  // Nothing matched: said plainly, and the journey goes on (the office can follow the request).
  if (none) append(results, feedback({ class: 'os-alert info', 'data-no-results': '', text: id ? 'ما لقينا عقارًا مطابقًا حاليًا. تقدر ترسل طلبك للمكتب عشان يتابع لك الفرص الجديدة.' : 'ما وجدنا عروضًا منشورة تطابق طلبك حاليًا. عدّل المواصفات أو وسّع البحث.' }));
  results.dataset.resultsState = none ? 'none' : 'found';
  // What the search used, in one line; «راجع مواصفات طلبك» corrects it.
  const understood = [criteria.propertyType, criteria.purpose === 'LEASE_REQUEST' ? 'إيجار' : criteria.purpose === 'PURCHASE' ? 'تمليك' : '', criteria.district, criteria.rooms ? `${criteria.rooms} غرف` : '', criteria.price ? `حتى ${formatNumber(criteria.price)} ريال` : ''].filter(Boolean).join(' · ');
  append(results, h('p', { class: 'os-field-note', 'data-understood': '' }, `بحثنا عن: ${understood} — `, h('button', { type: 'button', class: 'os-link-btn', onClick: () => { review.open = true; review.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); }, text: 'عدّل المواصفات' })));
  const cards = r.results.map((x, i) => resultCard(x, i, (item, index) => chooseSheet(item, index, r.searchToken)));
  cards.forEach((card, i) => { if (i >= TOP) card.hidden = true; append(results, card); });
  if (cards.length > TOP) {
   const more = h('button', { type: 'button', class: 'os-btn secondary block', 'data-show-more': '' }, ic('chev-down'), `اعرض ${cards.length - TOP} ${cards.length - TOP === 1 ? 'نتيجة أخرى' : 'نتائج أخرى'}`);
   more.addEventListener('click', () => { cards.forEach((card) => { card.hidden = false; }); more.remove(); cards[TOP]?.querySelector('button')?.focus({ preventScroll: false }); });
   append(results, more);
  }
  if (r.coverageLimited) append(results, h('p', { class: 'os-sub', text: 'هذه النتائج من مجموعة العروض التي أمكن فحصها في هذه الجولة.' }));
  append(results, requestAction());
  results.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
 };
 form.addEventListener('submit', async (event) => {
  event.preventDefault(); status.hidden = true;
  await runAction(submit, async () => {
   await understand();
   const criteria = Object.fromEntries(Object.entries(controls).map(([k, v]) => [k, v.value]));
   const r = await api('/os/public/search', { officeId: id, scope: scope.value, requestKey, criteria, viewerKey: readViewerKey() }, { authenticated: false });
   draw(r, criteria);
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
