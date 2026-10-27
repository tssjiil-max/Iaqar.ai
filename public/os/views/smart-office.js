import { officePublicLink, shareOfficeLink } from './shell.js';
/** Work-first presentation over existing services. No workflow or permission changes. */
import { h, ic, append, clear, surface, pageHeader, loadingState, feedback, emptyState } from '../core/dom.js';
import { session } from '../core/session.js';
import { state, subscribe, startOfficeData } from '../core/state.js';
import { db, docData } from '../core/runtime.js';
import { go } from '../core/nav.js';
import { visibleToActor, taskCardModel } from '../domain/task-domain.js';
import { visibleCards, laneOfGroup, LANE, needsYouTask } from '../domain/agent-domain.js';
import { mine, homeRow, agentCard, brokerAvatar, officeLogo, officeDisplayName, supportCard } from './reference-layout.js';
import { scoutHomeCard } from './scout.js';
import { loadChannels } from '../core/channels.js';
import { loadSupportStatus } from '../core/support.js';
import { followSummary } from '../domain/deal-follow-domain.js';

const actor = () => ({ uid: session.user?.uid, isManager: session.isManager, officeId: session.officeId });
const link = (label, route, icon = 'chev-left') => h('button', {
  type: 'button', class: 'os-btn secondary', 'data-more-route': route, onClick: () => go(route)
}, ic(icon), label);
const section = (title, ...children) => surface('section', { class: 'os-card os-office-section' },
  h('h2', { class: 'os-h2', text: title }), ...children);
