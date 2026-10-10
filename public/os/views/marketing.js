import { h,ic,clear,append,field } from '../core/dom.js';
import { session } from '../core/session.js';
import { api } from '../core/runtime.js';
import { go,back } from '../core/nav.js';
import { toast } from '../core/ui.js';
import { drawMarketing,marketingPng } from '../core/marketing-renderer.js';
import { MARKETING_TYPES,MARKETING_CHANNELS,makeDraft,marketingText,marketingTrackedLink,marketingIdentityKey,marketingDraftText } from '../domain/marketing-domain.js';
export function renderMarketing(container) {
 clear(container);
 const style=document.createElement('link');style.rel='stylesheet';style.href='/os/marketing.css';
 const styleReady=new Promise((resolve,reject)=>{style.onload=resolve;style.onerror=()=>reject(new Error('تعذر تحميل تنسيق الاستوديو'));});document.head.append(style);
 const officeId=session.officeId;let alive=true;let data=null;let tab='campaigns';let draft=null;let previewReady=false;let drawId=0;let busy=false;
 const valid=()=>alive&&session.officeId===officeId;
 const content=h('div',{class:'os-marketing-content'});const tabs=h('div',{class:'os-marketing-tabs',role:'group','aria-label':'أقسام مدير التسويق'});
 append(container,h('div',{class:'os-page-head'},h('button',{class:'os-back',type:'button',onClick:()=>back('office')},ic('chev-right'),'رجوع'),h('h1',{class:'os-page-title',text:'مدير التسويق'})),h('p',{class:'os-sub',text:'عرّف بمكتبك وخدماته ورابطه. جهّز الإعلان، راجعه، ثم شاركه.'}),tabs,content);
 const button=(label,fn,primary=false,attrs={})=>h('button',{type:'button',class:'os-btn '+(primary?'primary':'secondary'),onClick:()=>run(fn),...attrs},label);
 async function run(fn){if(busy)return;busy=true;try{await fn();}catch(e){if(valid())toast(e.message||'تعذر تنفيذ الإجراء','bad');}finally{busy=false;}}
 async function request(body={}){const result=await api('/os/marketing',{officeId,...body});if(!valid())throw new Error('تغير المكتب');return result;}
 async function reload(){const next=await request({action:'load'});if(valid()){data=next;draw();}}
 const row=(...children)=>h('div',{class:'os-btn-row'},children);
 const note=text=>h('p',{class:'os-sub',text});
 const title=text=>h('h2',{class:'os-h2',text});
 function select(options,value,onChange){const el=h('select',{class:'os-input',onChange:e=>onChange(e.target.value)},options.map(([id,label])=>h('option',{value:id,text:label})));el.value=value;return el;}
 function start(type='intro',channel='واتساب') {
  const label=MARKETING_TYPES.find(t=>t.id===type)?.label||MARKETING_TYPES[0].label;
  draft={...makeDraft({headline:label,body:data.profile.services||'أرسل عقارك أو طلبك عبر رابط مكتبنا',size:'square',type,channel}),status:'draft'};tab='studio';draw();
 }
 function draw(){if(!valid()||!data)return;drawId++;clear(tabs);clear(content);
  for(const [id,label] of [['campaigns','اقتراحات الحملات'],['opportunities','فرص الظهور'],['studio','التصاميم الجاهزة'],['copy','النصوص الإعلانية'],['report','تقارير الأداء']])tabs.append(h('button',{type:'button','aria-pressed':String(tab===id),text:label,onClick:()=>{tab=id;draw();}}));
  if(tab==='campaigns')campaigns();if(tab==='studio')studio();if(tab==='copy')copy();if(tab==='opportunities')opportunities();if(tab==='report')report();
 }
 function campaigns(){
  content.append(note('اقتراحات مبنية على بيانات مكتبك؛ الميزانية المقترحة للاختبار ولا تُصرف تلقائيًا.'),button('تجهيز إعلان بالذكاء الاصطناعي',async()=>{const r=await request({action:'generate',type:'intro'});if(r.generation.status!=='ready'){toast(r.generation.message,'bad');return;}draft={...r.generation.draft,status:'draft'};tab='studio';draw();},true));
  if(data.canManage){const area=h('input',{class:'os-input',value:data.settings.area,maxlength:80});const audience=h('input',{class:'os-input',value:data.settings.audience,maxlength:80});const budget=h('input',{class:'os-input',type:'number',min:0,max:100000,value:data.settings.budget});
   content.append(h('details',{class:'os-card'},h('summary',{text:'تخصيص خطة المكتب'}),field('المنطقة المستهدفة',area),field('الجمهور',audience),field('ميزانية الاختبار بالريال',budget),button('حفظ الإعدادات',async()=>{await request({action:'settings',settings:{area:area.value,audience:audience.value,budget:budget.value}});await reload();},true)));
  }
  for(const c of data.campaigns)content.append(h('article',{class:'os-card'},title(c.title),note(c.goal),h('p',{text:`الجمهور: ${c.audience}`}),note(`القناة: ${c.channel} · الميزانية: ${c.budget?c.budget+' ريال للاختبار':'بدون ميزانية مدفوعة'}`),h('p',{text:c.idea}),note(c.reason),row(button('تجهيز الحملة',()=>start(c.id,c.channel),true),button('تجاهل',async()=>{await request({action:'ignore',campaignId:c.id});await reload();}))));
  content.append(title('خطة الأسبوع المقترحة'));
  for(const p of data.weeklyPlan)content.append(h('article',{class:'os-card'},h('b',{text:`${p.date} — ${p.title}`}),note(`${p.channel} · ${p.time}`),button('تجهيز التصميم',()=>start(p.id,p.channel))));
 }
 function studio(){
  if(!draft)draft={...makeDraft({headline:'تعرّف على مكتبنا',body:data.profile.services||'أرسل عقارك أو طلبك عبر رابط مكتبنا',size:'square'}),status:'draft'};
  const canvas=h('canvas',{class:'os-marketing-preview','aria-label':'معاينة الإعلان',role:'img'});const error=h('p',{class:'os-error',role:'alert'});const status=h('p',{class:'os-sub',text:draft.status==='approved'?'معتمد — جاهز للمشاركة':'مسودة — راجع التصميم ثم احفظه واعتمده'});
  const headline=h('input',{class:'os-input',maxlength:100,value:draft.headline,'data-marketing-headline':''});const body=h('textarea',{class:'os-textarea',rows:4,maxlength:500,'data-marketing-body':''});body.value=draft.body;
  function changed(key,value){draft={...draft,[key]:value,status:'draft',approvedBy:'',approvedAt:''};status.textContent='مسودة — احفظ التعديل ثم اعتمده';void preview();}
  headline.addEventListener('input',()=>changed('headline',headline.value));body.addEventListener('input',()=>changed('body',body.value));
  async function preview(){const id=++drawId;previewReady=false;error.textContent='جارٍ تجهيز المعاينة…';try{const temp=document.createElement('canvas');await styleReady;await drawMarketing(temp,data.profile,draft);if(valid()&&id===drawId){canvas.width=temp.width;canvas.height=temp.height;canvas.getContext('2d').drawImage(temp,0,0);previewReady=true;error.textContent='';}}catch(e){if(valid()&&id===drawId){error.textContent=e.message;canvas.width=0;canvas.height=0;}}}
  const controls=h('div',{class:'os-marketing-controls'},field('نوع الإعلان',select(MARKETING_TYPES.map(t=>[t.id,t.label]),draft.type,type=>{draft={...draft,type,headline:MARKETING_TYPES.find(t=>t.id===type).label,status:'draft'};draw();})),field('العنوان',headline),field('النص',body),field('المقاس',select([['square','منشور 1080×1080'],['story','ستوري / حالة 1080×1920'],['social','مشاركة 1200×630'],['banner','بنر 1600×600']],draft.size,v=>changed('size',v))),field('القالب',select([['clean','أبيض بسيط'],['frame','إطار الهوية'],['petrol','لون هوية المكتب']],draft.template,v=>changed('template',v))),field('الخط',select([['plex','الخط المعتمد — IBM Plex'],['tajawal','تجوال'],['naskh','نسخ — Noto Naskh'],['kufi','كوفي — Noto Kufi']],draft.font,v=>changed('font',v))));
  for(const [key,label,min,max] of [['fontSize','حجم العنوان',28,80],['textX','الموضع الأفقي',12,88],['textY','الموضع الرأسي',30,65]])controls.append(field(label,h('input',{class:'os-input',type:'range',min,max,value:draft[key],onInput:e=>changed(key,Number(e.target.value))})));
  async function save(){if(!previewReady)throw new Error('أصلح المعاينة قبل الحفظ');const r=await request({action:'save',draft});draft=r.draft;data=r;draw();}
  async function approve(){if(!previewReady)throw new Error('أصلح المعاينة قبل الاعتماد');const reviewedIdentity=marketingIdentityKey(data.profile);const r=await request({action:'save',draft});const a=await request({action:'approve',id:r.draft.id,version:r.draft.version,identityKey:reviewedIdentity});draft=a.draft;data=a;draw();}
  async function png(){if(!previewReady)throw new Error('انتظر اكتمال المعاينة');return marketingPng(canvas);}
  async function download(){const blob=await png();const url=URL.createObjectURL(blob);const a=h('a',{href:url,download:`office-marketing-${draft.size}.png`});a.click();setTimeout(()=>URL.revokeObjectURL(url),15000);}
  async function share(channel){if(draft.status!=='approved')throw new Error('احفظ الإعلان واعتمده قبل المشاركة');const tracked=marketingTrackedLink(data.profile.link,draft.id,channel);const text=marketingDraftText(data.profile,draft,channel);const url=channel==='واتساب'?`https://wa.me/?text=${encodeURIComponent(text)}`:`https://t.me/share/url?url=${encodeURIComponent(tracked)}&text=${encodeURIComponent(text)}`;window.open(url,'_blank','noopener,noreferrer');toast('فُتحت المشاركة؛ أرفق الصورة بعد تنزيلها. لم يؤكد النظام النشر','ok');}
  content.append(h('div',{class:'os-marketing-studio'},h('section',{class:'os-card'},controls),h('section',{class:'os-card'},canvas,error,status,row(button('حفظ المسودة',save,true,{'data-marketing-save':''}),data.canManage?button('اعتماد',approve,false,{'data-marketing-approve':''}):null,button('تنزيل PNG',download,false,{'data-marketing-download':''})),row(button('مشاركة الصورة',async()=>{if(draft.status!=='approved')throw new Error('اعتمد الإعلان قبل المشاركة');const blob=await png();const file=new File([blob],'office-marketing.png',{type:'image/png'});if(!navigator.canShare?.({files:[file]}))throw new Error('مشاركة الملفات غير مدعومة هنا؛ نزّل الصورة وشاركها');await navigator.share({files:[file],text:marketingDraftText(data.profile,draft,draft.channel)});}),button('واتساب',()=>share('واتساب')),button('تيليجرام',()=>share('تيليجرام'))))));
  content.append(title('مسودات المكتب'));
  for(const d of data.drafts)content.append(h('article',{class:'os-card'},h('b',{text:d.headline}),note(d.status==='approved'?'معتمد':'مسودة'),row(button('فتح وتعديل',()=>{draft={...d};draw();}),button('حذف',async()=>{await request({action:'delete',id:d.id});if(draft?.id===d.id)draft=null;await reload();}))));
  void preview();
 }
 function copy(){const type=select(MARKETING_TYPES.map(t=>[t.id,t.label]),draft?.type||'intro',()=>fill());const channel=select(MARKETING_CHANNELS.map(c=>[c,c]),draft?.channel||'واتساب',()=>fill());const target=h('div');
  function fill(){clear(target);for(const [length,label] of [['short','نسخة قصيرة'],['medium','نسخة متوسطة']]){const text=h('textarea',{class:'os-textarea',rows:6,'aria-label':label});text.value=marketingText(data.profile,type.value,length,channel.value);target.append(h('article',{class:'os-card'},title(`${label} — ${channel.value}`),text,button('نسخ النص',async()=>{await navigator.clipboard.writeText(text.value);toast('تم نسخ النص','ok');})));}}
  content.append(row(field('نوع الإعلان',type),field('القناة',channel)),note('نصوص مبنية على بيانات المكتب. يمكنك تعديلها قبل النسخ والنشر.'),target);fill();
 }
 function opportunities(){content.append(note(data.search.message),button('البحث عن فرص ظهور',async()=>{const r=await request({action:'search'});if(r.search?.status==='requires_configuration'){toast(r.search.message,'bad');return;}data=r;draw();},true),note('ظهور الرابط في البحث لا يثبت السماح بالإعلان أو أن النشر مجاني. راجع الشروط بنفسك.'));
  for(const o of data.opportunities)content.append(h('article',{class:'os-card'},title(o.name),note(o.description),h('a',{href:o.url,target:'_blank',rel:'noopener noreferrer',text:'فتح الموقع'}),note(`المصدر: ${o.source} · آخر فحص: ${o.checkedAt}`),note(`التكلفة: ${o.pricing} · الجمهور: ${o.audience}`),note(o.terms),note(o.nextAction),note(o.verification==='indexed'?'ظهر في مصدر البحث':'لم يظهر في آخر إعادة بحث؛ صلاحية الرابط غير مؤكدة'),row(button(o.favourite?'إزالة من المفضلة':'حفظ بالمفضلة',async()=>{await request({action:'favourite',id:o.id,favourite:!o.favourite});await reload();}),button('إعادة البحث عن الرابط',async()=>{await request({action:'recheck',id:o.id});await reload();}))));
 }
 function report(){content.append(h('article',{class:'os-card'},title('نشاط تجهيز الإعلانات'),h('p',{text:`المسودات المحفوظة: ${data.report.drafts} · المعتمدة: ${data.report.approved}`}),note('هذه أعداد تجهيز داخل المكتب؛ لا تعني أن الإعلانات نُشرت.')),h('article',{class:'os-card'},title('نتائج استقطاب العملاء'),note(data.report.message),note('الزيارات: غير متاح · مصادر الزيارات: غير متاح · التحويلات: غير متاح · أفضل حملة: غير متاح')));}
 content.append(note('جارٍ تحميل بيانات مكتبك…'));run(reload);
 return ()=>{alive=false;drawId++;data=null;draft=null;style.remove();};
}
