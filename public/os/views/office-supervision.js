/** Replaceable presentation only; actual records, tasks and existing action routes. */
import { h, append, clear, loadingState, feedback, emptyState } from '../core/dom.js';
import { icon3d } from '../core/icons.js';
import { session } from '../core/session.js';
import { state, subscribe } from '../core/state.js';
import { go } from '../core/nav.js';
import { SPECIALTIES } from '../domain/office-profile-domain.js';
import { recordView } from '../domain/records-domain.js';
import { taskPathStep } from '../domain/task-domain.js';
import { mine, homeRow, brokerAvatar, officeLogo, officeDisplayName } from './reference-layout.js';
import { shareOfficeLink } from './shell.js';
import { renderRadarImport } from './radar-import.js';
const TABS=[['العروض والطلبات','repo'],['المطابقة','tasks?step=0'],['المتابعة','inbox'],['المعاينة','tasks'],['إنهاء الصفقات','deals']];
export function renderOfficeSupervision(container){
 const office=session.office||{};let active=0,cleanupChild=null;
 const root=h('div',{class:'os-form office-supervision','data-office-supervision':''});append(container,root);
 const profile=h('details',{class:'os-card supervision-profile',open:true},h('summary',{},h('span',{class:'supervision-avatar'},brokerAvatar(office)||officeLogo(office)),h('span',{},h('h1',{class:'os-page-title',text:officeDisplayName(office)}),h('p',{class:'os-sub',text:office.brokerName||'بيانات صاحب المكتب غير مكتملة'})),h('small',{class:'os-sub',text:'طي / إظهار'})),h('p',{class:'os-sub',text:`رخصة فال: ${office.licenseNumber||'غير مسجلة'}`}),h('p',{class:'os-sub',text:SPECIALTIES.filter(s=>office.specialties?.includes(s.value)).map(s=>s.label).join(' · ')||'الأنشطة غير مسجلة'}));
 const tabs=h('nav',{class:'supervision-tabs',role:'tablist','aria-label':'مراحل المكتب'}),body=h('section',{role:'tabpanel','aria-live':'polite'});
 append(root,profile,h('button',{type:'button',class:'os-btn primary block',onClick:()=>go('quick-add'),text:'إضافة عرض أو طلب'}),tabs,body);
 function draw(){cleanupChild?.();cleanupChild=null;clear(tabs);clear(body);
  TABS.forEach(([label,route],i)=>append(tabs,h('button',{type:'button',role:'tab',id:`supervision-tab-${i}`,'aria-controls':'supervision-panel','aria-selected':String(active===i),class:'os-btn '+(active===i?'primary':'secondary'),onClick:()=>{active=i;draw();}},icon3d(route,'office'),h('span',{text:label}))));
  body.id='supervision-panel';body.setAttribute('aria-labelledby',`supervision-tab-${active}`);
  append(body,h('h2',{class:'os-h2',text:TABS[active][0]}));
  if(state.error){append(body,feedback({class:'os-alert bad',text:state.error}));return;}
  if(active===0){
   if(!state.recordsReady){append(body,loadingState());return;}
   const records=state.records||[];
   for(const r of records){const v=recordView(r);append(body,h('button',{type:'button',class:'ref-home-row supervision-record',onClick:()=>go('record/'+r.id)},icon3d('repo','building'),h('span',{class:'ref-row-copy'},h('b',{text:v.title||r.propertyType||'عقار'}),h('small',{text:v.location||'الموقع غير مكتمل'})),h('span',{class:'os-chip',text:r.kind==='REQUEST'?'طلب':'عرض'})));}
   if(!records.length)append(body,emptyState('building','لا توجد سجلات محملة','استورد من الرادار ثم راجع الفرصة في الباحث واعتمدها لتظهر ضمن السجلات.'));
   append(body,h('button',{type:'button',class:'os-btn secondary',text:'استيراد إعلان حقيقي من الرادار',onClick:()=>{clear(body);cleanupChild=renderRadarImport(body);}}));
  }else{
   if(!state.tasksReady){append(body,loadingState());return;}
   const stages=active===1?[0]:active===2?[1,2]:active===3?[3]:[4,5];
   const tasks=mine().filter(t=>stages.includes(taskPathStep(t)));append(body,...tasks.map(homeRow));
   if(!tasks.length)append(body,emptyState('calendar','لا معاملات في هذه المرحلة ضمن النتائج المحملة','تُعرض المعاملات الفعلية فقط.'));
   if(active===4)append(body,h('button',{type:'button',class:'os-btn secondary',text:'الصفقات الجارية والمغلقة',onClick:()=>go('deals')}));
  }
 }
 append(root,h('div',{class:'supervision-links'},h('button',{type:'button',class:'os-btn ghost',text:'رابط المكتب',onClick:shareOfficeLink}),h('button',{type:'button',class:'os-btn ghost',text:'الإعدادات',onClick:()=>go('settings')}),h('button',{type:'button',class:'os-btn ghost',text:'المكتب الحالي',onClick:()=>go('office')})));
 draw();const stop=subscribe(()=>{if(!cleanupChild)draw();});return ()=>{stop();cleanupChild?.();};
}
