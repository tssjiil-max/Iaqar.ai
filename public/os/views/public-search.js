/**
 * The guest desk (/?view=search and every office link). No account.
 *   ابحث عن عقار       → write the request or set the scope (≤3 districts, ≤3 offices) → best three real matches
 *   أرسل طلبك للمكاتب  → the same criteria go to the offices the guest chose, after name, phone and consent
 *   اعرض عقارك         → the owner's offer reaches one office for review (never published by this page)
 * Results come from the central engine the WhatsApp agent also uses; name and phone are asked only when the
 * guest chooses a property or sends a request. Same visual language as «أدوات المكتب».
 */
import { h, ic, clear, field, append, surface, feedback } from '../core/dom.js';
import { propertyTypeIcon } from '../core/icons.js';
import { api, workerBase } from '../core/runtime.js';
import { runAction, openSheet } from '../core/ui.js';
import { formatNumber, toNumber, whatsappDigits } from '../domain/format-domain.js';
import { inventoryInquiry } from '../domain/inventory-query-domain.js';
import { PROPERTY_TYPES } from '../domain/records-domain.js';
import { GUEST_LIMITS, requestGaps, sameDistrict, toggleLimited, uniqueDistricts } from '../domain/guest-search-domain.js';
import { districtsForCity } from '../../js/reference-catalog.js';

const VIEWER_KEY = 'iaqar.guestInterestKey';
// Remembering this browser's own interest key (a hash, not a phone) only stops us telling a client
// that «others» are interested when it was them. Storage can be unavailable; search still works.
const readViewerKey = () => { try { const v = localStorage.getItem(VIEWER_KEY) || ''; return /^[a-f0-9]{32}$/.test(v) ? v : ''; } catch (_) { return ''; } };
const saveViewerKey = (v) => { try { if (/^[a-f0-9]{32}$/.test(v)) localStorage.setItem(VIEWER_KEY, v); } catch (_) { /* private mode */ } };
const newKey = () => (crypto.randomUUID?.() || `k${Date.now()}${Math.random().toString(16).slice(2)}`).replace(/[^a-zA-Z0-9_-]/g, '');
const PURPOSE_LABEL = { PURCHASE: 'شراء', LEASE_REQUEST: 'استئجار' };
const MADINAH = 'المدينة المنورة';

const PATHS = Object.freeze([
  { id: 'search', path: 'search', tone: 'blue', icon: 'search', title: 'ابحث عن عقار', hint: 'بحث ذكي ومطابقة فورية' },
  { id: 'request', path: 'request', tone: 'green', icon: 'send', title: 'أرسل طلبك للمكاتب', hint: 'المكاتب تبحث لك عن المناسب' },
  { id: 'offer', path: 'owner', tone: 'gold', icon: 'reference-home', title: 'اعرض عقارك', hint: 'أرسل عرضك للمكتب للمراجعة' }
]);

// ------------------------------------------------------------------ limited picker (districts · offices)

/**
 * Choose up to `max` items: chips for what is chosen, a search box, a short list, and «جميع …» to clear.
 * A choice past the limit is refused with a visible message (never swaps an earlier choice out).
 */
