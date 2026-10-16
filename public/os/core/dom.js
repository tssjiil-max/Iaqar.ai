/**
 * Minimal DOM builder. Text is always set through textContent, so data from
 * Firestore or visitors can never inject markup.
 */

import { icon } from "./icons.js";

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

export function append(el, ...children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === "") continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function ic(name, opts) {
  return icon(name, opts);
}

/** Button with an icon and label. */
export function btn(label, { kind = "primary", iconName = "", chevron = false, block = false, onClick, type = "button", attrs = {} } = {}) {
  const el = h("button", { type, class: `os-btn ${kind}${block ? " block" : ""}`, ...attrs }, iconName ? ic(iconName) : null, h("span", { text: label }), chevron ? ic("chev-left", {}) : null);
  if (chevron) el.lastChild.classList.add("chev");
  if (onClick) el.addEventListener("click", onClick);
  return el;
}

export function field(label, control, { hint = "", error = "", optional = false } = {}) {
  const wrap = h("label", { class: `os-field${error ? " invalid" : ""}` },
    h("span", {}, label, optional ? h("small", { text: " (اختياري)" }) : null),
    control,
    hint ? h("small", { text: hint }) : null,
    h("span", { class: "os-error", role: "alert", text: error || "" })
  );
  return wrap;
}

export function setFieldError(root, name, message) {
  const control = root.querySelector(`[name="${name}"]`);
  const wrap = control?.closest(".os-field");
  if (!wrap) return;
  wrap.classList.toggle("invalid", Boolean(message));
  const slot = wrap.querySelector(".os-error");
  if (slot) slot.textContent = message || "";
}

export function clearFieldErrors(root) {
  root.querySelectorAll(".os-field.invalid").forEach((el) => el.classList.remove("invalid"));
  root.querySelectorAll(".os-error").forEach((el) => { el.textContent = ""; });
}

export function emptyState(iconName, title, text, action = null) {
  return h("div", { class: "os-empty", "data-ui": "empty-state" },
    h("span", { class: "os-state-icon", "aria-hidden": "true" }, ic(iconName)),
    h("div", { class: "os-state-copy" }, h("h3", { text: title }), text ? h("p", { class: "os-sub", text }) : null),
    action ? h("div", { class: "os-state-actions" }, action) : null);
}

/** Shared office composition. Callers pass their original controls, not copies. */
const PAGE_IDENTITIES = [
  [/مطابق/, 'match', 'مراجعة الخيارات المناسبة ومتابعة إجراءاتها'],
  [/الباحث|بحث|البحث/, 'search', 'البحث في الفرص وبيانات المكتب'],
  [/مكتبة|ملف|مستند/, 'archive', 'تنظيم ملفات المكتب ومتابعة مستنداته'],
  [/قنوات|التواصل/, 'send', 'إدارة التواصل وقنوات المكتب'],
  [/إشعار|تنبيه/, 'bell', 'متابعة التنبيهات وتفضيلات الاستقبال'],
  [/تفاوض|صفقة|فرصة/, 'handshake', 'متابعة المعاملة وخطواتها من مكان واحد'],
  [/مدير المكتب/, 'robot', 'إدارة أعمال المكتب ومتابعة إجراءاته'],
  [/التعاون|الوسطاء/, 'broker', 'تنظيم التعاون وتوزيع المسؤوليات'],
  [/سجل|عرض|طلب|إضافة/, 'offers', 'إدارة العروض والطلبات وبياناتها'],
  [/الحاسبة|السوق|مؤشر/, 'chart-up', 'أدوات ومؤشرات تساعدك في أعمال المكتب'],
  [/إعداد|بيانات المكتب|رابط المكتب/, 'gear', 'إدارة المكتب وتفضيلاته'],
  [/مهام/, 'tasks-check', 'متابعة المعاملات والمواعيد اليومية']
];

