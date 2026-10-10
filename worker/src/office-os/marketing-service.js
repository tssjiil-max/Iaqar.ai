import { generateMarketing } from "./marketing-ai.js";
import { marketingProfile, marketingIdentityKey, makeDraft, marketingCampaigns, weeklyMarketingPlan, safeOpportunityUrl } from '../../../public/os/domain/marketing-domain.js';
import { officeShareUrl } from '../../../public/os/domain/share-card-domain.js';
const statePath=id=>['offices',id,'marketingState','main'];
const txt=(v,n=120)=>String(v??'').trim().slice(0,n);
const fail=(ctx,code,status,message)=>{throw ctx.deps.appError(code,status,message);};
function assertStaging(ctx){if(ctx.env.DEPLOYMENT_ENV!=='staging')fail(ctx,'marketing_staging_only',403,'مدير التسويق متاح في النسخة التجريبية فقط');}
async function readState(ctx){const path=statePath(ctx.officeId);await ctx.store.create(path,{drafts:[],opportunities:[],ignored:[],settings:{budget:0,area:'',audience:''},lastSearchAt:0});return ctx.store.get(path);}
export async function searchMarketing(ctx,query) {
 const key=String(ctx.env.BRAVE_SEARCH_API_KEY||'').trim();if(!key)return {status:'requires_configuration',message:'يتطلب ربط خدمة البحث',results:[]};
 const response=await fetch('https://api.search.brave.com/res/v1/web/search?'+new URLSearchParams({q:query,count:'8',country:'SA',search_lang:'ar'}),{headers:{'Accept':'application/json','X-Subscription-Token':key},signal:AbortSignal.timeout(15000)});
 if(!response.ok)fail(ctx,'search_failed',502,'تعذر البحث الآن؛ لم تُنشأ نتائج بديلة');
 const data=await response.json(); const now=ctx.now().toISOString();
 const results=(data.web?.results||[]).slice(0,8).flatMap(r=>{const url=safeOpportunityUrl(r.url);return url?[{id:url,url,name:txt(r.title,180),description:txt(r.description,500),source:'Brave Search',sourceUrl:url,checkedAt:now,verification:'indexed',pricing:'غير معروف',terms:'تحقق من شروط القناة وإذن الإعلان قبل النشر',audience:'يُراجع حسب محتوى الموقع',nextAction:'افتح الموقع وراجع شروط الإعلان أو التواصل',favourite:false}]:[];});
 return {status:'ready',results,message:'روابط ظهرت في مصدر البحث؛ وجودها لا يثبت السماح بالإعلان أو استجابة الرابط المباشرة'};
}
export async function marketingAction(ctx,body,actor) {
 assertStaging(ctx);
 const action=txt(body.action||'load',30);
 const allowed=['load','generate','settings','save','approve','delete','ignore','search','favourite','recheck'];
 if(!allowed.includes(action))fail(ctx,'invalid_action',400,'إجراء غير صالح');
 const office=await ctx.store.get(['offices',ctx.officeId]);if(!office)fail(ctx,'not_found',404,'المكتب غير موجود');
 const origin=ctx.appOrigin||'https://iaqar.ai';
 const profile=marketingProfile(office,officeShareUrl({slug:office.publicSlug,officeId:ctx.officeId,origin,hostname:new URL(origin).hostname,workerOrigin:ctx.workerOrigin||ctx.env.MARKETING_WORKER_ORIGIN||'https://iaqar-intake-staging.iaqar-ai.workers.dev',preview:office.sharePreviewFormat==='immutable-v2'?office.shareCardNonce:''}));
 const identityKey=marketingIdentityKey(profile);const snapshot={...profile,logoUrl:''};
 let state=await readState(ctx); const path=statePath(ctx.officeId);const now=ctx.now().toISOString();
 const manager=()=>{if(!actor.isManager)fail(ctx,'forbidden',403,'هذا الإجراء لمدير المكتب فقط');};
 const id=txt(body.id||body.draft?.id,2000);
 let draft;
 if(action==='generate')return {ok:true,generation:await generateMarketing(ctx,{profile,settings:state.settings,type:txt(body.type,30),statePath:path})};
 const mutate=async fn=>{const r=await ctx.store.update(path,fn);state=r.next||r.current;};
 if(action==='settings') {
  manager();const s=body.settings||{};const budget=Number(s.budget||0);if(!Number.isFinite(budget)||budget<0||budget>100000)fail(ctx,'invalid_budget',400,'الميزانية من صفر إلى 100000 ريال');
  await mutate(()=>({settings:{budget,area:txt(s.area,80),audience:txt(s.audience,80)},updatedAt:now}));
 }
 if(action==='save') {
  let clean;try{clean=makeDraft(body.draft);}catch(e){fail(ctx,'invalid_draft',400,e.message);}
  if(!profile.name||!profile.link)fail(ctx,'identity_required',400,'أكمل اسم المكتب ورابطه أولًا');
  const draftId=id||crypto.randomUUID();
  await mutate(current=>{
   const drafts=current.drafts||[];const previous=drafts.find(x=>x.id===draftId);
   if(id&&!previous)fail(ctx,'not_found',404,'المسودة غير موجودة');
   if(previous&&!actor.isManager&&previous.createdBy!==actor.uid)fail(ctx,'forbidden',403,'تعديل المسودة لمنشئها أو مدير المكتب');
   if(previous&&Number(body.draft.version)!==previous.version)fail(ctx,'version_conflict',409,'المسودة تغيرت؛ أعد فتحها قبل الحفظ');
   if(!previous&&drafts.length>=40)fail(ctx,'draft_limit',400,'وصلت إلى 40 مسودة؛ احذف مسودة قديمة');
   draft={...clean,id:draftId,officeId:ctx.officeId,version:(previous?.version||0)+1,status:'draft',approvedBy:'',approvedAt:'',profile:snapshot,identityKey,createdBy:previous?.createdBy||actor.uid,createdAt:previous?.createdAt||now,updatedAt:now};
   return {drafts:[draft,...drafts.filter(x=>x.id!==draftId)],audit:[...(current.audit||[]),{action:'saved',actorUid:actor.uid,draftId,version:draft.version,at:now}].slice(-100),updatedAt:now};
  });
 }
 if(action==='approve'||action==='delete') {
  if(action==='approve')manager();
  await mutate(current=>{
   const previous=(current.drafts||[]).find(x=>x.id===id);if(!previous)fail(ctx,'not_found',404,'المسودة غير موجودة');
   if(!actor.isManager&&previous.createdBy!==actor.uid)fail(ctx,'forbidden',403,'هذا الإجراء لمنشئ المسودة أو مدير المكتب');
   if(action==='approve'&&!Number.isInteger(body.version))fail(ctx,'version_required',400,'حدد إصدار المسودة التي راجعتها قبل الاعتماد');
   if(action==='approve'&&Number(body.version)!==previous.version)fail(ctx,'version_conflict',409,'المسودة تغيرت؛ أعد فتحها قبل الاعتماد');
   if(action==='approve'&&(body.identityKey!==identityKey||previous.identityKey!==identityKey))fail(ctx,'identity_changed',409,'هوية المكتب تغيرت؛ راجع التصميم واحفظه قبل الاعتماد');
   draft={...previous,profile:snapshot,identityKey,status:'approved',approvedBy:actor.uid,approvedAt:now};
   return {drafts:action==='delete'?current.drafts.filter(x=>x.id!==id):current.drafts.map(x=>x.id===id?draft:x),audit:[...(current.audit||[]),{action:action==='approve'?'approved':'deleted',actorUid:actor.uid,draftId:id,version:previous.version,at:now}].slice(-100),updatedAt:now};
  });
 }
 if(action==='ignore')await mutate(current=>({ignored:[...new Set([...(current.ignored||[]),txt(body.campaignId,30)])].slice(-20)}));
 if(action==='search'||action==='recheck') {
  if(!ctx.env.BRAVE_SEARCH_API_KEY)return {ok:true,search:{status:'requires_configuration',message:'يتطلب ربط خدمة البحث',results:[]}};
  if(Number(state.lastSearchAt)>ctx.now().getTime()-60000)fail(ctx,'search_rate_limit',429,'يمكن تحديث البحث مرة في الدقيقة');
  let query=`${profile.city} ${state.settings.area||''} دليل مكاتب عقارية إعلان خدمات عقارية`;
  if(action==='recheck') {const opportunity=(state.opportunities||[]).find(x=>x.id===id);if(!opportunity)fail(ctx,'not_found',404,'الفرصة غير موجودة');query=opportunity.url;}
  await mutate(current=>{if(Number(current.lastSearchAt)>ctx.now().getTime()-60000)fail(ctx,'search_rate_limit',429,'يمكن تحديث البحث مرة في الدقيقة');return {lastSearchAt:ctx.now().getTime()};});
  const search=await searchMarketing(ctx,query);
  if(action==='recheck') {
   const found=search.results.some(x=>x.url===id);await mutate(current=>({opportunities:(current.opportunities||[]).map(x=>x.id===id?{...x,checkedAt:now,verification:found?'indexed':'not_found_in_search'}:x)}));
  }else await mutate(current=>({opportunities:[...search.results.map(x=>({...x,favourite:(current.opportunities||[]).some(p=>p.id===x.id&&p.favourite)})),...(current.opportunities||[]).filter(p=>p.favourite&&!search.results.some(x=>x.id===p.id))].slice(0,40)}));
 }
 if(action==='favourite')await mutate(current=>{if(!(current.opportunities||[]).some(x=>x.id===body.id))fail(ctx,'not_found',404,'الفرصة غير موجودة');return {opportunities:current.opportunities.map(x=>x.id===body.id?{...x,favourite:body.favourite===true}:x)};});
 const effectiveDrafts=(state.drafts||[]).map(d=>d.status==='approved'&&d.identityKey!==identityKey?{...d,status:'draft',approvedBy:'',approvedAt:''}:d);
 return {ok:true,draft,profile,audit:state.audit||[],drafts:effectiveDrafts,settings:state.settings,campaigns:marketingCampaigns(profile,state.settings).filter(x=>!(state.ignored||[]).includes(x.id)),weeklyPlan:weeklyMarketingPlan(profile,state.settings,ctx.now()),opportunities:state.opportunities||[],search:{status:ctx.env.BRAVE_SEARCH_API_KEY?'configured':'requires_configuration',message:ctx.env.BRAVE_SEARCH_API_KEY?'البحث متاح عند الطلب':'يتطلب ربط خدمة البحث'},report:{drafts:(state.drafts||[]).length,approved:effectiveDrafts.filter(x=>x.status==='approved').length,visits:null,conversions:null,message:'زيارات المكتب ومصادرها وتحويلات الحملات غير متاحة حتى ربط خدمة قياس؛ تجهيز الإعلان واعتماده لا يعني نشره'},generationMode:'office_rules',canManage:actor.isManager};
}