function limitedPicker({ name, label, max, allLabel, placeholder, items, keyOf, same = (a, b) => keyOf(a) === keyOf(b), labelOf, rowOf = null, allowFree = false, onChange = () => {} }) {
  let chosen = [], locked = false;
  const count = h('span', { class: 'os-guest-pick-count', 'data-pick-count': name });
  const chips = h('div', { class: 'os-guest-chips', 'data-picked': name });
  const all = h('button', { type: 'button', class: 'os-guest-all', 'data-pick-all': name, onClick: () => { if (!locked) set([]); } }, ic('check'), allLabel);
  const query = h('input', { class: 'os-input', type: 'search', name: `${name}Query`, placeholder, autocomplete: 'off', 'aria-label': placeholder });
  const list = h('div', { class: 'os-guest-options', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': label, 'data-pick-options': name });
  const limit = h('p', { class: 'os-guest-limit', role: 'status', 'data-pick-limit': name, hidden: true, text: `يمكن اختيار ${max === 3 ? 'ثلاثة' : max} كحد أقصى. احذف واحدًا لإضافة غيره.` });
  const toggle = (item) => {
    if (locked) return;
    const next = toggleLimited(chosen, item, max, same);
    limit.hidden = !next.blocked;
    if (next.changed) { chosen = next.list; draw(); onChange(chosen); }
  };
  const draw = () => {
    count.textContent = `${chosen.length} من ${max}`;
    all.setAttribute('aria-pressed', String(!chosen.length));
    clear(chips);
    for (const item of chosen) chips.append(h('span', { class: 'os-guest-chip', 'data-chip': keyOf(item) }, h('span', { text: labelOf(item) }),
      locked ? null : h('button', { type: 'button', class: 'os-guest-chip-x', 'aria-label': `إزالة ${labelOf(item)}`, onClick: () => toggle(item) }, ic('x'))));
    clear(list);
    const q = query.value.trim();
    const pool = items().filter((item) => !q || labelOf(item).replace(/[أإآ]/g, 'ا').includes(q.replace(/[أإآ]/g, 'ا')) || same(item, q));
    for (const item of pool.slice(0, 24)) {
      const on = chosen.some((x) => same(x, item));
      list.append(h('button', { type: 'button', role: 'option', class: 'os-guest-option', 'aria-selected': String(on), 'aria-pressed': String(on), 'data-pick-option': keyOf(item), disabled: locked, onClick: () => toggle(item) },
        rowOf ? rowOf(item) : h('span', { text: labelOf(item) }), on ? ic('check-circle') : null));
    }
    if (allowFree && q.length >= 2 && !pool.some((item) => same(item, q))) {
      list.append(h('button', { type: 'button', class: 'os-guest-option free', 'data-pick-free': name, onClick: () => { toggle(q); query.value = ''; draw(); } }, ic('plus'), `إضافة «${q}»`));
    }
    if (!list.children.length) list.append(h('p', { class: 'os-sub', text: q ? 'لا توجد نتيجة مطابقة.' : 'لا توجد خيارات متاحة.' }));
  };
  query.addEventListener('input', draw);
  const set = (next, { silent = false } = {}) => { chosen = (next || []).slice(0, max); limit.hidden = true; draw(); if (!silent) onChange(chosen); };
  const el = h('div', { class: 'os-guest-pick', 'data-picker': name },
    h('div', { class: 'os-guest-pick-head' }, h('b', { text: label }), count),
    h('div', { class: 'os-guest-pick-quick' }, all, chips), query, list, limit);
  draw();
  return { el, values: () => [...chosen], set, redraw: draw, lock: (on) => { locked = on; query.disabled = on; draw(); } };
}

// ------------------------------------------------------------------ results

function resultCard(x, i, onChoose) {
  const facts = [x.area ? `${formatNumber(x.area)} م²` : '', x.rooms ? `${x.rooms} غرف` : ''].filter(Boolean);
  const reason = x.nearby ? `حي قريب — مسافة خطية ${x.distanceKm} كم من الحي المطلوب` : (x.reasons || []).join(' · ');
  const photo = h('div', { class: `os-guest-photo${x.imagePath ? '' : ' no-photo'}`, 'aria-hidden': x.imagePath ? null : 'true' }, ic(propertyTypeIcon(x.propertyType)));
  if (x.imagePath) {
    const img = h('img', { class: 'os-guest-result-photo', src: workerBase() + x.imagePath, alt: `${x.propertyType} في ${x.district}`, loading: 'lazy' });
    img.addEventListener('error', () => { img.remove(); photo.classList.add('no-photo'); }, { once: true });
    photo.prepend(img);
  }
  const details = () => openSheet('تفاصيل العقار', h('div', { class: 'os-form', 'data-result-sheet': x.reference },
    h('h3', { class: 'os-h2', text: `${x.propertyType} في ${x.district}` }),
    h('p', { class: 'os-guest-price', text: `${formatNumber(x.price)} ريال` }),
    h('p', { class: 'os-sub', text: [x.city, x.district, ...facts].filter(Boolean).join(' · ') }),
    reason ? h('p', { class: 'os-guest-reason', text: `سبب الترشيح: ${reason}` }) : null,
    h('p', { class: 'os-sub', text: `${x.officeName} · مرجع العقار: ${x.reference}` }),
    h('button', { type: 'button', class: 'os-btn primary block', onClick: () => onChoose(x, i) }, ic('check-circle'), 'مهتم بهذا العقار')));
  return surface('article', { class: 'os-guest-result', 'data-search-result': x.reference, 'data-listing-status': x.status || 'AVAILABLE' },
    photo,
    h('div', { class: 'os-guest-result-body' },
      h('div', { class: 'os-guest-result-head' },
        h('h3', { class: 'os-h2', text: `${x.propertyType} في ${x.district}` }),
        h('span', { class: `os-badge ${x.status === 'NEGOTIATING' ? 'late' : 'ok'}`, 'data-status-label': '', text: x.statusLabel || 'متاح' })),
      h('strong', { class: 'os-guest-price os-guest-result-price', text: `${formatNumber(x.price)} ريال` }),
      h('div', { class: 'os-guest-facts' },
        h('span', {}, ic('pin'), [x.city, x.district].filter(Boolean).join(' · ')),
        ...facts.map((f) => h('span', { text: f }))),
      reason ? h('p', { class: 'os-guest-reason', 'data-result-reason': '', text: `سبب الترشيح: ${reason}` }) : null,
      x.othersInterested ? feedback({ class: 'os-alert info', 'data-interest-notice': '', text: x.interestNotice }) : null,
      h('small', { class: 'os-sub' }, `${x.officeName} · المرجع `, h('bdi', { dir: 'ltr', text: x.reference })),
      h('div', { class: 'os-guest-result-actions' },
        h('button', { type: 'button', class: 'os-btn secondary', 'data-result-details': x.reference, onClick: details }, 'عرض التفاصيل'),
        h('button', { type: 'button', class: 'os-btn primary', 'data-choose-result': x.reference, onClick: () => onChoose(x, i) }, ic('check-circle'), 'مهتم بهذا العقار'))));
}

/** The guest chose a property: who the office should contact, by which channel, with explicit consent. */
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

// ------------------------------------------------------------------ the desk

const officeRow = (o) => h('span', { class: 'os-guest-office' },
  h('span', { class: 'os-guest-office-logo', 'aria-hidden': 'true' }, /^https:\/\//.test(o.logoUrl || '') ? h('img', { src: o.logoUrl, alt: '', loading: 'lazy', onError: (e) => e.target.remove() }) : ic('office')),
  h('span', { class: 'os-guest-office-copy' }, h('b', { text: o.officeName }), o.city ? h('small', { text: o.city }) : null));

/**
 * @param office  the office of the link (publicOffices doc with id), or null on the platform page
 * @param opts.onOwner    office link: opens the office's own owner form (full page)
 * @param opts.ownerForm  platform: (officeCard, host) → mounts the owner form for the chosen office
 */
export function guestDesk(office = null, { initialText = '', notice = '', initialPath = 'search', onOwner = null, ownerForm = null } = {}) {
  const homeId = office?.id || '';
  let options = { offices: homeId ? [{ id: homeId, officeName: office.officeName || 'هذا المكتب', city: office.city || '', logoUrl: office.logoUrl || '' }] : [], cities: [], home: null };
  let analyzedText = null, manuallyEdited = false, searchKey = newKey(), requestKey = newKey(), last = null, path = '';

  const status = feedback({ class: 'os-alert info', role: 'status', hidden: true });
  const say = (box, tone, text) => { box.className = `os-alert ${tone} os-feedback`; box.querySelector('.os-feedback-copy').textContent = text; box.hidden = false; };

  // ---- criteria controls (names kept: the same hooks as before for the tests and the office form carry)
  const description = h('textarea', { class: 'os-textarea', name: 'description', rows: '3', maxlength: '4000', placeholder: 'أبحث عن فيلا للبيع في درة العقيق بالمدينة المنورة بميزانية 5 ملايين ريال.', 'aria-label': 'طلبك العقاري' });
  if (initialText) description.value = String(initialText).slice(0, 4000);
  const controls = {
    purpose: h('select', { class: 'os-input', name: 'purpose' }, h('option', { value: '', text: 'شراء أو استئجار' }), h('option', { value: 'PURCHASE', text: 'شراء' }), h('option', { value: 'LEASE_REQUEST', text: 'استئجار' })),
    propertyType: h('select', { class: 'os-input', name: 'propertyType' }, h('option', { value: '', text: 'كل الأنواع' }), PROPERTY_TYPES.map((t) => h('option', { value: t, text: t }))),
    city: h('select', { class: 'os-input', name: 'city' }, h('option', { value: '', text: 'كل المدن' })),
    price: h('input', { class: 'os-input', name: 'price', inputmode: 'decimal', placeholder: 'الميزانية القصوى بالريال' }),
    rooms: h('input', { class: 'os-input', name: 'rooms', inputmode: 'numeric', placeholder: 'اختياري' }),
    area: h('input', { class: 'os-input', name: 'area', inputmode: 'decimal', placeholder: 'اختياري' })
  };
  const ensureCity = (city) => { if (city && ![...controls.city.options].some((o) => o.value === city)) controls.city.append(h('option', { value: city, text: city })); };
  const scopeInput = h('input', { type: 'hidden', name: 'scope', value: homeId ? 'office' : 'all' });
  const districtInput = h('input', { type: 'hidden', name: 'district' });
  const districtsInput = h('input', { type: 'hidden', name: 'districts' });

  const districtPool = () => {
    const city = controls.city.value;
    const known = (!city || city === MADINAH) ? districtsForCity('madinah').map((d) => d.officialName) : [];
    return uniqueDistricts([...(options.home?.districts || []), ...known]);
  };
  const districts = limitedPicker({
    name: 'districts', label: 'الأحياء', max: GUEST_LIMITS.districts, allLabel: 'جميع الأحياء', placeholder: 'ابحث عن حي أو اكتب اسمه', allowFree: true,
    items: districtPool, keyOf: (d) => d, same: sameDistrict, labelOf: (d) => d,
    onChange: (list) => { districtInput.value = list[0] || ''; districtsInput.value = list.join('،'); changed(); }
  });
  const officePool = () => options.offices.filter((o) => !controls.city.value || !o.city || o.city === controls.city.value || o.id === homeId);
  const offices = limitedPicker({
    name: 'offices', label: 'المكاتب العقارية', max: GUEST_LIMITS.offices, allLabel: 'جميع المكاتب المشاركة', placeholder: 'ابحث باسم المكتب',
    items: officePool, keyOf: (o) => (typeof o === 'string' ? o : o.id), same: (a, b) => (typeof a === 'string' ? a : a.id) === (typeof b === 'string' ? b : b.id) || (typeof b === 'string' && a.officeName?.includes(b)),
    labelOf: (o) => o.officeName || '', rowOf: officeRow,
    onChange: () => { scopeInput.value = scope().scope; changed(); }
  });
  const scopeNote = h('p', { class: 'os-field-note', 'data-scope-note': '', hidden: true });

  const specs = h('details', { class: 'os-guest-more', 'data-guest-specs': '' }, h('summary', {}, ic('filter'), 'مواصفات إضافية'),
    h('div', { class: 'os-form-grid' },
      field('الغرض', controls.purpose), field('نوع العقار', controls.propertyType),
      field('الميزانية (ريال)', controls.price, { optional: true }),
      field('المساحة (م²)', controls.area, { optional: true }), field('عدد الغرف', controls.rooms, { optional: true })));
  const scopeBox = h('details', { class: 'os-guest-scope', 'data-search-criteria': '' },
    h('summary', {}, h('span', { class: 'os-guest-scope-icon', 'aria-hidden': 'true' }, ic('pin')), h('span', {}, h('b', { text: 'تحديد نطاق البحث' }), h('small', { text: 'المدينة، حتى 3 أحياء، حتى 3 مكاتب' })), ic('chev-down')),
    h('div', { class: 'os-guest-scope-body' }, field('المدينة', controls.city), districts.el, offices.el, scopeNote, specs, scopeInput, districtInput, districtsInput));

  const criteria = () => {
    const out = { districts: districts.values() };
    for (const k of ['purpose', 'propertyType', 'city', 'price', 'rooms', 'area']) if (String(controls[k].value).trim()) out[k] = String(controls[k].value).trim();
    // Arabic-Indic and Persian digits and separators are read by the shared helper.
    for (const k of ['price', 'rooms', 'area']) if (out[k]) out[k] = toNumber(out[k]) || '';
    return out;
  };
  function scope() {
    const ids = offices.values().map((o) => o.id);
    if (homeId && ids.length === 1 && ids[0] === homeId) return { scope: 'office' };
    if (ids.length) return { scope: 'selected', officeIds: ids };
    return { scope: 'all' };
  }
  const summary = h('div', { class: 'os-guest-summary', 'data-search-summary': '', hidden: true });
  const drawSummary = () => {
    const c = criteria();
    const parts = [PURPOSE_LABEL[c.purpose], c.propertyType, c.city, ...(c.districts || []), c.price ? `حتى ${formatNumber(c.price)} ريال` : '', c.area ? `${formatNumber(c.area)} م²+` : '', c.rooms ? `${c.rooms} غرف+` : '',
      offices.values().length ? offices.values().map((o) => o.officeName).join('، ') : 'جميع المكاتب المشاركة'].filter(Boolean);
    clear(summary);
    append(summary, h('span', { class: 'os-sub', text: 'فهمنا طلبك:' }), ...parts.map((p) => h('span', { class: 'os-guest-tag', text: p })),
      h('button', { type: 'button', class: 'os-guest-edit', 'data-edit-criteria': '', onClick: () => { scopeBox.open = true; specs.open = true; scopeBox.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); } }, ic('edit'), 'تعديل'));
    summary.hidden = false;
  };
  const applyFacts = (facts = {}) => {
    controls.purpose.value = facts.purpose === 'RENT' || facts.purpose === 'LEASE_REQUEST' ? 'LEASE_REQUEST' : facts.purpose === 'SALE' || facts.purpose === 'PURCHASE' ? 'PURCHASE' : '';
    if (facts.propertyType && ![...controls.propertyType.options].some((o) => o.value === facts.propertyType)) controls.propertyType.append(h('option', { value: facts.propertyType, text: facts.propertyType }));
    controls.propertyType.value = facts.propertyType || '';
    ensureCity(facts.city); controls.city.value = facts.city || '';
    for (const k of ['price', 'rooms', 'area']) controls[k].value = facts[k] ? String(facts[k]) : '';
    const named = uniqueDistricts(facts.districts?.length ? facts.districts : [facts.district].filter(Boolean));
    districts.set(named.slice(0, GUEST_LIMITS.districts));
    return named.length > GUEST_LIMITS.districts;
  };

  // ---- understanding the written request (central smart-fill), never inventing a missing value
  const understand = async (box) => {
    const text = description.value.trim();
    const inquiry = inventoryInquiry(text);
    if (inquiry) { applyFacts(inquiry); analyzedText = text; return { mode: 'inventory', priceExclusive: inquiry.priceExclusive === true }; }
    say(box, 'info', 'نفهم طلبك…');
    const r = await api('/os/public/search/analyze', { officeId: homeId, text }, { authenticated: false });
    const l = r.listings?.[0];
    if (!l?.understood) { scopeBox.open = true; specs.open = true; throw new Error('ما فهمنا الطلب بدقة — وضّحه أو أكمل التفاصيل يدويًا.'); }
    const extra = applyFacts(l);
    analyzedText = text;
    return { mode: 'auto', note: extra ? 'ذكرت أكثر من ثلاثة أحياء — بحثنا في أول ثلاثة، وتقدر تغيّرها.' : '' };
  };

  // ---- search panel
  const results = h('section', { class: 'os-guest-results', 'aria-live': 'polite', 'data-guest-results': '' });
  const submit = h('button', { type: 'submit', class: 'os-btn primary block os-guest-submit', 'data-guest-search': '', 'data-guest-analyze': '' }, ic('search'), 'ابحث عن العقارات المناسبة');
  const examples = h('div', { class: 'os-search-examples', 'aria-label': 'أمثلة للبحث' },
    ['فيلا للبيع', 'شقة للإيجار', 'أرض للبيع'].map((text) => h('button', { type: 'button', class: 'os-guest-example', onClick: () => { description.value = `أبحث عن ${text} `; description.focus(); description.dispatchEvent(new Event('input')); } }, text)));
  const form = h('form', { class: 'os-guest-form', 'data-guest-search-form': '', novalidate: true },
    notice ? feedback({ class: 'os-alert info', 'data-kind-notice': '', text: notice }) : null,
    h('label', { class: 'os-guest-ask' }, h('span', { class: 'os-guest-ask-label' }, ic('sparkles'), 'اكتب طلبك بكلماتك'), description),
    examples, scopeBox, status, submit,
    h('p', { class: 'os-guest-privacy', text: 'البحث بدون تسجيل. نطلب اسمك وجوالك فقط عند اختيار عقار أو إرسال طلبك.' }));
  let mode = 'auto', priceExclusive = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); status.hidden = true;
    await runAction(submit, async () => {
      const text = description.value.trim();
      let note = '';
      if (text && analyzedText !== text && !manuallyEdited) {
        const understood = await understand(status);
        mode = understood.mode; priceExclusive = understood.priceExclusive === true; note = understood.note || '';
      } else if (manuallyEdited || !text) { mode = 'auto'; priceExclusive = false; }
      const c = criteria();
      if (!c.districts.length && !c.propertyType && !c.price && !c.purpose && !c.city) { scopeBox.open = true; throw new Error('اكتب طلبك أو حدد حيًا أو نوع عقار أو ميزانية.'); }
      say(status, 'info', 'نبحث عن العقارات الأنسب…');
      const s = scope();
      const r = await api('/os/public/search', { officeId: homeId, ...s, requestKey: searchKey, criteria: { ...c, ...(priceExclusive ? { priceExclusive: true } : {}) }, mode, viewerKey: readViewerKey() }, { authenticated: false });
      last = { criteria: c, results: r.results, token: r.searchToken };
      status.hidden = true; scopeBox.open = false; drawSummary(); drawResults(r, note);
      results.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }, { onError: (error) => { scopeBox.open = true; say(status, 'bad', error.message); } });
  });
  const toRequest = (label, kind) => h('button', { type: 'button', class: `os-btn ${kind} block`, 'data-send-office-request': '', onClick: () => open('request') }, ic('send'), label);
  function drawResults(r, note) {
    clear(results);
    const items = r.results || [];
    append(results, h('header', { class: 'os-guest-results-head' },
      h('h2', { class: 'os-page-title', text: 'أفضل العقارات المناسبة لك' }),
      h('p', { class: 'os-sub', text: items.length ? `أفضل ${items.length > 3 ? 'ثلاثة' : items.length === 1 ? 'خيار' : 'الخيارات'} من العروض المنشورة والمتاحة الآن، مرتبة حسب الملاءمة.` : 'لا توجد عروض منشورة مطابقة الآن.' })),
      note ? feedback({ class: 'os-alert info', text: note }) : null);
    if (!items.length) {
      append(results, surface('div', { class: 'os-guest-empty', 'data-no-results': '' },
        h('span', { class: 'os-guest-empty-icon', 'aria-hidden': 'true' }, ic('reference-target')),
        h('h3', { class: 'os-h2', text: 'ما لقينا المناسب حاليًا، خلّ المكاتب تبحث لك.' }),
        h('p', { class: 'os-sub', text: 'نرسل طلبك بنفس المواصفات للمكاتب التي تختارها، ويتواصلون معك عند توفر المناسب.' }),
        toRequest('أرسل طلبي للمكاتب', 'primary')));
      return;
    }
    const list = h('div', { class: 'os-guest-result-list' });
    const draw = (rows, offset = 0) => rows.forEach((x, i) => list.append(resultCard(x, offset + i, (item, index) => chooseSheet(item, index, r.searchToken))));
    draw(items.slice(0, 3));
    append(results, list);
    if (items.length > 3) {
      const more = h('button', { type: 'button', class: 'os-btn secondary block', 'data-more-results': '', onClick: () => { more.remove(); draw(items.slice(3), 3); } }, `عرض المزيد (${items.length - 3})`);
      append(results, more);
    }
    if (r.coverageLimited) append(results, h('p', { class: 'os-sub', text: 'هذه النتائج من مجموعة العروض التي أمكن فحصها في هذه الجولة.' }));
    append(results, h('div', { class: 'os-guest-after' }, h('p', { class: 'os-sub', text: 'ما لقيت اللي يناسبك؟' }), toRequest('أرسل طلبي للمكاتب', 'secondary')));
  }
  function changed() { searchKey = newKey(); requestKey = newKey(); clear(results); summary.hidden = true; }
  description.addEventListener('input', () => { manuallyEdited = false; changed(); });
  for (const control of Object.values(controls)) {
    control.addEventListener('input', () => { manuallyEdited = true; });
    control.addEventListener('change', () => { manuallyEdited = true; changed(); if (control === controls.city) { districts.redraw(); offices.redraw(); } });
  }
  const searchPanel = h('section', { class: 'os-guest-panel', 'data-guest-panel': 'search' }, form, summary, results);

  // ---- request panel: the same criteria, to the offices the guest chose
  const reqStatus = feedback({ class: 'os-alert bad', role: 'alert', hidden: true });
  const reqName = h('input', { class: 'os-input', name: 'requestName', autocomplete: 'name', placeholder: 'الاسم', maxlength: '80' });
  const reqPhone = h('input', { class: 'os-input', name: 'requestPhone', type: 'tel', inputmode: 'tel', dir: 'ltr', autocomplete: 'tel', placeholder: '05XXXXXXXX' });
  const reqShare = h('input', { type: 'checkbox', name: 'requestConsentProcessing' });
  const reqContact = h('input', { type: 'checkbox', name: 'requestConsentContact' });
  const reqCriteria = h('div', { class: 'os-guest-summary', 'data-request-criteria': '' });
  const reqScopeSlot = h('div', { 'data-request-scope': '' });
  const reqSubmit = h('button', { type: 'submit', class: 'os-btn primary block', 'data-guest-request-submit': '' }, ic('send'), 'أرسل طلبي للمكاتب');
  const reqOutcome = h('div', { 'data-request-outcome': '' });
  const drawRequestCriteria = () => {
    const c = criteria(), gaps = requestGaps(c), chosen = offices.values();
    clear(reqCriteria);
    append(reqCriteria, h('span', { class: 'os-sub', text: 'طلبك:' }),
      ...[PURPOSE_LABEL[c.purpose], c.propertyType, c.city, ...c.districts, c.price ? `حتى ${formatNumber(c.price)} ريال` : ''].filter(Boolean).map((p) => h('span', { class: 'os-guest-tag', text: p })),
      gaps.length ? h('p', { class: 'os-guest-gap', 'data-request-gaps': gaps.map((g) => g.key).join(','), text: `أكمل قبل الإرسال: ${gaps.map((g) => g.label).join('، ')}.` }) : null,
      h('p', { class: 'os-guest-gap', 'data-request-offices': String(chosen.length), text: chosen.length ? `يصل الطلب إلى: ${chosen.map((o) => o.officeName).join('، ')}` : 'اختر من «المكاتب العقارية» حتى ثلاثة مكاتب يصلها طلبك.' }));
  };
  const reqForm = h('form', { class: 'os-guest-form', 'data-guest-request-form': '', novalidate: true },
    reqCriteria, reqScopeSlot,
    h('div', { class: 'os-form-grid' }, field('الاسم', reqName), field('رقم الجوال', reqPhone, { hint: 'رقم جوال سعودي يبدأ بـ 05' })),
    h('div', { class: 'os-pref-list' },
      h('label', { class: 'os-pref-row' }, h('span', { text: 'أوافق على معالجة بياناتي ومشاركة طلبي مع المكاتب التي اخترتها فقط.' }), reqShare),
      h('label', { class: 'os-pref-row' }, h('span', { text: 'أؤكد أن الرقم يخصني، وأوافق على تواصل هذه المكاتب معي بخصوص طلبي.' }), reqContact)),
    reqStatus, reqSubmit,
    h('p', { class: 'os-guest-privacy', text: 'لا نرسل أي رسالة نيابة عنك. يصل طلبك إلى بنك الطلبات في كل مكتب اخترته فقط.' }));
  reqForm.addEventListener('input', () => { reqStatus.hidden = true; });
  reqForm.addEventListener('submit', async (event) => {
    event.preventDefault(); reqStatus.hidden = true;
    const c = criteria(), gaps = requestGaps(c), chosen = offices.values();
    const fail = (text) => { reqStatus.querySelector('.os-feedback-copy').textContent = text; reqStatus.hidden = false; };
    if (gaps.length) { scopeBox.open = true; specs.open = true; drawRequestCriteria(); return fail(`أكمل ${gaps.map((g) => g.label).join('، ')} لإرسال طلبك.`); }
    if (!chosen.length) { scopeBox.open = true; offices.el.scrollIntoView?.({ block: 'center' }); return fail('اختر مكتبًا واحدًا على الأقل لإرسال طلبك.'); }
    if (reqName.value.trim().length < 2) return fail('اكتب اسمك.');
    if (!whatsappDigits(reqPhone.value)) return fail('اكتب رقم جوال سعودي صحيح يبدأ بـ 05.');
    if (!reqShare.checked || !reqContact.checked) return fail('وافق على معالجة الطلب ومشاركته والتواصل معك.');
    await runAction(reqSubmit, async () => {
      const r = await api('/os/public/requests', { officeId: homeId, officeIds: chosen.map((o) => o.id), requestKey, criteria: c, text: description.value.trim().slice(0, 900), name: reqName.value, phone: reqPhone.value, consentProcessing: true, consentContact: true }, { authenticated: false });
      reqForm.hidden = true;
      clear(reqOutcome);
      append(reqOutcome, surface('div', { class: 'os-guest-receipt', 'data-request-receipt': '' },
        h('span', { class: 'os-guest-empty-icon ok', 'aria-hidden': 'true' }, ic('check-circle')),
        h('h3', { class: 'os-h2', text: 'وصل طلبك للمكاتب' }),
        h('p', { class: 'os-guest-reference' }, 'الرقم المرجعي: ', h('b', { dir: 'ltr', 'data-request-reference': r.reference, text: r.reference })),
        h('ul', { class: 'os-guest-sent' }, r.offices.map((o) => h('li', { 'data-request-office': o.officeId }, ic('office'), h('span', { text: o.officeName }), h('small', { text: o.changedForReview ? 'طلبك موجود لديهم مسبقًا — أبلغناهم بالتعديلات لمراجعتها' : o.duplicate ? 'طلبك موجود لديهم مسبقًا' : 'وصل لبنك الطلبات' })))),
        h('p', { class: 'os-sub', text: 'يتواصل معك المكتب عند توفر المناسب. احتفظ بالرقم المرجعي لمتابعة طلبك.' }),
        h('button', { type: 'button', class: 'os-btn secondary block', onClick: () => { requestKey = newKey(); reqForm.hidden = false; clear(reqOutcome); open('search'); } }, 'بحث جديد')));
    }, { onError: (error) => { if (error.details) { scopeBox.open = true; specs.open = true; } fail(error.message); } });
  });
  const requestPanel = h('section', { class: 'os-guest-panel', 'data-guest-panel': 'request', hidden: true },
    h('header', { class: 'os-guest-panel-head' }, h('h2', { class: 'os-page-title', text: 'أرسل طلبك للمكاتب' }), h('p', { class: 'os-sub', text: 'نحفظ مواصفات بحثك ونرسلها للمكاتب التي تختارها، حتى ثلاثة مكاتب.' })),
    reqForm, reqOutcome);

  // ---- offer panel: one office reviews the owner's offer (nothing is published from here)
  const offerHost = h('div', { 'data-offer-form-host': '' });
  const offerOffice = limitedPicker({ name: 'offerOffice', label: 'المكتب الذي يستلم عرضك', max: 1, allLabel: 'لم تختر بعد', placeholder: 'ابحث باسم المكتب', items: () => options.offices,
    keyOf: (o) => (typeof o === 'string' ? o : o.id), same: (a, b) => (typeof a === 'string' ? a : a.id) === (typeof b === 'string' ? b : b.id), labelOf: (o) => o.officeName || '', rowOf: officeRow });
  const offerStatus = feedback({ class: 'os-alert bad', role: 'alert', hidden: true });
  const offerGo = h('button', { type: 'button', class: 'os-btn primary block', 'data-offer-continue': '' }, ic('chev-left'), 'متابعة مع هذا المكتب');
  offerGo.addEventListener('click', () => runAction(offerGo, async () => {
    const chosen = offerOffice.values()[0];
    if (!chosen) { offerStatus.querySelector('.os-feedback-copy').textContent = 'اختر المكتب الذي تريد عرض عقارك عليه.'; offerStatus.hidden = false; return; }
    offerStatus.hidden = true; clear(offerHost);
    await ownerForm?.(chosen, offerHost);
    offerHost.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }));
  const offerPanel = h('section', { class: 'os-guest-panel', 'data-guest-panel': 'offer', hidden: true },
    h('header', { class: 'os-guest-panel-head' }, h('h2', { class: 'os-page-title', text: 'عندك عقار؟ اعرضه على المكتب' }),
      h('p', { class: 'os-sub', text: 'يراجع المكتب عرضك ويتواصل معك قبل أي نشر. لا يُنشر شيء تلقائيًا.' })),
    surface('div', { class: 'os-guest-form' }, offerOffice.el, offerStatus, offerGo), offerHost);

  // ---- three path tiles (same tile language as «أدوات المكتب»)
  const tiles = PATHS.map((p) => h('button', { type: 'button', class: `os-guest-path tone-${p.tone}`, 'data-guest-path': p.id, 'data-path': p.path, 'aria-pressed': 'false', onClick: () => open(p.id) },
    h('span', { class: 'os-guest-path-icon', 'aria-hidden': 'true' }, ic(p.icon)),
    h('span', { class: 'os-guest-path-copy' }, h('strong', { text: p.title }), h('small', { text: p.hint }))));
  const panels = { search: searchPanel, request: requestPanel, offer: offerPanel };
  function open(next) {
    if (next === 'offer' && onOwner) return onOwner();
    path = next;
    for (const t of tiles) t.setAttribute('aria-pressed', String(t.dataset.guestPath === next));
    for (const [id, panel] of Object.entries(panels)) panel.hidden = id !== next;
    // One scope box, moved where it is needed: the request keeps exactly what the search used.
    if (next === 'request') { reqScopeSlot.append(scopeBox); scopeBox.open = true; drawRequestCriteria(); requestAnimationFrame(() => panels.request.scrollIntoView?.({ behavior: 'smooth', block: 'start' })); }
    if (next === 'search' && scopeBox.parentNode !== form) form.insertBefore(scopeBox, status);
  }
  for (const control of [...Object.values(controls)]) control.addEventListener('change', () => { if (path === 'request') drawRequestCriteria(); });
  districts.el.addEventListener('click', () => { if (path === 'request') drawRequestCriteria(); });
  offices.el.addEventListener('click', () => { if (path === 'request') drawRequestCriteria(); });

  // ---- participating offices (public profile only), loaded once; search works even if this fails.
  // The link's office is chosen from the start; loading the list never clears a search already shown.
  if (homeId) offices.set([options.offices[0]], { silent: true });
  api('/os/public/search/options', { officeId: homeId }, { authenticated: false }).then((r) => {
    options = { ...r, offices: r.offices || [] };
    for (const city of r.cities || []) ensureCity(city);
    if (homeId && r.home) {
      const home = r.offices.find((o) => o.id === homeId) || r.home;
      const untouched = offices.values().length === 1 && offices.values()[0].id === homeId;
      // A link kept to its own office always ends on that office, even if the guest cleared it while this loaded.
      if (r.home.allowExpand === false) { offices.set([home], { silent: true }); scopeInput.value = 'office'; }
      else if (untouched) offices.set([home], { silent: true });
      if (r.home.allowExpand === false) { offices.lock(true); scopeNote.textContent = 'هذا الرابط يعرض عروض هذا المكتب ويرسل الطلب له فقط.'; scopeNote.hidden = false; }
    }
    districts.redraw(); offices.redraw(); offerOffice.redraw();
  }).catch(() => { scopeNote.textContent = 'تعذر تحميل قائمة المكاتب الآن — البحث يعمل في جميع المكاتب المشاركة.'; scopeNote.hidden = false; });

  const desk = h('div', { class: 'os-guest-desk os-guest-search', 'data-guest-desk': '' },
    h('div', { class: 'os-guest-paths', role: 'group', 'aria-label': 'ماذا تريد؟' }, tiles),
    searchPanel, requestPanel, offerPanel);
  open(initialPath in panels ? initialPath : 'search');
  return desk;
}