export function pageHeader(title, { backControl = null, action = null, iconName = '', description } = {}) {
  const titleNode = title instanceof Node ? title : h('h1', { class: 'os-page-title', text: title });
  const identity = PAGE_IDENTITIES.find(([pattern]) => pattern.test(titleNode.textContent)) || [null, 'office', 'أعمال المكتب العقاري'];
  // Old callers used an empty span for the grid's third column. It is not an action.
  const hasAction = action && (action.textContent?.trim() || action.children?.length || action.matches?.('button,a,input,select'));
  return h('header', { class: 'os-page-head os-page-header', 'data-ui': 'page-header' },
    backControl || hasAction ? h('div', { class: 'os-page-toolbar' }, backControl, hasAction ? h('div', { class: 'os-page-actions' }, action) : null) : null,
    h('div', { class: 'os-page-heading' },
      h('span', { class: 'os-page-icon', 'aria-hidden': 'true' }, ic(iconName || identity[1])),
      h('div', { class: 'os-page-copy' }, titleNode,
        description instanceof Node ? description : (description ?? identity[2]) ? h('p', { class: 'os-sub', text: description ?? identity[2] }) : null)));
}

/** One surface constructor across lists, forms and detail views; DOM identity is preserved. */
export function surface(tag = 'section', props = {}, ...children) {
  const classes = new Set(['os-card', ...String(props.class || '').split(/\s+/).filter(Boolean)]);
  return h(tag, { ...props, class: [...classes].join(' '), 'data-ui': 'surface' }, ...children);
}

/** The same icon / title / supporting line hierarchy used by office tool tiles. */
export function navigationTile({ title, hint = '', iconName = 'office', tone = 'blue', attrs = {}, onClick }) {
  return h('button', { ...attrs, type: 'button', class: `os-set-row ref-reference-tool ref-office-tool tone-${tone}`, 'data-ui': 'navigation-tile', onClick },
    h('span', { class: 'ref-reference-icon os-set-icon', 'aria-hidden': 'true' }, ic(iconName)),
    h('span', { class: 'ref-reference-copy os-set-text' }, h('strong', { text: title }), hint ? h('small', { text: hint }) : null),
    ic('chev-left'));
}

export function dialogHeading(title, onClose) {
  return h('div', { class: 'os-sheet-head', 'data-ui': 'dialog-heading' },
    h('div', { class: 'os-page-heading' }, h('span', { class: 'os-page-icon', 'aria-hidden': 'true' }, ic('clipboard')),
      h('h2', { class: 'os-h2', text: title })),
    h('button', { type: 'button', class: 'os-icon-btn', 'aria-label': 'إغلاق', onClick: onClose }, ic('x')));
}

/** Common tab/filter/action grouping; callers retain selection logic and ARIA semantics. */
export function controlGroup(tag = 'div', props = {}, ...children) {
  return h(tag, { ...props, class: `${props.class || ''} os-control-group`.trim(), 'data-ui': 'control-group' }, ...children);
}

/** Shared loading composition; it never clears or owns the caller's data. */
export function loadingState(props = {}) {
  return h('div', { ...props, class: `os-skeleton ${props.class || ''}`.trim(), 'data-ui': 'loading', role: 'status', 'aria-busy': 'true' },
    h('span', { class: 'os-sr-only', text: 'جارٍ التحميل…' }),
    h('div', { class: 'os-loading-lines', 'aria-hidden': 'true' },
      h('span', {}), h('span', {}), h('span', {})));
}

/** One feedback composition for error, warning and informational states. */
export function feedback(props = {}, ...children) {
  const { text, ...attrs } = props;
  const tone = String(props.class || '');
  return h('div', { ...attrs, class: `${tone} os-feedback`.trim(), 'data-ui': 'feedback', role: props.role || (tone.includes('bad') ? 'alert' : 'status') },
    h('span', { class: 'os-feedback-icon', 'aria-hidden': 'true' }, ic(tone.includes('bad') || tone.includes('warn') ? 'alert' : 'info')),
    text ? h('span', { class: 'os-feedback-copy', text }) : null, ...children);
}

/** Shared comparison grid; accepts existing cell nodes and keeps column order in RTL. */
export function comparisonTable({ label, columns, rows, className = 'os-compare' }) {
  return h('table', { class: className, 'data-ui': 'comparison-table', 'aria-label': label },
    h('thead', {}, h('tr', {}, columns.map(text => h('th', { scope: 'col', text })))),
    h('tbody', {}, rows.map(cells => h('tr', {}, cells.map(cell => h('td', {}, cell))))));
}
