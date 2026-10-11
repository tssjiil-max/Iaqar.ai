/** Opaque sandbox: GA sees this empty document, never the registration or office DOM. */
(function () {
  const events = new Set(['tour_visit','watch_click','section_view','marketing_view','demo_step','trial_click','registration_start','registration_complete']);
  const sections = new Set(['intake','repository','matching','communication','negotiation','tasks','marketing','cooperation','day','trial']);
  let ready = false;
  addEventListener('message', function (event) {
    if (event.source !== parent || !/^https:\/\/iaqar-ai-staging--[a-z0-9-]+\.web\.app$/.test(event.origin)) return;
    const message = event.data || {};
    if (message.type === 'iaqar-tour-init' && !ready && /^G-[A-Z0-9]+$/.test(message.measurementId || '')) {
      window.dataLayer = [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      // No cookies or persistent client identity. Explicit visitor opt-in still controls loading.
      window.gtag('consent', 'default', { analytics_storage:'denied', ad_storage:'denied', ad_user_data:'denied', ad_personalization:'denied' });
      window.gtag('js', new Date());
      window.gtag('config', message.measurementId, { send_page_view:false, allow_google_signals:false,
        allow_ad_personalization_signals:false, page_location:event.origin+'/tour', page_referrer:'',
        page_title:'جولة iAqar', client_id:crypto.randomUUID() });
      const script = document.createElement('script');script.async=true;
      script.src='https://www.googletagmanager.com/gtag/js?id='+message.measurementId;
      document.head.append(script);ready=true;
      parent.postMessage({type:'iaqar-tour-ready'},event.origin);
    } else if (message.type === 'iaqar-tour-event' && ready && events.has(message.name)) {
      window.gtag('event',message.name,{event_category:'public_tour',page_location:event.origin+'/tour',page_referrer:'',page_title:'جولة iAqar',
        ...(sections.has(message.section)?{section:message.section}:{})});
    }
  });
})();
