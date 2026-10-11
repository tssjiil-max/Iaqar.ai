/** Existing Firebase Staging GA measurement, opt-in, in an opaque empty sandbox. */
const EVENTS = new Set(['tour_visit','watch_click','section_view','marketing_view','demo_step','trial_click','registration_start','registration_complete']);
const SECTIONS = new Set(['intake','repository','matching','communication','negotiation','tasks','marketing','cooperation','day','trial']);
let frame = null;
let ready = false;
let starting = null;
let waiting = [];
let generation = 0;
export function metricPayload(name, details = {}) {
  if (!EVENTS.has(name)) return null;
  return { event_category:'public_tour',page_location:'/tour',page_title:'جولة iAqar',
    ...(SECTIONS.has(details.section)?{section:details.section}:{}) };
}
function consent() { try { return localStorage.getItem('iaqar.tour.metrics'); } catch { return null; } }
function privacyBlocked() { return navigator.globalPrivacyControl || navigator.doNotTrack === '1'; }
function send(name,payload) { frame?.contentWindow?.postMessage({type:'iaqar-tour-event',name,...(payload.section?{section:payload.section}:{})},'*'); }
export function track(name, details = {}) {
  const payload = metricPayload(name,details);
  if (!payload || typeof window === 'undefined' || privacyBlocked() || consent() === 'no') return;
  if (!ready) { if(waiting.length<30)waiting.push([name,payload]);if(consent()==='yes')void startMetrics();return; }
  send(name,payload);
}
export async function startMetrics() {
  if (starting) return starting;
  if (typeof window==='undefined' || consent()!=='yes' || privacyBlocked() || !location.hostname.startsWith('iaqar-ai-staging--')) return;
  const currentGeneration=generation;
  starting=(async()=>{
    try{
      const response=await fetch('/__/firebase/init.json',{credentials:'omit'});if(!response.ok)return;
      const config=await response.json();
      if(currentGeneration!==generation||consent()!=='yes'||config.projectId!=='iaqar-ai-staging'||!/^G-[A-Z0-9]+$/.test(config.measurementId||''))return;
      frame=document.createElement('iframe');frame.hidden=true;frame.title='قياس استخدام الجولة';frame.src='/tour/metrics-frame.html';
      frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('referrerpolicy','no-referrer');
      frame.addEventListener('load',()=>{if(consent()==='yes')frame.contentWindow?.postMessage({type:'iaqar-tour-init',measurementId:config.measurementId},'*');});
      document.body.append(frame);
    }catch{ /* Non-blocking. */ }
  })();return starting;
}
if(typeof window!=='undefined')window.addEventListener('message',event=>{
  if(!frame||event.source!==frame.contentWindow||event.origin!=='null'||event.data?.type!=='iaqar-tour-ready'||consent()!=='yes')return;
  ready=true;for(const [name,payload] of waiting)send(name,payload);waiting=[];
});
export function stopMetrics() { generation++;frame?.remove();frame=null;ready=false;starting=null;waiting=[]; }
export function chooseMetrics(value) {
  try{localStorage.setItem('iaqar.tour.metrics',value?'yes':'no');}catch{return;}
  if(value)void startMetrics();else stopMetrics();
}
export function metricsChoice() { return consent(); }
