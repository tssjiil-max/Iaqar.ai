/**
 * Guest search: explicit publication, central deterministic ranking, contact only after a choice.
 *
 * Journey: write the request → see up to 10 real matches → choose one → give name/phone/consent →
 * continue on WhatsApp (the client's own app, to the office's number) or Telegram (the platform bot).
 * The AI runs the journey; a person approves commitments. Nothing here reserves, accepts a price,
 * confirms a viewing or closes a deal, and nothing claims a message was sent when it was not.
 */
import { normalizeInventoryDistrict } from '../../../public/os/domain/inventory-query-domain.js';
import { analyzeOfficeText } from './smart-fill-service.js';
import { kindOf, lifecycleOf, priceOf, validateRecordInput, recordFields } from '../../../public/os/domain/records-domain.js';
import { normalizeArabicText, opportunityToMatchInput, scoreMatch } from '../matching-engine.js';
import { validityState, STATE } from '../../../public/os/domain/validity-domain.js';
import { consumePublicRateLimit, publicRateLimitKey } from '../public-rate-limit.js';
import { ORCHESTRATOR_EVENT, ORCHESTRATOR_OWNER } from '../central-orchestrator-domain.js';
import { buildOrchestratorEventId, dispatchOrchestratorEvent } from '../central-orchestrator-service.js';
import { recordImages, keyBelongsTo } from '../../../public/os/domain/record-media-domain.js';
import { botOutboundConfig, notifyOffice, sendToChat } from './bot-notify.js';
import { buildWhatsAppUrl, whatsappDigits } from '../../../public/os/domain/format-domain.js';
import {
  LISTING_STATUS, LISTING_STATUS_LABEL, listingStatus, isMatchable, othersInterested, interestRecord,
  INTEREST_NOTICE, resolveListingReference, readiness, READINESS_EVENT
} from '../../../public/os/domain/direct-match-domain.js';

const clean = (v,n=100) => String(v ?? '').trim().slice(0,n);
const eq = (a,b) => normalizeArabicText(a) === normalizeArabicText(b);
const SESSION_TTL_MS = 86400000;
function officeIdOf(ctx,value){ const id=clean(value,80); if(id && !/^[a-zA-Z0-9_-]+$/.test(id)) throw ctx.deps.appError('office_invalid',400,'رابط المكتب غير صالح');return id; }
function rate(ctx,ip,action,limit=30){if(!consumePublicRateLimit(publicRateLimitKey({route:`public-search-${action}`,ip,officeId:''}),{limit,windowMs:60000}).ok) throw ctx.deps.appError('rate_limited',429,'محاولات كثيرة، حاول بعد قليل');}
async function publicOffice(ctx,id){const o=await ctx.store.get(['publicOffices',id]);if(!o||o.active===false)throw ctx.deps.appError('office_not_found',404,'رابط المكتب غير متاح');return {...o,id};}
export async function analyzeGuestSearch(ctx,{officeId='',text='',ip=''}){
 rate(ctx,ip,'analyze');const id=officeIdOf(ctx,officeId);if(id)await publicOffice(ctx,id);
 return analyzeOfficeText(ctx,{officeId:id||'public-platform',text,multi:false,ip});
}
function point(v){const lat=Number(v?.lat ?? v?.latitude),lng=Number(v?.lng ?? v?.longitude);return v && Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{lat,lng}:null;}
function distance(a,b){const r=x=>x*Math.PI/180;const dlat=r(b.lat-a.lat),dlng=r(b.lng-a.lng);const x=Math.sin(dlat/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dlng/2)**2;return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));}
export function publicInventoryExclusion(row, officeId, now = new Date()) {
 if (row.officeId && row.officeId !== officeId) return 'office_mismatch';
 if (row.publicSearchVisible !== true) return 'not_published';
 if (kindOf(row) !== 'OFFER') return 'not_offer';
 if (lifecycleOf(row) !== 'ACTIVE') return 'inactive';
 if (![STATE.ACTIVE, STATE.LEGACY].includes(validityState(row, now))) return 'expired_or_unavailable';
 if (!(Number(priceOf(row)) > 0)) return 'price_missing';
 return '';
}
const live=(row,now)=>!publicInventoryExclusion(row,row.officeId,now);
const interestPath=(officeId,recordId)=>['offices',officeId,'opportunities',recordId,'interests'];
const splitRef=(reference)=>{const [officeId,recordId]=String(reference||'').split(':');return /^[a-zA-Z0-9_-]{1,80}$/.test(officeId||'')&&/^[a-zA-Z0-9_-]{1,160}$/.test(recordId||'')?{officeId,recordId}:null;};

