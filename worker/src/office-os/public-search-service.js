/** Guest search: explicit publication, private contact capture, central deterministic ranking. */
import { analyzeOfficeText } from './smart-fill-service.js';
import { kindOf, lifecycleOf, priceOf, validateRecordInput, recordFields } from '../../../public/os/domain/records-domain.js';
import { normalizeArabicText, opportunityToMatchInput, scoreMatch } from '../matching-engine.js';
import { validityState, STATE } from '../../../public/os/domain/validity-domain.js';
import { consumePublicRateLimit, publicRateLimitKey } from '../public-rate-limit.js';
import { ORCHESTRATOR_EVENT, ORCHESTRATOR_OWNER } from '../central-orchestrator-domain.js';
import { buildOrchestratorEventId, dispatchOrchestratorEvent } from '../central-orchestrator-service.js';
import { recordImages, keyBelongsTo } from '../../../public/os/domain/record-media-domain.js';
import { botOutboundConfig, notifyOffice, sendToChat } from './bot-notify.js';

const clean = (v,n=100) => String(v ?? '').trim().slice(0,n);
const eq = (a,b) => normalizeArabicText(a) === normalizeArabicText(b);
function officeIdOf(ctx,value){ const id=clean(value,80); if(id && !/^[a-zA-Z0-9_-]+$/.test(id)) throw ctx.deps.appError('office_invalid',400,'رابط المكتب غير صالح');return id; }
function rate(ctx,ip,action){if(!consumePublicRateLimit(publicRateLimitKey({route:`public-search-${action}`,ip,officeId:''}),{limit:30,windowMs:60000}).ok) throw ctx.deps.appError('rate_limited',429,'محاولات كثيرة، حاول بعد قليل');}
async function publicOffice(ctx,id){const o=await ctx.store.get(['publicOffices',id]);if(!o||o.active===false)throw ctx.deps.appError('office_not_found',404,'رابط المكتب غير متاح');return {...o,id};}
export async function analyzeGuestSearch(ctx,{officeId='',text='',ip=''}){
 rate(ctx,ip,'analyze');const id=officeIdOf(ctx,officeId);if(id)await publicOffice(ctx,id);
 return analyzeOfficeText(ctx,{officeId:id||'public-platform',text,multi:false,ip});
}
function point(v){const lat=Number(v?.lat ?? v?.latitude),lng=Number(v?.lng ?? v?.longitude);return v && Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{lat,lng}:null;}
function distance(a,b){const r=x=>x*Math.PI/180;const dlat=r(b.lat-a.lat),dlng=r(b.lng-a.lng);const x=Math.sin(dlat/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dlng/2)**2;return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));}
const live=(r,now)=>r.publicSearchVisible===true && kindOf(r)==='OFFER' && lifecycleOf(r)==='ACTIVE' && [STATE.ACTIVE,STATE.LEGACY].includes(validityState(r,now)) && Number(priceOf(r))>0;

