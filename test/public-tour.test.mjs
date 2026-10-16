import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('public root opens tour while office, party and auth deep links keep their destination', () => {
  const source = readFileSync(new URL('../public/tour/entry.js', import.meta.url), 'utf8');
  for (const [pathname, search, hash, expected] of [
    ['/', '', '', '/tour'], ['/', '', '#/office', null], ['/', '', '#/register', null],
    ['/o/demo', '', '', null], ['/m/demo', '', '', null], ['/', '?office=demo', '', null],
    ['/', '?cv2Party=demo', '', null], ['/', '?openOperation=demo', '', null], ['/add', '', '', null]
  ]) {
    let redirected = null;
    vm.runInNewContext(source, { location: { pathname, search, hash, replace: x => redirected = x } });
    assert.equal(redirected, expected, [pathname, search, hash].join(''));
  }
});

test('tour metrics reject arbitrary names and never serialize personal fields', async () => {
  const { metricPayload } = await import('../public/tour/metrics.js');
  assert.equal(metricPayload('customer_phone', { phone: 'PRIVATE' }), null);
  assert.deepEqual(metricPayload('trial_click', { phone: 'PRIVATE', email: 'PRIVATE', section: 'marketing', url: 'PRIVATE' }),
    { event_category: 'public_tour', page_location: '/tour', page_title: 'جولة iAqar', section: 'marketing' });
  assert.equal(metricPayload('section_view', { section: 'PRIVATE' }).section, undefined);
});

test('public tour uses no live office store, registration is the existing approval form', () => {
  const html = readFileSync(new URL('../public/tour.html', import.meta.url), 'utf8');
  assert.match(html, /dir="rtl"/);
  assert.match(html, /href="\/\?tour=1#\/register"/);
  const js = readFileSync(new URL('../public/tour/tour.js', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /core\/(state|session|runtime|live)\.js|firestore\(|api\(|fetch\(/);
  assert.match(html, /معاينة تجريبية/);
  assert.match(html, /مسودة/);
  assert.doesNotMatch(html, /0552019909|0501111111|AIza|TOKEN|حصري/);
});

test('metrics require opt-in, sanitize events, and disable GA again after withdrawal', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<html><head></head><body></body></html>', { url:'https://iaqar-ai-staging--staging-9c4b0k7h.web.app/tour?phone=PRIVATE' });
  const restore = new Map();
  for (const [key,value] of Object.entries({window:dom.window,document:dom.window.document,location:dom.window.location,localStorage:dom.window.localStorage,navigator:dom.window.navigator,fetch:async()=>({ok:true,json:async()=>({projectId:'iaqar-ai-staging',measurementId:'G-EXAMPLE'})})})) {
    restore.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true});
  }
  try {
    const m = await import('../public/tour/metrics.js?consent-test');
    m.track('tour_visit',{phone:'PRIVATE'});await m.startMetrics();assert.equal(document.querySelectorAll('script').length,0);
    m.chooseMetrics(true);await m.startMetrics();assert.equal(document.querySelectorAll('iframe').length,1);
    assert.equal(document.querySelector('iframe').getAttribute('sandbox'),'allow-scripts');
    assert.equal(document.querySelector('iframe').getAttribute('referrerpolicy'),'no-referrer');
    assert.equal(window.gtag,undefined);
    m.chooseMetrics(false);m.track('trial_click');assert.equal(document.querySelectorAll('iframe').length,0);
  } finally { for(const [key,descriptor] of restore){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}dom.window.close(); }
});