async function hmacHex(ctx,payload){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(ctx.env.FIREBASE_PRIVATE_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify(payload)));
 return Array.from(new Uint8Array(sig),b=>b.toString(16).padStart(2,'0')).join('');
}
/** A client's interest key: keyed hash of the phone, so offices never see other offices' clients and nothing is reversible. */
async function viewerKeyFor(ctx,phoneDigits){return (await hmacHex(ctx,['interest',phoneDigits])).slice(0,32);}
/** Office open deals, read once per office and only when that office has a candidate. */
async function openJourneysOf(ctx,officeId,cache){
 if(!cache.has(officeId))cache.set(officeId,ctx.store.list(['offices',officeId,'journeys'],300).catch(()=>[]));
 return cache.get(officeId);
}
async function statusOf(ctx,row,officeId,cache){return listingStatus(row,{recordId:row.id,openJourneys:await openJourneysOf(ctx,officeId,cache)});}
async function interestNoticeFor(ctx,ref,viewerKey){
 const parts=splitRef(ref);if(!parts)return false;
 const rows=await ctx.store.list(interestPath(parts.officeId,parts.recordId),50).catch(()=>[]);
 return othersInterested(rows,{viewerKey,now:ctx.now()});
}

/** Step 1 — search. No account, no name, no phone. */
export async function guestSearch(ctx,{input={},ip=''}){
 rate(ctx,ip,'submit');
 const officeId=officeIdOf(ctx,input.officeId),scope=clean(input.scope)|| (officeId?'office':'all');
 if(!['office','all'].includes(scope)||scope==='office'&&!officeId)throw ctx.deps.appError('scope_invalid',400,'حدد نطاق البحث');
 const home=officeId?await publicOffice(ctx,officeId):null;
 const requestKey=clean(input.requestKey,100);if(!/^[a-zA-Z0-9_-]{12,100}$/.test(requestKey))throw ctx.deps.appError('request_key_required',400,'أعد فتح البحث وحاول مجددًا');
 const criteria=input.criteria&&typeof input.criteria==='object'?input.criteria:{};
 // Criteria only: contact details are asked for after the client chooses a property.
 const check=validateRecordInput({...criteria,kind:'REQUEST',contactName:'',contactPhone:''});
 const browse = input.mode === 'inventory';
 const criteriaErrors=Object.entries(check.errors).filter(([k])=>!['contactPhone','contactName'].includes(k) && (!browse || Boolean(criteria[k])));
 if (browse && !['propertyType','district','city','price','purpose'].some(k => Boolean(criteria[k]))) throw ctx.deps.appError('request_invalid',400,'حدد حيًا أو نوع عقار أو ميزانية للبحث');
 if(criteriaErrors.length)throw ctx.deps.appError('request_invalid',400,criteriaErrors[0][1]);
 const viewerKey=/^[a-f0-9]{32}$/.test(String(input.viewerKey||''))?String(input.viewerKey):'';
 if (browse && !check.value.city && home?.city) check.value.city = home.city;
 const source=recordFields(check.value,{officeId:officeId||'platform',brokerId:'',now:ctx.now()});
 const offices=scope==='office'?[home]:(await ctx.store.list(['publicOffices'],50)).filter(o=>o.active!==false&&(!source.city||!o.city||eq(o.city,source.city)));
 const rows=[];const exclusions={};const exclude=reason=>{exclusions[reason]=(exclusions[reason]||0)+1;};let inventoryLimited=false;const journeys=new Map();
 for(const office of offices){
  const offers=await ctx.store.list(['offices',office.id,'opportunities'],300);if(offers.length>=300)inventoryLimited=true;
  for(const row of offers){
   const reason=publicInventoryExclusion(row,office.id,ctx.now());
   if(reason){exclude(reason);continue;}
   if((source.city&&!eq(row.city,source.city))||(source.propertyType&&!eq(row.propertyType,source.propertyType))){exclude('criteria_mismatch');continue;}
   if (browse && criteria.purpose && (criteria.purpose === 'PURCHASE' ? !['SALE','PURCHASE'].includes(row.purpose) : !['RENT','LEASE_REQUEST'].includes(row.purpose))) continue;
   if(check.value.price>0 && (criteria.priceExclusive === true ? priceOf(row)>=check.value.price : priceOf(row)>check.value.price))continue;
   const same=!source.district || normalizeInventoryDistrict(row.district)===normalizeInventoryDistrict(source.district);let km=null;
   if(!same){const from=point(office.districtCenters?.[source.district]),to=point(row.coordinates);if(!from||!to)continue;km=distance(from,to);if(km>5)continue;}
   const scored=browse ? {eligible:true,score:0,reasons:[criteria.district?'في الحي المطلوب':'',criteria.propertyType?'نوع العقار المطلوب':'',criteria.price?'ضمن الميزانية المحددة':''].filter(Boolean)} : scoreMatch(opportunityToMatchInput(source),opportunityToMatchInput(row,{id:row.id}));if(!scored.eligible)continue;
   const status=await statusOf(ctx,row,office.id,journeys);
   if(!isMatchable(status,{showNegotiating:office.publicSearchShowNegotiating!==false}))continue;
   rows.push({row,office,scored,same,km,status});
  }
 }
 ctx.onInventoryDiagnostic?.({exclusions,inventoryLimited});
 let results=[];
 const orchestration=await dispatchOrchestratorEvent({event:ORCHESTRATOR_EVENT.SEARCH_REQUESTED,eventId:buildOrchestratorEventId({event:ORCHESTRATOR_EVENT.SEARCH_REQUESTED,officeId:officeId||'platform',entityId:requestKey}),context:{officeId:officeId||'platform',entityId:requestKey},adapters:{[ORCHESTRATOR_OWNER.MATCHING]:async()=>{
  // District first, then match strength (type/purpose/budget/specs), then distance, then the freshest confirmation.
  const fresh=x=>Date.parse(x.row.availabilityConfirmedAt||x.row.validityConfirmedAt||x.row.updatedAt||x.row.createdAt||0)||0;
  rows.sort((a,b)=>Number(b.same)-Number(a.same)||b.scored.score-a.scored.score||(a.km??0)-(b.km??0)||fresh(b)-fresh(a));
  const seen=new Map();for(const x of rows){
   const ref=`${x.office.id}:${x.row.id}`,key=x.row.canonicalPropertyId||`${x.office.id}:${x.row.propertyId||x.row.id}`;
   if(seen.has(key)){seen.get(key).sources.push({officeId:x.office.id,officeName:clean(x.office.officeName),reference:ref});continue;}
   const photo=recordImages(x.row).find(image=>keyBelongsTo(image.path,x.office.id,x.row.id));
   const item={imagePath:photo?'/media/public/'+photo.path.split('/').map(encodeURIComponent).join('/'):'',reference:ref,officeId:x.office.id,officeName:clean(x.office.officeName)||'مكتب عقاري',propertyType:clean(x.row.propertyType,40),purpose:clean(x.row.purpose),priceStatus:['FIXED','NEGOTIABLE'].includes(x.row.priceStatus)?x.row.priceStatus:'',city:clean(x.row.city),district:clean(x.row.district),price:priceOf(x.row),rooms:Number(x.row.rooms)||null,area:Number(x.row.area)||null,score:x.scored.score,reasons:(x.scored.reasons||[]).map(reason=>String(reason).replace(/ وقابل للتفاوض/g,'')),nearby:!x.same,distanceKm:x.km===null?null:Math.round(x.km*10)/10,distanceType:x.km===null?null:'straight_line',status:x.status,statusLabel:LISTING_STATUS_LABEL[x.status],sources:[{officeId:x.office.id,officeName:clean(x.office.officeName),reference:ref}]};
   seen.set(key,item);
  }results=[...seen.values()].slice(0,10);return {ok:true};
 }}});
 if(!orchestration.ok)throw ctx.deps.appError('search_failed',503,'تعذر البحث الآن');
 // Real recorded interest from OTHER clients only; the notice carries no names, numbers or counts.
 for(const item of results){item.othersInterested=await interestNoticeFor(ctx,item.reference,viewerKey);if(item.othersInterested)item.interestNotice=INTEREST_NOTICE;}
 const token=(await hmacHex(ctx,['search',officeId,scope,requestKey,input.mode||'match',check.value,criteria.priceExclusive===true])).slice(0,48);
 const sessionId=await ctx.deps.sha256Hex(token);
 const session={officeId,scope,criteriaJson:JSON.stringify({...check.value,contactName:'',contactPhone:''}),resultsJson:JSON.stringify(results),status:'RESULTS_SHOWN',consentProcessing:false,consentContact:false,createdAt:ctx.now(),expiresAt:new Date(ctx.now().getTime()+SESSION_TTL_MS).toISOString()};
 const created=await ctx.store.create(['publicSearchSessions',sessionId],session);
 // A retry of the same request keeps the first session (and any choice already made in it).
 const stored=created?session:await ctx.store.get(['publicSearchSessions',sessionId]);
 return {ok:true,results:created?results:JSON.parse(stored?.resultsJson||'[]').map((x,i)=>({...x,othersInterested:results[i]?.othersInterested||false,interestNotice:results[i]?.interestNotice})),searchToken:token,orchestration,coverageLimited:inventoryLimited||(scope==='all'&&offices.length>=50)};
}

