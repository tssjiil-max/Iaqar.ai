import { h, ic, clear } from '../os/core/dom.js';
import { compareRecords } from '../os/domain/match-review-domain.js';
import { roomPropertyCard, roomAgreedCard, sidesCard } from '../os/views/session-parts.js';
import { track, chooseMetrics, metricsChoice, startMetrics } from './metrics.js';
// Fixed data only. No database, account, API, phone number or real office identifier.
const request = Object.freeze({ kind:'REQUEST', purpose:'PURCHASE', propertyType:'عمارة', city:'المدينة المنورة', district:'الهجرة', price:2000000 });
const offer = Object.freeze({ kind:'OFFER', purpose:'SALE', propertyType:'عمارة', city:'المدينة المنورة', district:'الهجرة', price:1900000 });
const sections = ['intake','matching','communication','negotiation'];
const stories = {
 intake:['المعلومة كما وصلتك','ألصق. راجع. احفظ.','التعبئة الذكية ترتب المعلومات في نفس حقول النموذج. والتعبئة اليدوية موجودة متى احتجتها.'],
 matching:['ظهرت فرصة مناسبة','راجع قبل التواصل.','تُنشأ مهمة مراجعة. قارن العرض بالطلب ثم اعتمد وابدأ التفاوض، أو اطلب معلومات أو أجّل أو ارفض.'],
 communication:['بعد اعتماد المطابقة','حدد الخطوة للطرفين.','جهّز مقترح موعد أو سعر أو سؤالًا. شارك الرابط مع الطرف المطلوب، وتابع رده من المكتب.'],
 negotiation:['غرفة واحدة للصفقة','شاهد ما اتفقوا عليه.','المالك والعميل والوسيط في رحلة واحدة. قبول موعد المعاينة لا يعني الاتفاق على سعر البيع.']
};
function room() {
 return [roomPropertyCard({propertyType:'عمارة',stageLabel:'تفاوض',priceStatus:'NEGOTIABLE',priceStatusLabel:'قابل للتفاوض',facts:[
 {id:'type',label:'نوع العقار',value:'عمارة'}, {id:'district',icon:'pin',label:'الحي',value:'الهجرة'},
 {id:'price',icon:'coins',label:'السعر المطلوب',value:'1,900,000 ريال',strong:true}, {id:'purpose',icon:'home',label:'الغرض',value:'بيع'}]}),
 roomAgreedCard([{id:'viewing',label:'المعاينة',value:'الأربعاء · 5:00 مساءً',meta:'موعد توضيحي — قبله الطرفان'}]),
 sidesCard({owner:{price:1900000,lastText:'السعر المطلوب — قابل للتفاوض'},client:{price:0,lastText:'يرغب بالمعاينة قبل اقتراح السعر'}}),
 h('p',{class:'review-notice',text:'الخطوة التالية: متابعة نتيجة المعاينة. لم يُتفق على سعر البيع بعد.'})];
}
function fields() { return h('div',{class:'demo-fields'},[['نوع الطلب','شراء'],['نوع العقار','عمارة'],['الأحياء','الهجرة، شوران'],['الميزانية','2,000,000 ريال'],['المدينة','المدينة المنورة'],['الاستعجال','مستعجل']].map(([label,value])=>h('div',{},h('small',{text:label}),h('b',{text:value})))); }
function next(label,key) { return h('button',{type:'button',class:'button primary full demo-next',onClick:()=>show(key)},label,ic('chev-left')); }
const panel=document.getElementById('demo-panel');
function intake() {
 const content=h('div'); let mode='smart';
 const draw=()=>{
  clear(content);
  content.append(h('h3',{text:'إضافة طلب'}));
  const toggle=h('div',{class:'mode-row',role:'group','aria-label':'طريقة التعبئة في المثال'});
  for(const [key,label] of [['smart','تعبئة ذكية'],['manual','تعبئة يدوية']])toggle.append(h('button',{type:'button','aria-pressed':String(key===mode),onClick:()=>{mode=key;draw();}},label));
  content.append(toggle);
  if(mode==='smart'){
   const result=h('div');
   const analyze=h('button',{class:'button primary full',type:'button',onClick:()=>{
    result.replaceChildren(fields(),h('p',{class:'review-notice',text:'راجع البيانات قبل الحفظ. المدينة مقترحة من مدينة المكتب التجريبي؛ لم تُذكر في الرسالة.'}),next('شاهد المطابقة','matching'));
    analyze.hidden=true;
   }},ic('sparkles'),'شاهد ترتيب المثال');
   content.append(h('small',{text:'الصق إعلانك أو اكتب التفاصيل'}),h('div',{class:'paste-box',text:'مطلوب عمارة في الهجرة أو شوران، الميزانية 2 مليون، مستعجل.'}),analyze,result);
  }else content.append(fields(),h('p',{class:'review-notice',text:'نفس الحقول ونفس مسار المراجعة والحفظ. هذه نسخة توضيحية لا تقبل إدخال بيانات.'}),next('شاهد المطابقة','matching'));
 };
 draw(); return content;
}
function matching() {
 const rows=compareRecords(offer,request).filter(r=>['type','location','price','purpose'].includes(r.key));
 return h('div',{},h('h3',{text:'مراجعة المطابقة'}),h('span',{class:'record-label',text:'مثال يحتاج مراجعة الوسيط'}),
 h('table',{class:'compare-table'},h('thead',{},h('tr',{},h('th',{text:'المقارنة'}),h('th',{text:'العرض'}),h('th',{text:'الطلب'}))),h('tbody',{},rows.map(row=>h('tr',{},h('td',{text:row.label}),h('td',{text:row.offer}),h('td',{text:row.request}))))),
 h('p',{class:'review-notice',text:'نوع العقار والموقع متوافقان، والسعر ضمن الميزانية. تُراجع التفاصيل قبل الاعتماد.'}),next('شاهد ما يحدث بعد الاعتماد','communication'),h('p',{class:'caption',text:'لا تُرسل المطابقة للأطراف قبل قرار الوسيط. لا نحسب نسبة مصطنعة في هذه الجولة.'}));
}
function communication() {
 const response=h('div');
 const act=h('button',{class:'button primary full',type:'button',onClick:()=>{
  response.replaceChildren(h('div',{class:'prepared-message',text:'رد توضيحي: العميل وافق على الموعد؛ المالك لم يرد بعد.'}),h('p',{class:'review-notice',text:'تظهر المتابعة في المكتب. الموعد لم يكتمل تأكيده بعد.'}),next('شاهد غرفة التفاوض','negotiation'));
  act.hidden=true;
 }},'شاهد رد الطرف');
 return h('div',{},h('h3',{text:'تحديد معاينة'}),h('div',{class:'demo-fields'},h('div',{},h('small',{text:'الموعد المقترح'}),h('b',{text:'الأربعاء · 5:00 مساءً'})),h('div',{},h('small',{text:'إلى'}),h('b',{text:'المالك والعميل'}))),h('div',{class:'prepared-message',text:'السلام عليكم، نقترح معاينة العمارة في الهجرة يوم الأربعاء الساعة 5:00 مساءً. افتح رابط الرد لتأكيد المناسبة أو اقتراح موعد آخر.'}),h('p',{class:'caption',text:'رسالة ورابط منفصلان بحسب الطرف. لا يتم إرسال شيء من الجولة.'}),act,response);
}
function show(key) {
 if(!sections.includes(key)||!panel)return;
 track('demo_step',{section:key});
 document.querySelectorAll('[data-demo]').forEach(button=>{const active=button.dataset.demo===key;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
 panel.setAttribute('aria-labelledby','tab-'+key);
 const [label,title,text]=stories[key];
 document.getElementById('demo-story').replaceChildren(h('span',{class:'eyebrow',text:label}),h('h3',{text:title}),h('p',{text}),h('div',{class:'demo-foot'},ic('lock'),'مثال ثابت. لا حفظ، لا إرسال، لا بيانات حقيقية.'));
 panel.replaceChildren(key==='intake'?intake():key==='matching'?matching():key==='communication'?communication():h('div',{},h('h3',{text:'غرفة التفاوض'}),...room()));
}
for(const slot of document.querySelectorAll('[data-icon]'))slot.replaceChildren(ic(slot.dataset.icon));
if(panel){
 show('intake');
 document.querySelectorAll('[data-demo]').forEach(button=>{
  button.addEventListener('click',()=>show(button.dataset.demo));
  button.addEventListener('keydown',event=>{
   let i=sections.indexOf(button.dataset.demo);
   if(event.key==='ArrowLeft')i=(i+1)%sections.length;
   else if(event.key==='ArrowRight')i=(i+sections.length-1)%sections.length;
   else if(event.key==='Home')i=0;else if(event.key==='End')i=sections.length-1;else return;
   event.preventDefault();show(sections[i]);document.getElementById('tab-'+sections[i]).focus();
  });
 });
 document.querySelectorAll('[data-show]').forEach(button=>button.addEventListener('click',()=>{
  show(button.dataset.show);document.getElementById('journey').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});
  document.getElementById('tab-'+button.dataset.show).focus({preventScroll:true});
 }));
 const preview=document.getElementById('room-preview');preview?.querySelector('.room-fallback')?.replaceWith(h('div',{},...room().slice(0,3)));
 track('tour_visit');
 document.querySelectorAll('[data-track]').forEach(link=>link.addEventListener('click',()=>track(link.dataset.track)));
 if('IntersectionObserver' in window){
  const seen=new Set();const observer=new IntersectionObserver(entries=>{
   for(const entry of entries)if(entry.isIntersecting){const key=entry.target.dataset.section;if(seen.has(key))continue;seen.add(key);track('section_view',{section:key});if(key==='marketing')track('marketing_view',{section:key});observer.unobserve(entry.target);}
  },{threshold:0.15});
  document.querySelectorAll('[data-section]').forEach(section=>observer.observe(section));
 }
 const choice=document.getElementById('metrics-choice');
 choice.hidden=Boolean(metricsChoice())||navigator.globalPrivacyControl||navigator.doNotTrack==='1';
 document.querySelectorAll('[data-consent]').forEach(button=>button.addEventListener('click',()=>{chooseMetrics(button.dataset.consent==='yes');choice.hidden=true;}));
 document.getElementById('metrics-settings')?.addEventListener('click',()=>{choice.hidden=false;choice.querySelector('button').focus();});
 void startMetrics();
}
