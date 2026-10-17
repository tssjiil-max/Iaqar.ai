/** Manager-only Staging panel. No provider SDK, external sends or local-storage customer data. */
import { h, append, clear, pageHeader, feedback } from '../core/dom.js';
import { api } from '../core/runtime.js';
import { session } from '../core/session.js';
import { go } from '../core/nav.js';
import { runAction } from '../core/ui.js';

export function renderEconomicTest(container) {
  const call=(action,input={})=>api(`/os/economic/${action}`,{officeId:session.officeId,...input});
  const status=h('p',{class:'os-sub',text:'جارٍ التحقق من نطاق التجربة…','data-economic-status':''});
  const rows=h('div',{class:'os-center-list','data-economic-messages':''});
  const results=h('div',{'aria-live':'polite','data-economic-results':''});
  const text=h('textarea',{class:'os-textarea',rows:4,maxlength:4000,placeholder:'الصق رسالة عرض أو طلب تجريبي…','aria-label':'نص الرسالة التجريبية','data-economic-text':''});
  const submit=h('button',{type:'button',class:'os-btn primary',text:'استقبال رسالة محاكاة','data-economic-ingest':''});
  const sweep=h('button',{type:'button',class:'os-btn secondary',text:'فحص صلاحية العقارات دون مراسلة','data-economic-sweep':''});
  const examples=[['عرض أرض','للبيع أرض في الرياض حي الملقا المساحة 500 متر السعر 500 ألف'],['طلب شراء','مطلوب شراء أرض في الرياض حي الملقا المساحة 500 متر الميزانية 550 ألف'],['إبلاغ بيع','الأرض انباعت']];
  const controls=h('div',{class:'os-form-actions'},...examples.map(([name,value])=>h('button',{type:'button',class:'os-btn secondary',text:name,onClick:()=>{text.value=value;}})));
  const form=h('section',{class:'os-card',hidden:true,'data-economic-form':''},h('h2',{class:'os-h2',text:'تجربة الاستقبال والصندوق العقاري'}),
    h('p',{class:'os-sub',text:'التحليل بقواعد محدودة من النظام الحالي. راجع الحقول قبل حفظها. الرسائل هنا محاكاة؛ المطابقة والحفظ ينفذهما محرك المكتب الفعلي على بيانات Staging.'}),controls,text,submit,sweep);
  append(container,pageHeader(h('h1',{class:'os-page-title',text:'وضع التجارب الاقتصادية'}),{backControl:h('button',{type:'button',class:'os-back',text:'رجوع',onClick:()=>go('agent')})}),
    feedback({class:'os-alert',text:'Staging فقط • قواعد محلية دون Claude أو OpenAI • لا إرسال إلى واتساب أو تيليجرام • التعايش مع الرقم الحالي غير مثبت باختبار حي.'}),status,form,results,rows);
  async function refresh(){
    const data=await call('status');
    status.textContent='الوضع الاقتصادي جاهز — مزود التحليل: قواعد النظام • الإرسال: متوقف • الاتصال الحي بواتساب: يحتاج تحقق Meta';
    form.hidden=false;clear(rows);
    for(const message of data.messages||[]) rows.append(messageCard(message));
  }
  function messageCard(m){
    const a=m.economicAnalysis||{};
    const card=h('section',{class:'os-card','data-economic-message':m.id},h('h2',{class:'os-h2',text:m.economicSimulation?'رسالة محاكاة':'رسالة واردة من WhatsApp Cloud API'}),
      h('small',{class:'os-sub',text:`المصدر: ${m.source} • التاريخ: ${new Date(m.receivedAt).toLocaleString('ar-SA')}`}),h('p',{dir:'auto',text:m.messageText||''}));
    const fields=[['نوع السجل',a.kind==='OFFER'?'عرض':a.kind==='REQUEST'?'طلب':'غير محدد'],['العقار',a.propertyType],['المدينة',a.city],['الحي',a.districts?.join('، ')],['السعر أو الميزانية',a.price||'غير مذكور'],['المساحة',a.area||'غير مذكورة']];
    card.append(h('dl',{},...fields.flatMap(([label,value])=>[h('dt',{text:label}),h('dd',{text:String(value||'غير محدد')})])));
    const check=h('input',{type:'checkbox','data-economic-confirm':'','aria-label':'راجعت الحقول وهوية صاحب السجل وأوافق على الحفظ'});
    const confirm=h('label',{class:'os-sub'},check,' راجعت الحقول وهوية صاحب السجل وأوافق على الحفظ');
    if(m.economicAvailabilityIntent){card.append(h('p',{class:'os-sub',text:'إبلاغ عن حالة عقار: لم يُعدّل أي سجل. افتح العرض المقصود أدناه وحدده وأكد التحديث، أو راجعه في الصندوق.'}));return card;}
    if(!m.economicRecordId){
      const name=h('input',{class:'os-input',placeholder:'اسم صاحب السجل التجريبي','aria-label':'اسم صاحب السجل التجريبي','data-economic-name':''});
      const phone=h('input',{class:'os-input',type:'tel',dir:'ltr',placeholder:'05XXXXXXXX','aria-label':'الجوال التجريبي','data-economic-phone':''});
      const save=h('button',{type:'button',class:'os-btn primary',text:'حفظ بعد المراجعة','data-economic-save':''});
      save.addEventListener('click',()=>runAction(save,async()=>{await call('save',{inboxId:m.id,contactName:name.value,contactPhone:phone.value,confirmed:check.checked});await refresh();}));
      card.append(name,phone,confirm,save);
    }else{
      card.append(h('p',{class:'os-sub',text:`السجل: ${m.economicRecordId}`}));
      card.append(h('button',{type:'button',class:'os-btn secondary',text:'فتح في الصندوق العقاري',onClick:()=>go(`record/${m.economicRecordId}`)}));
      if(a.kind==='REQUEST'){
        const search=h('button',{type:'button',class:'os-btn primary',text:'مطابقة من بيانات المكتب','data-economic-search':''});
        search.addEventListener('click',()=>runAction(search,async()=>{const r=await call('search',{recordId:m.economicRecordId});clear(results);results.append(h('h2',{class:'os-h2',text:`نتائج محرك المطابقة الفعلي: ${r.candidates.length}`}));for(const c of r.candidates){const reference=h('p',{class:'os-sub',dir:'ltr',style:{overflowWrap:'anywhere'},text:`المرجع: ${String(c.referenceCode).slice(0,36)} • التوافق: ${c.score}`});const match=h('div',{class:'os-card'},reference);match.append(h('p',{class:'os-sub',style:{overflowWrap:'anywhere'},text:`المصدر: ${c.source} • آخر تحقق: ${c.lastVerifiedAt?new Date(c.lastVerifiedAt).toLocaleDateString('ar-SA'):'غير موثق'}`}),h('p',{class:'os-sub',style:{overflowWrap:'anywhere'},text:(c.reasons||[]).join('، ')}));const start=h('button',{type:'button',class:'os-btn secondary',text:'بدء مسار صفقة تجريبي','data-economic-pair':''});start.addEventListener('click',()=>runAction(start,async()=>{const paired=await call('pair',{recordId:m.economicRecordId,counterpartId:c.recordId});if(paired.journeyId){results.append(h('p',{class:'os-sub',text:'يوجد مسار مفتوح مسبقًا.'}),h('button',{type:'button',class:'os-btn primary',text:'فتح مسار الصفقة',onClick:()=>go(`journey/${paired.journeyId}`)}));return;}if(!paired.matchId)throw Error('تعذر إنشاء المطابقة');const approved=h('button',{type:'button',class:'os-btn primary',text:'اعتماد المطابقة وفتح الصفقة','data-economic-approve':''});const confirm=h('input',{type:'checkbox','data-economic-approve-confirm':'','aria-label':'أؤكد أن هذه مطابقة تجريبية للمراجعة'});results.append(h('p',{class:'os-sub',text:'حُفظت المطابقة ومهمة مراجعتها في النظام الحالي. لم يتم إرسال أي إشعار.'}),h('label',{class:'os-sub'},confirm,' أؤكد أن هذه مطابقة تجريبية للمراجعة'),approved);approved.addEventListener('click',()=>runAction(approved,async()=>{const done=await call('approve',{matchId:paired.matchId,confirmed:confirm.checked});if(!done.journeyId)throw Error('لم ينشأ مسار الصفقة');results.append(h('p',{class:'os-sub',text:'المفاوضة والمعاينة والمتابعة والإغلاق متاحة عبر مساحة الصفقة الموجودة.'}),h('button',{type:'button',class:'os-btn primary',text:'فتح مسار الصفقة',onClick:()=>go(`journey/${done.journeyId}`)}));}));}));match.append(start);results.append(match);}if(!r.candidates.length)results.append(h('p',{text:'لا توجد عقارات مؤهلة مطابقة الآن.'}));}));card.append(search);
      }else{
        const soldCheck=h('input',{type:'checkbox','data-economic-sold-confirm':''});
        const sold=h('button',{type:'button',class:'os-btn secondary',text:'تأكيد أن هذا العرض التجريبي بيع','data-economic-sold':''});
        sold.addEventListener('click',()=>runAction(sold,async()=>{await call('availability',{recordId:m.economicRecordId,answer:'SOLD',confirmed:soldCheck.checked});clear(results);results.append(h('p',{text:'تم تسجيل البيع للعرض المحدد واستبعاده من المطابقات الجديدة. أعد البحث للتحقق.'}));await refresh();}));card.append(h('label',{class:'os-sub'},soldCheck,' تحققت من هوية صاحب العرض ومن أن هذا هو العقار المقصود'),sold);
      }
    }
    return card;
  }
  let pendingKey='';
  submit.addEventListener('click',()=>runAction(submit,async()=>{pendingKey||=crypto.randomUUID();await call('ingest',{text:text.value,messageKey:pendingKey});pendingKey='';text.value='';await refresh();}));
  sweep.addEventListener('click',()=>runAction(sweep,async()=>{const r=await call('sweep');clear(results);results.append(h('p',{text:`اكتمل فحص الصلاحية دون مراسلة. إعادة تقييم المطابقة: ${r.rematched||0}. المتابعة البشرية: ${r.attention||0}.`}));await refresh();}));
  refresh().catch(()=>{status.textContent='الوضع غير مفعّل لهذا المكتب. يلزم ضبط معرّف مكتب سلطان نفسه على خادم Staging؛ لم نفترض معرّفًا تجريبيًا بدل مكتبك.';});
  return null;
}