async function loadSession(ctx,token){
 if(!/^[a-f0-9]{48}$/.test(String(token||'')))throw ctx.deps.appError('search_expired',400,'انتهت جلسة البحث، ابحث مجددًا');
 const id=await ctx.deps.sha256Hex(token),session=await ctx.store.get(['publicSearchSessions',id]);
 if(!session||new Date(session.expiresAt)<=ctx.now())throw ctx.deps.appError('search_expired',400,'انتهت جلسة البحث، ابحث مجددًا');
 return {id,session,results:JSON.parse(session.resultsJson||'[]')};
}

/** Re-read a chosen listing now: it must still be published, live and not reserved/sold. */
export async function currentListing(ctx,reference){
 const parts=splitRef(reference);if(!parts)return null;
 const [row,office]=await Promise.all([ctx.store.get(['offices',parts.officeId,'opportunities',parts.recordId]),ctx.store.get(['publicOffices',parts.officeId])]);
 if(!row||!office||office.active===false||publicInventoryExclusion(row,parts.officeId,ctx.now()))return null;
 const status=listingStatus(row,{recordId:parts.recordId,openJourneys:await ctx.store.list(['offices',parts.officeId,'journeys'],300).catch(()=>[])});
 if(!isMatchable(status,{showNegotiating:office.publicSearchShowNegotiating!==false}))return null;
 return {...parts,row,office,status};
}