/** The hero shared by the platform page and office links. */
export function guestHero({ level = 'h1' } = {}) {
  return h('header', { class: 'os-guest-hero', 'data-guest-hero': '' },
    h('span', { class: 'os-guest-badge', 'data-guest-badge': '' }, ic('sparkles'), 'بحث ذكي • بدون تسجيل'),
    h(level, { class: 'os-guest-title', text: 'عقارك المناسب يبدأ من هنا' }),
    h('p', { class: 'os-guest-lead', text: 'اكتب طلبك أو حدد مواصفاتك، ونبحث لك عن أفضل العقارات المتاحة.' }));
}

/** Kept for callers of the former search form (office link «أبحث عن عقار», tests). */
export function publicSearchForm(office = null, opts = {}) {
  return guestDesk(office, opts);
}

export function renderPlatformSearch(root, { ownerForm = null, initialText = '', notice = '' } = {}) {
  clear(root);
  append(root, h('main', { class: 'os-app os-public-page os-guest-page', dir: 'rtl' },
    guestHero(), guestDesk(null, { ownerForm, initialText, notice }),
    h('footer', { class: 'os-public-powered' }, h('a', { href: '/', text: 'دخول المكتب العقاري' }))));
  document.title = 'البحث العقاري الذكي | iAqar.ai';
}
