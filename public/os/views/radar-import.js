import { h, append, clear, pageHeader, feedback } from '../core/dom.js';
import { api } from '../core/runtime.js';
import { session } from '../core/session.js';
import { go } from '../core/nav.js';
import { parseRadarExport, RADAR_LIMITS } from '../domain/radar-import-domain.js';
/** File chooser reads locally. The explicit import button is the only network write. */
export function renderRadarImport(container) {
  append(container,pageHeader('وارد رادار الوسيط'));
  if(!session.isManager){append(container,feedback({class:'os-alert bad',text:'الاستيراد لمدير المكتب فقط.'}));return null;}
  let raw=null,busy=false,alive=true,generation=0;
  const message=h('p',{class:'os-sub',role:'status',text:'جارٍ التحقق من توفر الاستيراد…'});
  const preview=h('div'),result=h('div',{role:'status'});
  const include=h('input',{type:'checkbox','aria-label':'إرفاق أدلة أرقام التواصل الإضافية'});
  const submit=h('button',{type:'button',class:'os-btn primary',disabled:true,text:'استيراد إلى المكتب للمراجعة',onClick:async()=>{
    if(!raw||busy)return;busy=true;submit.disabled=true;file.disabled=true;include.disabled=true;clear(result);
    try{const r=await api('/os/radar/import',{officeId:session.officeId,input:raw,includeContacts:include.checked});if(!alive)return;
      append(result,feedback({class:'os-alert',text:`حُفظ: ${r.saved} · حُدّث: ${r.updated} · مكرر: ${r.duplicates}`}),h('p',{class:'os-sub',text:r.processing==='DEFERRED'?'حُفظ الوارد؛ لم تكتمل المعالجة. أعد محاولة الاستيراد أو راجع الباحث لاحقًا.':r.processing==='CYCLE_RAN'?'عملت دورة الباحث؛ راجع نتائجها. تشغيل الدورة لا يثبت اكتمال كل إعلان.':'هذا الملف مستورد سابقًا ولم يُكرر.'}),h('button',{type:'button',class:'os-btn secondary',text:'فتح الباحث ومراجعة الفرص',onClick:()=>go('scout')}));
    }catch(e){if(alive)append(result,feedback({class:'os-alert bad',text:e.message}));}
    finally{busy=false;if(alive){submit.disabled=!raw;file.disabled=false;include.disabled=false;}}
  }});
  const file=h('input',{type:'file',accept:'.json,application/json',multiple:true,'aria-label':'اختيار ملفات تصدير رادار الوسيط',disabled:true,onChange:async()=>{
    const turn=++generation;raw=null;submit.disabled=true;clear(preview);clear(result);
    try{const files=[...file.files];if(!files.length)return;
      if(files.length>RADAR_LIMITS.items||files.reduce((n,f)=>n+f.size,0)>RADAR_LIMITS.bytes)throw Error('اختر حتى 20 ملفًا بحجم إجمالي لا يتجاوز 200 كيلوبايت.');
      const all=[];for(const f of files){const value=JSON.parse(await f.text());all.push(...(Array.isArray(value)?value:[value]));}
      const parsed=parseRadarExport(all);if(!alive||turn!==generation)return;raw=all;
      for(const item of parsed.items)append(preview,h('article',{class:'os-card'},h('h3',{text:[item.structured.kind==='OFFER'?'عرض':'طلب',item.structured.propertyType].join(' · ')}),h('p',{class:'os-sub',text:[item.structured.city||'المدينة غير مؤكدة',item.structured.district].filter(Boolean).join(' · ')}),h('p',{text:item.originalText})));submit.disabled=false;
    }catch(e){if(alive&&turn===generation)append(result,feedback({class:'os-alert bad',text:e.message}));}
  }});
  append(container,h('section',{class:'os-card os-form'},message,h('p',{class:'os-sub',text:'من الرادار: الإعدادات ← الخصوصية والبيانات ← تصدير إعلان داخلي كامل. احفظ ملف JSON ثم اختره هنا. القراءة محلية حتى تضغط استيراد.'}),file,
    h('p',{class:'os-sub',text:'النص الأصلي قد يحتوي أرقام تواصل؛ سيُرسل إلى مكتبك فقط كفرصة خارجية قيد المراجعة. لن تُرسل رسالة ولن يُنشر العرض تلقائيًا.'}),
    h('label',{},include,' إرفاق أدلة أرقام التواصل الإضافية مع أدوارها كما سجّلها الرادار'),preview,submit,result));
  api('/os/radar/status',{officeId:session.officeId}).then(r=>{if(!alive)return;message.textContent=r.message;file.disabled=!r.available;}).catch(e=>{if(alive)message.textContent=e.message;});
  return ()=>{alive=false;generation++;};
}