/**
 * Record one real interest (a choice + consent) and hand the lead to the listing's office.
 * Interest never reserves and never gives priority; it only lets the office follow up.
 */
async function recordChoice(ctx,{sessionId,session,item,listing,name,phoneDigits,channel,via}){
 const key=await viewerKeyFor(ctx,phoneDigits);
 const path=[...interestPath(listing.officeId,listing.recordId),key];
 const previous=await ctx.store.get(path);
 await ctx.store.set(path,interestRecord({key,reference:item.reference,now:ctx.now(),previous}));
 const criteria=JSON.parse(session.criteriaJson||'{}');
 const events=[READINESS_EVENT.SELECTED,READINESS_EVENT.CONTACT_CONSENT];
 if(Number(criteria.price)>0&&priceOf(listing.row)<=Number(criteria.price))events.push(READINESS_EVENT.BUDGET_FIT);
 const ready=readiness([...(session.readinessEvents||[]),...events]);
 const phone=`0${phoneDigits.slice(3)}`;
 const leadId=`ps_${sessionId.slice(0,24)}_${listing.recordId}`.slice(0,120);
 const lead={officeId:listing.officeId,source:'public_search',channel,direction:'inbound',senderName:name,senderPhone:phone,
  messageText:`اختار العقار ${item.propertyType} في ${item.district} — المرجع ${item.reference}`,selectedReference:item.reference,selectedRecordId:listing.recordId,
  criteriaJson:session.criteriaJson||'{}',readinessScore:ready.score,readinessEvents:ready.events,readinessIsApproval:false,
  status:'new',processingState:'kept',isProcessed:false,consentProcessing:true,consentContact:true,consentAt:ctx.now(),publicSearchSessionId:sessionId,via,createdAt:ctx.now()};
 const createdLead=await ctx.store.create(['offices',listing.officeId,'inbox',leadId],lead);
 // The lead is saved above; telling the office's devices must never hold up the client's screen.
 if(createdLead){const job=notifyOffice(ctx.store,ctx.deps,{officeId:listing.officeId,key:`public-search:${leadId}`,title:'عميل اختار عقارًا من بحث العملاء',body:`${name} — ${item.propertyType} في ${item.district} (المرجع ${item.reference})`,route:'inbox',now:ctx.now()}).catch(error=>console.warn('[public-search] office notify failed',error?.message));if(ctx.waitUntil)ctx.waitUntil(job);else await job;}
 await ctx.store.update(['publicSearchSessions',sessionId],()=>({name,phone,channel,consentProcessing:true,consentContact:true,consentAt:ctx.now(),selectedReference:item.reference,readinessEvents:ready.events,readinessScore:ready.score,status:'SELECTED'}));
 return {key,ready,leadCreated:Boolean(createdLead)};
}

