import { SPECIALTIES } from "./office-profile-domain.js";
import { isSafePhotoDataUrl } from "./avatar-domain.js";
/** Office promotion only: this module never accepts property records or customer data. */
const text = (v,n=160) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim().slice(0,n);
export const MARKETING_SIZES = Object.freeze({square:[1080,1080],story:[1080,1920],social:[1200,630],banner:[1600,600]});
export const MARKETING_TYPES = Object.freeze([
 {id:'intro',label:'تعرّف على مكتبنا'}, {id:'owners',label:'أضف عقارك عبر مكتبنا'},
 {id:'buyers',label:'تبحث عن عقار؟ أرسل طلبك'}, {id:'services',label:'خدمات مكتبنا العقاري'},
 {id:'link',label:'رابط مكتبنا السحابي'}, {id:'contact',label:'تواصل معنا'}, {id:'custom',label:'تصميم حر'}
]);
export const MARKETING_CHANNELS = ['واتساب','تيليجرام','سناب شات','إنستغرام','فيسبوك','إعلان مدفوع'];
export function safeOpportunityUrl(value) {
 try {
  const u=new URL(value); const host=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||u.port||!host.includes('.')||/^[\d.]+$/.test(host)||host.includes(':')||/(^|\.)(localhost|local|internal|test|invalid)$/.test(host))return '';
  return u.href;
 }catch{return '';}
}
export function marketingProfile(office={},link='') {
 const specialties=Array.isArray(office.specialties)?SPECIALTIES.filter(s=>office.specialties.includes(s.value)).map(s=>s.label).join(' · '):'';
 const services=specialties||(Array.isArray(office.services)?office.services.filter(x=>typeof x==='string').map(x=>text(x,60)).slice(0,8).join(' · '):text(office.servicesSummary||office.services,300));
 const color=/^#[\da-f]{6}$/i.test(office.brandColor||office.themeColor||'')?(office.brandColor||office.themeColor):'#03677A';
 return {name:text(office.officeName||office.businessName||office.name,100),city:text(office.city||office.address?.city,80),phone:text(office.publicPhone||office.phone||office.mobile||office.mobileNumber,40),logoUrl:office.logoUrl?text(office.logoUrl,2000):(isSafePhotoDataUrl(office.brokerPhotoUrl)?office.brokerPhotoUrl:''),services,color,link:text(link,2000)};
}
export function makeDraft(input={}) {
 if(!MARKETING_SIZES[input.size||'square'])throw new Error('اختر مقاسًا صحيحًا');
 const headline=text(input.headline,100);if(!headline)throw new Error('اكتب عنوان الإعلان');
 const clamp=(v,a,b,d)=>Number.isFinite(Number(v))?Math.max(a,Math.min(b,Number(v))):d;
 return {headline,body:text(input.body,500),size:input.size||'square',type:MARKETING_TYPES.some(t=>t.id===input.type)?input.type:'intro',template:['clean','frame','petrol'].includes(input.template)?input.template:'clean',font:['plex','tajawal','naskh','kufi'].includes(input.font)?input.font:'plex',fontSize:clamp(input.fontSize,28,80,52),textX:clamp(input.textX,12,88,50),textY:clamp(input.textY,30,65,44),channel:MARKETING_CHANNELS.includes(input.channel)?input.channel:'واتساب'};
}
export function marketingText(p,type='intro',length='medium',channel='واتساب') {
 const phrases={intro:'تعرّف على خدمات مكتبنا العقاري',owners:'لديك عقار ترغب في عرضه؟ أضف بياناته عبر رابط مكتبنا',buyers:'تبحث عن عقار للشراء أو الإيجار؟ أرسل طلبك عبر مكتبنا',services:'تعرّف على خدمات مكتبنا',link:'رابط واحد للتواصل مع مكتبنا وإرسال عقارك أو طلبك',contact:'يسعدنا تواصلك مع مكتبنا العقاري',custom:'تواصل مع مكتبنا'};
 if(channel==='سناب شات')return [p.name,phrases[type]||phrases.intro,'أرسل طلبك عبر الرابط:',p.link].filter(Boolean).join('\n');
 if(channel==='إعلان مدفوع')return [p.name,phrases[type]||phrases.intro,p.city?`خدمات المكتب في ${p.city}`:'','تواصل مع مكتبنا:',p.link].filter(Boolean).join('\n');
 const lead=channel==='تيليجرام'?'خدمات مكتبنا العقاري':channel==='إنستغرام'?'تعرّف علينا':channel==='فيسبوك'?'يسعدنا التعريف بمكتبنا':'';
 return [lead,p.name,phrases[type]||phrases.intro,length==='medium'&&p.city?`نخدمك في ${p.city}`:'',length==='medium'?p.services:'',p.phone?`للتواصل: ${p.phone}`:'','أرسل عقارك أو طلبك عبر الرابط:',p.link].filter(Boolean).join('\n');
}
export function marketingCampaigns(p,settings={}) {
 const budget=Math.max(0,Math.min(100000,Number(settings.budget)||0));
 const area=text(settings.area,80)||p.city; const audience=text(settings.audience,80);
 return [
  {id:'owners',title:'عرّف الملاك بمكتبك',goal:'استقبال عروض جديدة',audience:audience||`ملاك العقارات${area?' في '+area:''}`,channel:'واتساب',idea:'تصميم تعريفي يشرح كيف يرسل المالك عقاره للمكتب',reason:`ينشر رابط ${p.name||'المكتب'} لدى الملاك في نطاقك`,budget:0},
  {id:'buyers',title:'سهّل وصول الباحثين عن عقار',goal:'استقبال طلبات شراء أو إيجار',audience:audience||`الباحثون عن عقار${area?' في '+area:''}`,channel:'إنستغرام',idea:'تصميم «تبحث عن عقار؟ أرسل طلبك»',reason:'دعوة واضحة إلى تسجيل الطلب من رابط المكتب',budget:0},
  {id:'intro',title:'اختبر حملة تعريف محلية',goal:'زيادة التعرف على المكتب ورابطه',audience:audience||area||'جمهور المكتب المحلي',channel:budget?'إعلان مدفوع':'سناب شات',idea:p.services?`تعريف بالخدمات: ${p.services}`:'تعريف باسم المكتب وطريقة التواصل',reason:'اختبار رسالة تعريفية قبل التوسع في الإنفاق',budget:budget?Math.min(budget,100):0}
 ];
}
export function weeklyMarketingPlan(p,settings={},date=new Date()) {
 const start=new Date(date);return marketingCampaigns(p,settings).map((c,i)=>({ ...c,date:new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',weekday:'long',month:'short',day:'numeric'}).format(new Date(start.getTime()+i*2*86400000)),time:'8:00 مساءً — وقت مقترح للاختبار، بتوقيت الرياض'}));
}

export function marketingIdentityKey(profile) {
 let hash=2166136261;for(const char of JSON.stringify(profile)){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(36);
}
export function marketingTrackedLink(link,draftId,channel='واتساب') {
 const url=new URL(link);const channels={'واتساب':'whatsapp','تيليجرام':'telegram','سناب شات':'snapchat','إنستغرام':'instagram','فيسبوك':'facebook','إعلان مدفوع':'paid'};
 url.searchParams.set('utm_source',channels[channel]||'office');url.searchParams.set('utm_medium',channel==='إعلان مدفوع'?'paid_social':'social');url.searchParams.set('utm_campaign',String(draftId||'office').slice(0,80));return url.href;
}

export function marketingDraftText(profile,draft,channel='واتساب') {
 return [profile.name,draft.headline,draft.body,profile.phone?`للتواصل: ${profile.phone}`:'','أرسل عقارك أو طلبك عبر الرابط:',marketingTrackedLink(profile.link,draft.id,channel)].filter(Boolean).join('\n');
}
