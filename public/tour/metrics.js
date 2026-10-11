/** Reuses the Firebase project's configured GA measurement. Opt-in; no office/account data. */
const EVENTS = new Set(['tour_visit','watch_click','section_view','marketing_view','demo_step','trial_click','registration_start','registration_complete']);
const SECTIONS = new Set(['intake','repository','matching','communication','negotiation','tasks','marketing','cooperation','day','trial']);
let enabled = false;
let starting = null;
let waiting = [];
let measurementId = "";
export function metricPayload(name, details = {}) {
  if (!EVENTS.has(name)) return null;
  return { event_category: 'public_tour', page_location: '/tour', page_title: 'جولة iAqar',
    ...(SECTIONS.has(details.section) ? { section: details.section } : {}) };
}
function consent() { try { return localStorage.getItem('iaqar.tour.metrics'); } catch { return null; } }
export function track(name, details = {}) {
  const payload = metricPayload(name, details);
  if (!payload || typeof window === 'undefined') return;
  if (navigator.globalPrivacyControl || navigator.doNotTrack === '1' || consent() === 'no') return;
  if (!enabled) { if (waiting.length < 30) waiting.push([name, payload]); if (consent() === 'yes') void startMetrics(); return; }
  window.gtag('event', name, payload);
}
export async function startMetrics() {
  if (starting) return starting;
  if (typeof window === 'undefined' || consent() !== 'yes' || navigator.globalPrivacyControl || navigator.doNotTrack === '1') return;
  // This first release can collect only on the approved Staging Hosting project.
  if (!location.hostname.startsWith('iaqar-ai-staging--')) return;
  starting = (async () => {
    try {
      const response = await fetch('/__/firebase/init.json', { credentials: 'omit' });
      if (!response.ok) return;
      const config = await response.json();
      if (consent() !== 'yes') return;
      if (config.projectId !== 'iaqar-ai-staging' || !/^G-[A-Z0-9]+$/.test(config.measurementId || '')) return;
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
      measurementId = config.measurementId;
      window['ga-disable-' + measurementId] = false;
      window.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
      window.gtag('js', new Date());
      window.gtag('config', config.measurementId, { send_page_view: false, allow_google_signals: false,
        allow_ad_personalization_signals: false, page_location: location.origin + '/tour', page_referrer: '',
        cookie_flags: 'SameSite=Lax;Secure', cookie_expires: 86400 });
      const script = document.createElement('script'); script.async = true;
      script.src = 'https://www.googletagmanager.com/gtag/js?id=' + config.measurementId;
      document.head.append(script); enabled = true;
      for (const [name, payload] of waiting) window.gtag('event', name, payload);
      waiting = [];
    } catch { /* Analytics must never block the tour or registration. */ }
  })();
  return starting;
}
export function chooseMetrics(value) {
  try { localStorage.setItem('iaqar.tour.metrics', value ? 'yes' : 'no'); } catch { return; }
  if (value) { if (measurementId) window['ga-disable-' + measurementId] = false; void startMetrics(); }
  else { waiting = []; if (measurementId) window['ga-disable-' + measurementId] = true; }
}
export function metricsChoice() { return consent(); }