/** Office number for the client's own WhatsApp: the linked business number first, then the office profile. */
async function officeWhatsApp(ctx,officeId){
 const integration=await ctx.store.get(['offices',officeId,'integrations','whatsapp']).catch(()=>null);
 const office=await ctx.store.get(['offices',officeId]).catch(()=>null);
 return [integration?.displayPhoneNumber,office?.whatsapp,office?.phone].map(whatsappDigits).find(Boolean)||'';
}

/** Step 2 — the client chose one result and agreed to be contacted about it. */
export async function selectGuestResult(ctx,{input={},ip=''}){
 rate(ctx,ip,'select',20);
 const {id,session,results}=await loadSession(ctx,clean(input.searchToken,60));
 const item=results.find(x=>x.reference===clean(input.reference,260));
 if(!item)throw ctx.deps.appError('result_unknown',400,'اختر عقارًا من نتائج بحثك');
 if(input.consentProcessing!==true||input.consentContact!==true)throw ctx.deps.appError('consent_required',400,'الموافقة على معالجة الطلب والتواصل مطلوبة');
 const channel=clean(input.channel);if(!['whatsapp','telegram'].includes(channel))throw ctx.deps.appError('channel_invalid',400,'اختر واتساب أو تيليجرام');
 const name=clean(input.name,80);if(name.length<2)throw ctx.deps.appError('name_required',400,'اكتب اسمك');
 const phoneDigits=whatsappDigits(input.phone);if(!phoneDigits)throw ctx.deps.appError('phone_invalid',400,'اكتب رقم جوال سعودي يبدأ بـ 05');
 const listing=await currentListing(ctx,item.reference);
 if(!listing)throw ctx.deps.appError('listing_unavailable',409,'هذا العقار لم يعد متاحًا. اختر عقارًا آخر من النتائج.');
 const {key,ready}=await recordChoice(ctx,{sessionId:id,session,item,listing,name,phoneDigits,channel,via:'web'});
 const others=await interestNoticeFor(ctx,item.reference,key);
 const base={ok:true,reference:item.reference,status:listing.status,statusLabel:LISTING_STATUS_LABEL[listing.status],viewerKey:key,othersInterested:others,interestNotice:others?INTEREST_NOTICE:'',readinessRecorded:ready.score>0};
 if(channel==='whatsapp'){
  const digits=await officeWhatsApp(ctx,listing.officeId);
  const message=[`السلام عليكم، أنا ${name}.`,`مهتم بالعقار: ${item.propertyType} في ${item.district} — ${Number(item.price).toLocaleString('en-US')} ريال.`,`المرجع: ${item.reference}`,`(من بحث iAqar)`].join('\n');
  const url=digits?buildWhatsAppUrl(digits,message):'';
  return {...base,contact:{channel,sent:false,state:url?'OPEN_WHATSAPP':'OFFICE_WILL_CONTACT',whatsappUrl:url,
   message:url?'افتح واتساب وأرسل الرسالة الجاهزة للمكتب — لم نرسل شيئًا نيابة عنك.':'وصل اختيارك للمكتب وسيتواصل معك. رقم واتساب المكتب غير متاح حاليًا.'}};
 }
 const config=botOutboundConfig(ctx.env),telegramLink=config.available?`https://t.me/${config.botUsername}?start=ps_${clean(input.searchToken,60)}`:'';
 return {...base,contact:{channel,sent:false,state:telegramLink?'START_REQUIRED':'PENDING_ACTIVATION',telegramLink,
  message:telegramLink?'اضغط بدء المحادثة في تيليجرام لاستلام تفاصيل العقار من النظام.':'وصل اختيارك للمكتب. الإرسال الآلي لهذه القناة غير مفعّل حاليًا، ولم تُرسل رسالة.'}};
}