function watchDeals(onRows, onError, limit = 100) {
  return db().collection('offices').doc(session.officeId).collection('journeys')
    .orderBy('updatedAt', 'desc').limit(limit + 1)
    .onSnapshot(s => onRows(s.docs.map(docData)), onError);
}
function dealRow(journey) {
  const summary = followSummary(journey, new Date());
  return h('button', { type: 'button', class: 'os-follow-row', 'data-office-deal': journey.id,
    onClick: () => go(`deal/${journey.id}`) }, ic('handshake'),
    h('span', { class: 'os-set-text' }, h('b', { text: journey.offerSummary?.propertyType || 'متابعة الصفقة' }),
      h('small', { text: [summary.stage, summary.nextLabel].filter(Boolean).join(' · ') })), ic('chev-left'));
}
export function renderDeals(container) {
  append(container, pageHeader('الصفقات'));
  const tabs = h('div', { class: 'os-chips', role: 'group', 'aria-label': 'حالة الصفقات' });
  const body = h('div'); append(container, tabs, body);
  let filter = 'active', rows = null, failed = false, alive = true, limit = 100, stop;
  const draw = () => {
    clear(tabs);
    for (const [id, label] of [['active', 'الجارية'], ['closed', 'المغلقة']]) append(tabs,
      h('button', { type: 'button', class: 'os-chip', 'aria-pressed': String(filter === id),
        onClick: () => { filter = id; draw(); }, text: label }));
    clear(body);
    if (failed) { append(body, feedback({ class: 'os-alert bad', text: 'تعذر تحميل الصفقات.' }),
      h('button', { type: 'button', class: 'os-btn secondary', text: 'إعادة المحاولة', onClick: load })); return; }
    if (!rows) { append(body, loadingState()); return; }
    const shown = rows.slice(0, limit).filter(j => visibleToActor(j, actor()))
      .filter(j => /^CLOSED_/.test(j.status || '') === (filter === 'closed'));
    append(body, ...shown.map(dealRow));
    if (!shown.length) append(body, emptyState('handshake', 'لا توجد صفقات في النتائج المحملة', 'تظهر الصفقة هنا عند بدء متابعتها.'));
    if (rows.length > limit) append(body, h('p', { class: 'os-sub', text: 'توجد صفقات أقدم لم تُحمّل بعد.' }),
      h('button', { type: 'button', class: 'os-btn secondary', text: 'تحميل المزيد', onClick: () => { limit += 100; load(); } }));
  };
  const load = () => {
    stop?.(); rows = null; failed = false; draw();
    stop = watchDeals(r => { if (alive) { rows = r; draw(); } }, () => { if (alive) { failed = true; draw(); } }, limit);
  };
  load(); return () => { alive = false; stop?.(); };
}
export function renderSmartOffice(container) {
  const office = session.office || {};
  const root = h('div', { 'data-smart-office': '', class: 'os-form' }); append(container, root);
  append(root, surface('section', { class: 'os-card smart-office-identity' },
    h('span', { class: 'smart-office-logo' }, brokerAvatar(office) || officeLogo(office)),
    h('div', {}, h('h1', { class: 'os-page-title', text: 'المكتب الذكي' }),
      h('p', { 'data-office-name': '', text: officeDisplayName(office) }))),
    h('button', { type: 'button', class: 'os-btn primary block', 'data-quick-add': '', onClick: () => go('quick-add') },
      ic('sparkles'), 'إضافة عرض أو طلب'));
  const work = h('div'), matches = h('div'), deals = h('div'), agent = agentCard();
  append(root,
    section('المطلوب مني الآن', work, link('جميع المهام', 'tasks', 'clipboard')),
    section('فرص ومطابقات للمراجعة', matches),
    section('الصفقات الجارية', deals, link('جميع الصفقات', 'deals', 'handshake')),
    section('مدير المكتب الذكي', agent),
    section('الباحث عن الفرص', scoutHomeCard({ showUnavailable: true })));
  const draw = () => {
    clear(work); clear(matches);
    if (state.error) {
      for (const el of [work, matches]) append(el, feedback({ class: 'os-alert bad', text: state.error }),
        h('button', { type: 'button', class: 'os-btn secondary', text: 'إعادة المحاولة', onClick: () => {
          state.error = ''; state.tasksReady = false; startOfficeData(session.officeId); draw();
        } }));
    } else if (!state.tasksReady) { append(work, loadingState()); append(matches, loadingState()); }
    else {
      const tasks = mine(), reviews = tasks.filter(t => taskCardModel(t).type === 'MATCH_REVIEW');
      const actionable = visibleCards(tasks).filter(g => laneOfGroup(g) === LANE.NEEDS_YOU)
        .map(needsYouTask).filter(t => t && taskCardModel(t).type !== 'MATCH_REVIEW');
      append(work, ...actionable.slice(0, 3).map(homeRow));
      if (!actionable.length) append(work, h('p', { class: 'os-sub', text: 'لا إجراء مطلوب في المهام المحملة حاليًا.' }));
      append(matches, ...reviews.slice(0, 3).map(homeRow));
      if (!reviews.length) append(matches, h('p', { class: 'os-sub', text: 'لا مطابقات للمراجعة في المهام المحملة.' }));
      append(matches, link('كل المطابقات', 'tasks?step=0', 'reference-target'));
      if (state.tasks.length >= 300) append(work, h('p', { class: 'os-sub', text: 'قد توجد مهام إضافية خارج النتائج المحملة.' }));
    }
    agent.fill();
  };
  append(deals, loadingState()); let alive = true;
  const stop = watchDeals(rows => {
    if (!alive) return; clear(deals);
    const shown = rows.slice(0, 100).filter(j => visibleToActor(j, actor()) && !/^CLOSED_/.test(j.status || ''));
    append(deals, ...shown.slice(0, 3).map(dealRow));
    if (!shown.length) append(deals, h('p', { class: 'os-sub', text: 'لا صفقات جارية في النتائج المحملة.' }));
    if (rows.length > 100) append(deals, h('p', { class: 'os-sub', text: 'افتح جميع الصفقات لتحميل المزيد.' }));
  }, () => {
    if (alive) { clear(deals); append(deals, feedback({ class: 'os-alert bad', text: 'تعذر تحميل الصفقات.' }),
      h('button', { type: 'button', class: 'os-btn secondary', text: 'إعادة تحميل الصفقات', onClick: () => go('office') })); }
  });
  draw(); const off = subscribe(draw); return () => { alive = false; off(); stop(); };
}
export function renderMore(container, { tools = false, support = false, publicLink = false } = {}) {
  append(container, pageHeader(publicLink ? 'رابط المكتب' : support ? 'الدعم والمساعدة' : tools ? 'أدوات مساندة' : 'المزيد'));
  if(publicLink){
    append(container,section('معاينة ومشاركة رابط المكتب',
      h('a',{class:'os-btn secondary',href:officePublicLink(),target:'_blank',rel:'noopener noreferrer'},ic('link'),'معاينة بوابة العميل'),
      h('button',{type:'button',class:'os-btn primary',onClick:shareOfficeLink},ic('link'),'مشاركة رابط المكتب')));
    return null;
  }
  if (support) {
    const card = supportCard(); append(container, card); let alive = true;
    Promise.all([loadChannels(session.officeId), loadSupportStatus(session.officeId)]).then(([channels, status]) => {
      if (alive) card.fill({ channels: channels.channels || [], support: status });
    }).catch(() => { if (alive) append(container, feedback({ class: 'os-alert bad', text: 'تعذر تحميل حالة الدعم. أعد فتح الصفحة للمحاولة.' })); });
    return () => { alive = false; };
  }
  const items = tools ? [['الدليل', 'tools/guide', 'clipboard'], ['النماذج', 'tools/forms', 'contract'],
    ['الحاسبة', 'tools/calculator', 'coins'], ['الخدمات الرسمية', 'tools/services', 'link']] : [
    ['أدوات مساندة', 'more/tools', 'clipboard'], ['مؤشرات المكتب', 'tools/market', 'chart-up'],
    ['البيانات والمستندات', 'library', 'archive'], ['التعاون بين الوسطاء', 'community', 'handshake'],
    ['البحث الشامل', 'search', 'search'], ['الإشعارات', 'settings/notifications', 'bell'],
    ['الدعم والمساعدة', 'more/support', 'support'],
    ['معاينة ومشاركة رابط المكتب', session.isManager ? 'settings/link' : 'more/link', 'link'], ...(session.isManager ? [
      ['ملف المكتب والإعدادات', 'settings', 'gear'],
      ['سجل النشاط', 'audit', 'clipboard']] : [])];
  append(container, surface('section', { class: 'os-card os-more-links' }, items.map(([label, route, icon]) => link(label, route, icon))));
  return null;
}
