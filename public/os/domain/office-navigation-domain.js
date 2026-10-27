/** Internal destinations: public office links remain deliberate secondary actions. */
export const OFFICE_NAV = Object.freeze([
  ['office', 'المكتب', 'dashboard'],
  ['repo', 'العروض والطلبات', 'reference-home'],
  ['deals', 'الصفقات', 'handshake'],
  ['inbox', 'الوارد', 'inbox-in'],
  ['more', 'المزيد', 'reference-menu']
]);
export function navigationSection(route = '') {
  const section = String(route).replace(/^#\/?/, '').split(/[/?]/)[0];
  if (['repo', 'record', 'quick-add'].includes(section)) return 'repo';
  if (['deals', 'deal', 'journey', 'session', 'review'].includes(section)) return 'deals';
  if (['inbox', 'conversations'].includes(section)) return 'inbox';
  if (['more', 'settings', 'tools', 'library', 'community', 'audit', 'search'].includes(section)) return 'more';
  return 'office';
}