/**
 * The same choice as the web page, from an authenticated channel conversation (WhatsApp agent):
 * the snapshot is re-read now, the interest + lead reach the listing's office, nothing is reserved.
 */
export async function selectGuestResultForChannel(ctx,{searchToken,reference,name,phone,channel='whatsapp',via='whatsapp_agent'}){
 const {id,session,results}=await loadSession(ctx,clean(searchToken,60));
 const item=results.find(x=>x.reference===clean(reference,260));
 if(!item)throw ctx.deps.appError('result_unknown',400,'اختر عقارًا من نتائج بحثك');
 const phoneDigits=whatsappDigits(phone);if(!phoneDigits)throw ctx.deps.appError('phone_invalid',400,'رقم الجوال غير مدعوم');
 const listing=await currentListing(ctx,item.reference);
 if(!listing)throw ctx.deps.appError('listing_unavailable',409,'هذا العقار لم يعد متاحًا.');
 const {key,leadCreated}=await recordChoice(ctx,{sessionId:id,session:{...session,consentProcessing:true,consentContact:true},item,listing,name:clean(name,80)||'عميل واتساب',phoneDigits,channel,via});
 const others=await interestNoticeFor(ctx,item.reference,key);
 return {ok:true,item:{...item,price:priceOf(listing.row),status:listing.status,statusLabel:LISTING_STATUS_LABEL[listing.status]},listing,leadCreated,othersInterested:others,interestNotice:others?INTEREST_NOTICE:''};
}

function resultLine(x,i){return `${i+1}. ${x.propertyType} — ${x.district} — ${Number(x.price).toLocaleString('ar-SA')} ريال\n${x.officeName}${x.status===LISTING_STATUS.NEGOTIATING?' · قيد التفاوض':''}\nالمرجع: ${x.reference}`;}
/** Recheck every snapshot now: a revoked, reserved or sold offer must not be sent from an old list. */
export async function availableNow(ctx,snapshots){const out=[];for(const x of snapshots){const l=await currentListing(ctx,x.reference);if(l)out.push({...x,price:priceOf(l.row),propertyType:clean(l.row.propertyType,40),district:clean(l.row.district),status:l.status});}return out;}

