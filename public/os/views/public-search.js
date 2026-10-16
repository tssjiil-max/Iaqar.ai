/** Guest journey: one description, editable criteria, contact consent, real public matches. */
import { h, ic, clear, field, append, surface, pageHeader, feedback } from '../core/dom.js';
import { api, workerBase } from '../core/runtime.js';
import { runAction } from '../core/ui.js';
import { formatNumber } from '../domain/format-domain.js';
import { PROPERTY_TYPES } from '../domain/records-domain.js';

export function publicSearchForm(office = null) {
 const id=office?.id||'',requestKey=crypto.randomUUID();
 const description=h('textarea',{class:'os-textarea',name:'description',rows:'3',maxlength:'4000',placeholder:'أبغى شقة تمليك في الجماوات، أربع غرف، بحدود 500 ألف',required:true});
 const status=feedback({class:'os-alert info',role:'status',hidden:true});
 const scope=h('select',{class:'os-input',name:'scope','aria-label':'نطاق البحث'},id?h('option',{value:'office',text:'ابحث في هذا المكتب'}):null,h('option',{value:'all',text:'ابحث في جميع المكاتب'}));
 const controls={
  purpose:h('select',{class:'os-input',name:'purpose'},h('option',{value:'',text:'اختر الغرض'}),h('option',{value:'PURCHASE',text:'شراء'}),h('option',{value:'LEASE_REQUEST',text:'استئجار'})),
  propertyType:h('select',{class:'os-input',name:'propertyType'},h('option',{value:'',text:'اختر نوع العقار'}),PROPERTY_TYPES.map(t=>h('option',{value:t,text:t}))),
  city:h('input',{class:'os-input',name:'city',value:office?.city||'',placeholder:'المدينة المنورة'}),
  district:h('input',{class:'os-input',name:'district',placeholder:'الحي المطلوب'}),
  price:h('input',{class:'os-input',name:'price',inputmode:'decimal',placeholder:'ميزانيتك بالريال'}),
  rooms:h('input',{class:'os-input',name:'rooms',inputmode:'numeric',placeholder:'اختياري'}),
  area:h('input',{class:'os-input',name:'area',inputmode:'decimal',placeholder:'اختياري'})
 };
 const review=h('details',{'data-search-criteria':''},h('summary',{class:'os-sub',text:'راجع مواصفات طلبك وعدّلها'}),h('div',{class:'os-form',style:{marginTop:'16px'}},
  h('div',{class:'os-row2'},field('الغرض',controls.purpose),field('نوع العقار',controls.propertyType)),
  h('div',{class:'os-row2'},field('المدينة',controls.city),field('الحي',controls.district)),
  field('الميزانية (ريال)',controls.price),h('div',{class:'os-row2'},field('عدد الغرف',controls.rooms,{optional:true}),field('المساحة (م²)',controls.area,{optional:true}))));
 const analyze=h('button',{type:'button',class:'os-btn secondary block','data-guest-analyze':''},ic('sparkles'),'استخرج مواصفات طلبي');
 analyze.addEventListener('click',()=>runAction(analyze,async()=>{
  const r=await api('/os/public/search/analyze',{officeId:id,text:description.value},{authenticated:false});const l=r.listings?.[0];
  if(!l?.understood)throw new Error('ما اكتملت قراءة طلبك. وضّح التفاصيل أو أدخل المواصفات يدويًا.');
  controls.purpose.value=l.purpose==='RENT'?'LEASE_REQUEST':l.purpose==='SALE'?'PURCHASE':l.purpose||'';
  for(const k of ['propertyType','city','price','rooms','area'])if(l[k])controls[k].value=String(l[k]);
  controls.district.value=l.districts?.[0]||l.district||'';
  review.open=true;status.className='os-alert info';status.textContent='استخرجنا المواصفات المتوفرة. راجعها وأكمل الناقص ثم اكتب بيانات التواصل.';status.hidden=false;
 },{onError:e=>{status.textContent=e.message;status.className='os-alert bad';status.hidden=false;review.open=true;}}));
 const name=h('input',{class:'os-input',name:'contactName',autocomplete:'name',placeholder:'اسمك الكامل',required:true});
 const phone=h('input',{class:'os-input',name:'contactPhone',type:'tel',inputmode:'tel',dir:'ltr',autocomplete:'tel',placeholder:'05XXXXXXXX',required:true});
 const channel=h('select',{class:'os-input',name:'channel',required:true},h('option',{value:'',text:'اختر قناة التواصل'}),h('option',{value:'whatsapp',text:'واتساب'}),h('option',{value:'telegram',text:'تيليجرام'}));
 const processing=h('input',{type:'checkbox',name:'consentProcessing',required:true}),contact=h('input',{type:'checkbox',name:'consentContact',required:true});
 const submit=h('button',{type:'submit',class:'os-btn primary block','data-guest-search':''},ic('search'),'اعرض العقارات المناسبة');
 const results=h('section',{'aria-live':'polite','data-guest-results':''});
 const form=surface('form',{class:'os-card os-form','data-guest-search-form':'',novalidate:true},
  h('div',{},h('h2',{class:'os-h2',text:'وش العقار اللي تدور عليه؟'}),h('p',{class:'os-sub',text:'اكتب طلبك أو الصق رسالة واتساب. نرتب احتياجك ونعرض لك حتى 10 عقارات مناسبة.'})),
  field('نطاق البحث',scope),field('طلبك العقاري',description),analyze,review,
  h('h3',{class:'os-h2',text:'كيف نتواصل معك؟'}),
  h('div',{class:'os-row2'},field('الاسم الكامل',name),field('رقم جوالك',phone)),field('قناة التواصل المفضلة',channel),
  h('p',{class:'os-field-note',text:'اكتب رقمًا تستخدم عليه القناة المختارة. تيليجرام يحتاج ضغط «بدء» حتى يسمح للنظام بمراسلتك.'}),
  h('div',{class:'os-pref-list'},
   h('label',{class:'os-pref-row'},h('span',{text:'أوافق على معالجة بياناتي لغرض البحث العقاري وإرسال طلبي للمكتب المسؤول عند المتابعة.'}),processing),
   h('label',{class:'os-pref-row'},h('span',{text:'أؤكد أن رقم التواصل يخصني، وأوافق على التواصل معي بخصوص طلبي عبر القناة المختارة.'}),contact)),status,submit,
  h('p',{class:'os-sub',text:'بدون حساب أو تسجيل دخول. بيانات تواصلك لا تظهر لزوار المنصة.'}));
 form.addEventListener('submit',async e=>{
  e.preventDefault();status.hidden=true;
  if(!name.value.trim()||!phone.value.trim()||!channel.value||!processing.checked||!contact.checked){status.textContent='أكمل اسمك ورقمك وقناة التواصل ووافق على معالجة الطلب والتواصل.';status.className='os-alert bad';status.hidden=false;return;}
  await runAction(submit,async()=>{
   const criteria=Object.fromEntries(Object.entries(controls).map(([k,v])=>[k,v.value]));
   const r=await api('/os/public/search',{officeId:id,scope:scope.value,requestKey,criteria,name:name.value,phone:phone.value,channel:channel.value,consentProcessing:processing.checked,consentContact:contact.checked},{authenticated:false});
   clear(results);append(results,pageHeader('العقارات الأقرب لطلبك',{description:r.results.length?`${r.results.length} نتائج فعلية من العروض المصرّح بنشرها`:'ما وجدنا عروضًا منشورة تطابق طلبك حاليًا. تقدر تعدّل المواصفات وتحاول مجددًا.'}));
   for(const [i,x] of r.results.entries())append(results,surface('article',{class:'os-card',style:{marginBottom:'12px'},'data-search-result':x.reference},
    x.imagePath ? h('img',{src:workerBase()+x.imagePath,alt:`${x.propertyType} في ${x.district}`,loading:'lazy',style:{width:'100%',height:'180px',objectFit:'cover',borderRadius:'var(--radius)',marginBottom:'12px'},onError:event=>{event.target.hidden=true;}}) : null,
    h('div',{class:'os-row',style:{justifyContent:'space-between',flexWrap:'wrap'}},h('h3',{class:'os-h2',text:`${i+1}. ${x.propertyType} في ${x.district}`}),h('strong',{text:`${formatNumber(x.price)} ريال`})),
    h('p',{class:'os-sub',text:[x.city,x.officeName,x.rooms?`${x.rooms} غرف`:'',x.area?`${formatNumber(x.area)} م²`:''].filter(Boolean).join(' · ')}),
    h('p',{class:'os-field-note',text:x.nearby?`اقتراح قريب — المسافة الخطية من الموقع المرجعي للحي ${x.distanceKm} كم`:(x.reasons||[]).join(' · ')}),
    h('small',{class:'os-sub',text:`مرجع العقار: ${x.reference}`})));
   append(results,feedback({class:'os-alert info',text:r.contact.message}));
   if(r.contact.telegramLink)append(results,h('a',{class:'os-btn primary block',href:r.contact.telegramLink,target:'_blank',rel:'noopener',text:'ابدأ المحادثة واستلم نتائجك في تيليجرام'}));
   if(r.coverageLimited)append(results,h('p',{class:'os-sub',text:'هذه النتائج من مجموعة العروض التي أمكن فحصها في هذه الجولة.'}));
   results.scrollIntoView({behavior:'smooth',block:'start'});
  },{onError:error=>{review.open=true;status.className='os-alert bad';status.textContent=error.message;status.hidden=false;}});
 });
 return h('div',{},form,results);
}

export function renderPlatformSearch(root){
 clear(root);append(root,h('main',{class:'os-app os-public-page',dir:'rtl',style:{maxWidth:'760px'}},
  pageHeader('ابحث عن عقارك بذكاء',{description:'طلب واحد، وعقارات مناسبة من المكاتب المشاركة. بدون تسجيل دخول.'}),publicSearchForm(),
  h('footer',{class:'os-public-powered'},h('a',{href:'/',text:'دخول المكتب العقاري'}))));
 document.title='البحث العقاري الذكي | iAqar.ai';
}