export async function guestSearch(ctx,{input={},ip=''}){
 rate(ctx,ip,'submit');
 const officeId=officeIdOf(ctx,input.officeId),scope=clean(input.scope)|| (officeId?'office':'all');
 if(!['office','all'].includes(scope)||scope==='office'&&!officeId)throw ctx.deps.appError('scope_invalid',400,'حدد نطاق البحث');
 const home=officeId?await publicOffice(ctx,officeId):null;
 if(input.consentProcessing!==true||input.consentContact!==true)throw ctx.deps.appError('consent_required',400,'الموافقة على معالجة الطلب والتواصل مطلوبة');
 const channel=clean(input.channel);if(!['whatsapp','telegram'].includes(channel))throw ctx.deps.appError('channel_invalid',400,'اختر واتساب أو تيليجرام');
 const requestKey=clean(input.requestKey,100);if(!/^[a-zA-Z0-9_-]{12,100}$/.test(requestKey))throw ctx.deps.appError('request_key_required',400,'أعد فتح البحث وحاول مجددًا');
 const criteria=input.criteria&&typeof input.criteria==='object'?input.criteria:{};
 const check=validateRecordInput({...criteria,kind:'REQUEST',contactName:clean(input.name,80),contactPhone:input.phone},{requireName:true});
 if(!check.ok)throw ctx.deps.appError('request_invalid',400,Object.values(check.errors)[0]);
 const source=recordFields(check.value,{officeId:officeId||'platform',brokerId:'',now:ctx.now()});
 const offices=scope==='office'?[home]:(await ctx.store.list(['publicOffices'],50)).filter(o=>o.active!==false&&(!o.city||eq(o.city,source.city)));
 const rows=[];let inventoryLimited=false;
 for(const office of offices){
  const offers=await ctx.store.list(['offices',office.id,'opportunities'],300);if(offers.length>=300)inventoryLimited=true;
  for(const row of offers){
   if(row.officeId&&row.officeId!==office.id||!live(row,ctx.now())||!eq(row.city,source.city)||!eq(row.propertyType,source.propertyType))continue;
   const same=eq(row.district,source.district);let km=null;
   if(!same){const from=point(office.districtCenters?.[source.district]),to=point(row.coordinates);if(!from||!to)continue;km=distance(from,to);if(km>5)continue;}
   const scored=scoreMatch(opportunityToMatchInput(source),opportunityToMatchInput(row,{id:row.id}));if(!scored.eligible)continue;
   rows.push({row,office,scored,same,km});
  }
 }
 let results=[];
 const orchestration=await dispatchOrchestratorEvent({event:ORCHESTRATOR_EVENT.SEARCH_REQUESTED,eventId:buildOrchestratorEventId({event:ORCHESTRATOR_EVENT.SEARCH_REQUESTED,officeId:officeId||'platform',entityId:requestKey}),context:{officeId:officeId||'platform',entityId:requestKey},adapters:{[ORCHESTRATOR_OWNER.MATCHING]:async()=>{
  rows.sort((a,b)=>Number(b.same)-Number(a.same)||b.scored.score-a.scored.score||(a.km??0)-(b.km??0));
  const seen=new Map();for(const x of rows){
   const ref=`${x.office.id}:${x.row.id}`,key=x.row.canonicalPropertyId||`${x.office.id}:${x.row.propertyId||x.row.id}`;
   if(seen.has(key)){seen.get(key).sources.push({officeId:x.office.id,officeName:clean(x.office.officeName),reference:ref});continue;}
   const photo=recordImages(x.row).find(image=>keyBelongsTo(image.path,x.office.id,x.row.id));
   const item={imagePath:photo?'/media/public/'+photo.path.split('/').map(encodeURIComponent).join('/'):'',reference:ref,officeId:x.office.id,officeName:clean(x.office.officeName)||'مكتب عقاري',propertyType:clean(x.row.propertyType,40),purpose:clean(x.row.purpose),city:clean(x.row.city),district:clean(x.row.district),price:priceOf(x.row),rooms:Number(x.row.rooms)||null,area:Number(x.row.area)||null,score:x.scored.score,reasons:x.scored.reasons||[],nearby:!x.same,distanceKm:x.km===null?null:Math.round(x.km*10)/10,distanceType:x.km===null?null:'straight_line',sources:[{officeId:x.office.id,officeName:clean(x.office.officeName),reference:ref}]};
   seen.set(key,item);
  }results=[...seen.values()].slice(0,10);return {ok:true};
 }}});
 if(!orchestration.ok)throw ctx.deps.appError('search_failed',503,'تعذر البحث الآن');
 // All contact information lives in a Worker-only collection, never in publicOffices/results.
 const signingKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(ctx.env.FIREBASE_PRIVATE_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('HMAC',signingKey,new TextEncoder().encode(JSON.stringify([officeId,scope,check.value.contactPhone,requestKey,check.value])));
 const token=Array.from(new Uint8Array(signature),b=>b.toString(16).padStart(2,'0')).join('').slice(0,48);
 const sessionId=await ctx.deps.sha256Hex(token);
 const session={officeId,scope,name:check.value.contactName,phone:check.value.contactPhone,channel,consentProcessing:true,consentContact:true,consentAt:ctx.now(),criteriaJson:JSON.stringify(check.value),resultsJson:JSON.stringify(results),status:'AWAITING_CHANNEL',createdAt:ctx.now(),expiresAt:new Date(ctx.now().getTime()+86400000).toISOString()};
 const created=await ctx.store.create(['publicSearchSessions',sessionId],session);
 if(home && created){
  // Keep the lead in the office's existing inbox; it is not a confirmed negotiation or a broker-approved record.
  await ctx.store.create(['offices',officeId,'inbox',`ps_${sessionId.slice(0,32)}`],{officeId,source:'public_search',channel,direction:'inbound',senderName:session.name,senderPhone:session.phone,messageText:JSON.stringify(check.value),status:'new',processingState:'kept',isProcessed:false,consentContact:true,consentAt:ctx.now(),publicSearchSessionId:sessionId,createdAt:ctx.now()});
  await notifyOffice(ctx.store,ctx.deps,{officeId,key:`public-search:${sessionId}`,title:'طلب جديد من بحث العملاء',body:`${session.name} — ${check.value.propertyType} في ${check.value.district}`,route:'inbox',now:ctx.now()});
 }
 const config=botOutboundConfig(ctx.env),telegramLink=channel==='telegram'&&config.available?`https://t.me/${config.botUsername}?start=ps_${token}`:'';
 return {ok:true,results,orchestration,coverageLimited:inventoryLimited||(scope==='all'&&offices.length>=50),contact:{channel,sent:false,state:telegramLink?'START_REQUIRED':'PENDING_ACTIVATION',telegramLink,message:telegramLink?'اضغط بدء المحادثة في تيليجرام لاستلام النتائج من النظام.':'تم حفظ طلبك. الإرسال الآلي لهذه القناة غير مفعّل حاليًا، ولم تُرسل رسالة.'}};
}

/** Triggered only by Telegram's authenticated webhook and an unguessable, expiring guest link. */
export async function deliverGuestSearchTelegram(ctx,{token,chat}){
 if(chat?.type!=='private'||!/^\d{1,20}$/.test(String(chat.id))||!/^[a-f0-9]{48}$/.test(token))return {ok:true,status:200,ignored:true};
 const id=await ctx.deps.sha256Hex(token),path=['publicSearchSessions',id],session=await ctx.store.get(path);
 if(!session||session.channel!=='telegram'||!session.consentContact||new Date(session.expiresAt)<=ctx.now())return {ok:true,status:200,ignored:true};
 let claimed=false;
 await ctx.store.update(path,current=>{claimed=false;if(current.telegramChatId&&String(current.telegramChatId)!==String(chat.id)||['SENDING','SENT','UNKNOWN'].includes(current.deliveryState))return null;claimed=true;return {telegramChatId:String(chat.id),deliveryState:'SENDING',startedAt:ctx.now()};});
 if(!claimed)return {ok:true,status:200,duplicate:true};
 // Recheck publication and availability: a revoked/sold offer must not be delivered from an old snapshot.
 const snapshots=JSON.parse(session.resultsJson||'[]'),available=[];
 for(const x of snapshots){const parts=String(x.reference).split(':');const row=await ctx.store.get(['offices',parts[0],'opportunities',parts[1]]);if(row&&live(row,ctx.now())&&await ctx.store.get(['publicOffices',parts[0]]))available.push({...x,price:priceOf(row),propertyType:clean(row.propertyType,40),district:clean(row.district)});}
 const body=[`مرحبًا ${session.name}، هذه نتائج طلبك العقاري:`,...available.map((x,i)=>`${i+1}. ${x.propertyType} — ${x.district} — ${x.price.toLocaleString('ar-SA')} ريال\n${x.officeName}\nالمرجع: ${x.reference}`),available.length?'':'لا توجد عروض منشورة مناسبة متاحة حاليًا.'].filter(Boolean).join('\n\n');
 const sent=await sendToChat(ctx.deps,chat.id,body,{now:ctx.now()});
 await ctx.store.set(path,{deliveryState:sent.ok?'SENT':sent.unreachable?'UNKNOWN':'FAILED',status:sent.ok?'CONTACTED':'AWAITING_CHANNEL',messageId:sent.messageId||null,deliveryAt:ctx.now()});
 return {ok:true,status:200,delivered:sent.ok===true};
}