/** Triggered only by Telegram's authenticated webhook and an unguessable, expiring guest link. */
export async function deliverGuestSearchTelegram(ctx,{token,chat}){
 if(chat?.type!=='private'||!/^\d{1,20}$/.test(String(chat.id))||!/^[a-f0-9]{48}$/.test(token))return {ok:true,status:200,ignored:true};
 const id=await ctx.deps.sha256Hex(token),path=['publicSearchSessions',id],session=await ctx.store.get(path);
 if(!session||session.channel!=='telegram'||!session.consentContact||new Date(session.expiresAt)<=ctx.now())return {ok:true,status:200,ignored:true};
 let claimed=false;
 await ctx.store.update(path,current=>{claimed=false;if(current.telegramChatId&&String(current.telegramChatId)!==String(chat.id)||['SENDING','SENT','UNKNOWN'].includes(current.deliveryState))return null;claimed=true;return {telegramChatId:String(chat.id),deliveryState:'SENDING',startedAt:ctx.now()};});
 if(!claimed)return {ok:true,status:200,duplicate:true};
 const available=await availableNow(ctx,JSON.parse(session.resultsJson||'[]'));
 const chosen=available.find(x=>x.reference===session.selectedReference);
 const body=[`مرحبًا ${session.name}، هذه نتائج طلبك العقاري:`,
  chosen?`اخترت:\n${resultLine(chosen,available.indexOf(chosen))}\nوصل اختيارك للمكتب وسيتابع معك.`:(session.selectedReference?'العقار الذي اخترته لم يعد متاحًا.':''),
  ...available.filter(x=>x!==chosen).map(x=>resultLine(x,available.indexOf(x))),
  available.length?'تقدر تكتب «العرض الثاني» أو رقم المرجع لتختار عقارًا آخر.':'لا توجد عروض منشورة مناسبة متاحة حاليًا.'].filter(Boolean).join('\n\n');
 const sent=await sendToChat(ctx.deps,chat.id,body,{now:ctx.now()});
 await ctx.store.set(path,{deliveryState:sent.ok?'SENT':sent.unreachable?'UNKNOWN':'FAILED',status:sent.ok?'CONTACTED':'AWAITING_CHANNEL',messageId:sent.messageId||null,deliveryAt:ctx.now()});
 // Later replies from this private chat («العرض الثاني») are understood against this search only.
 if(sent.ok)await ctx.store.set(['publicSearchChats',String(chat.id)],{sessionId:id,expiresAt:session.expiresAt,updatedAt:ctx.now()});
 return {ok:true,status:200,delivered:sent.ok===true};
}

/**
 * A guest's follow-up in the Telegram chat that received their results. Returns null when the chat
 * is not a guest search, so the normal pipeline continues untouched.
 */
export async function replyGuestSearchTelegram(ctx,{chat,text}){
 if(chat?.type!=='private'||!/^\d{1,20}$/.test(String(chat.id)))return null;
 const link=await ctx.store.get(['publicSearchChats',String(chat.id)]);
 if(!link||new Date(link.expiresAt)<=ctx.now())return null;
 const path=['publicSearchSessions',link.sessionId],session=await ctx.store.get(path);
 if(!session||!session.consentContact||String(session.telegramChatId)!==String(chat.id))return null;
 const results=JSON.parse(session.resultsJson||'[]');
 const pick=resolveListingReference(text,results);
 if(!pick){
  await sendToChat(ctx.deps,chat.id,'ما تأكدت أي عقار تقصد. اكتب رقمه من القائمة (مثل «العرض الثاني») أو رقم المرجع.',{now:ctx.now()});
  return {ok:true,status:200,guestSearch:'unclear'};
 }
 const listing=await currentListing(ctx,pick.item.reference);
 if(!listing){await sendToChat(ctx.deps,chat.id,`العرض رقم ${pick.index+1} لم يعد متاحًا. اختر عقارًا آخر من القائمة.`,{now:ctx.now()});return {ok:true,status:200,guestSearch:'unavailable'};}
 const phoneDigits=whatsappDigits(session.phone);
 if(!phoneDigits)return null;
 const {key}=await recordChoice(ctx,{sessionId:link.sessionId,session,item:pick.item,listing,name:session.name,phoneDigits,channel:'telegram',via:'telegram'});
 const others=await interestNoticeFor(ctx,pick.item.reference,key);
 await sendToChat(ctx.deps,chat.id,[`تم تسجيل اهتمامك بالعرض رقم ${pick.index+1}:`,resultLine({...pick.item,status:listing.status},pick.index),others?INTEREST_NOTICE+'.':'','وصل اختيارك للمكتب وسيتابع معك. أي حجز أو سعر نهائي يعتمده المكتب.'].filter(Boolean).join('\n\n'),{now:ctx.now()});
 return {ok:true,status:200,guestSearch:'selected',reference:pick.item.reference};
}
