/** WhatsApp real-estate agent: durable intake/queue on the existing Firestore store, the office's own CRM,
 * matching and published inventory, and a case record for each property the client acts on.
 *
 *   inbound (Meta webhook) → inbox + durable job → one conversation at a time → deterministic understanding
 *   → real search (published, live, re-verified) → interactive replies → interest / offer / viewing recorded
 *   → office notified → office decisions (owner answer, confirmed viewing, agreement, closing) → client told.
 *
 * Fail-closed gates: Staging only, explicit office allowlist, the office switch, the current number mapping,
 * the recipient allowlist, the 24-hour customer-service window, STOP and human handoff — checked again at the
 * last moment before every send. No paid model is called unless WHATSAPP_AGENT_CLASSIFIER=claude.
 * The agent never accepts a price, never confirms a viewing, never signs, never moves money.
 */
import { classifyWithClaude, economicModeActive, sendWhatsAppMessage, usesPaidClassifier, whatsappAccessToken } from './whatsapp-agent-transport.js';
import { extractFacts, mergeDraft, nextMissing, questionFor, personaFromText, PERSONA, wantsHuman, toRecordInput, summaryLines } from '../../../public/os/domain/visitor-domain.js';
import { LISTING_STATUS_LABEL, mandateDecision, READINESS_EVENT } from '../../../public/os/domain/direct-match-domain.js';
import { recordImages, keyBelongsTo } from '../../../public/os/domain/record-media-domain.js';
import {
  ACTION, CASE_STAGE, OFFICE_ACTION, NO_RESULTS_TEXT, UNAVAILABLE_TEXT, HUMAN_TEXT,
  readInbound, detectAction, parseViewingTime, textMessage, buttonsMessage, imageMessage, actionId,
  resultsMessages, detailsMessages, afterInterestMessages, askOfferMessage, offerRecordedMessages,
  askViewingTimeMessage, viewingRequestedMessages, followUpQuestion, officeActionAllowed, viewingConflict,
  officeUpdateText, reminderText, listMessage
} from '../../../public/os/domain/whatsapp-agent-domain.js';
import { guestSearch, currentListing, selectGuestResultForChannel } from './public-search-service.js';
import { saveRecord, pairRecords } from './records-service.js';
import { notifyOffice } from './bot-notify.js';
import { priceOf } from '../../../public/os/domain/records-domain.js';
import { writeAudit } from './audit-log.js';

const clean=(v,n=120)=>String(v??'').trim().slice(0,n);
const digits=v=>String(v||'').replace(/\D/g,'');
const list=v=>String(v||'').split(',').map(x=>x.trim()).filter(Boolean);
const millis=v=>new Date(v||0).getTime()||0;
const DAY=86400000;
const queueRoot=['serviceQueues','whatsapp'];
const path=(officeId,id)=>['offices',officeId,'inbox',id];
const conversationPath=(officeId,id)=>['offices',officeId,'whatsappConversations',id];
const casePath=(officeId,id)=>['offices',officeId,'whatsappCases',id];
const outboxPath=(officeId,id)=>['offices',officeId,'whatsappOutbox',id];
const terminal=new Set(['SENT','SIMULATED','HUMAN_REVIEW','DEAD_LETTER','DELIVERY_UNKNOWN','OPTED_OUT','AUTOMATION_PAUSED']);
const errorCode=e=>/^[a-z_0-9]{1,70}$/i.test(e?.code||'')?e.code:'processing_failed';
const STOP=/^(توقف|قف|الغاء|إلغاء|لا تراسلني|stop|unsubscribe)$/i;
const sensitive=t=>/(عمول[ةه]|عربون|توقيع|وقع العقد|غي[رّ]+ السعر|غير السعر|سعر نهائي|رقم الهوي[ةه]|حساب بنكي|تجاهل.*تعليمات|ignore.*instructions|token|secret|مفتاح API)/i.test(t);
const TIME_WORDS=/(اليوم|بكر[هةا]|غد[اًا]?|بعد بكر|(?:^|\s)(?:يوم\s+)?(?:ال|لل|بال|وال|ل)?(?:أحد|احد|اثنين|إثنين|ثلاثاء|أربعاء|اربعاء|خميس|جمعة|جمعه|سبت)(?=$|\s|[،,.!؟?])|الساعة|الساعه|الصبح|الظهر|العصر|المغرب|العشاء|الليل|\d{1,2}\s*(?:ص|م)(?=$|\s)|\d{1,2}:\d{2})/;

export function whatsappAgentAvailable(env={}) {
  return env.DEPLOYMENT_ENV==='staging'&&env.FIREBASE_PROJECT_ID==='iaqar-ai-staging'&&env.WHATSAPP_AGENT_ENABLED==='enabled'&&list(env.WHATSAPP_AGENT_OFFICE_IDS).length>0;
}
async function mappingFor(ctx,phoneNumberId,wabaId) {
 const mapping=await ctx.store.get(['whatsapp_accounts',phoneNumberId]);
 return mapping&&mapping.status==='connected'&&mapping.wabaId===wabaId&&list(ctx.env.WHATSAPP_AGENT_OFFICE_IDS).includes(mapping.officeId)?mapping:null;
}
async function officeOn(ctx,officeId) { return (await ctx.store.get(['offices',officeId,'integrations','whatsapp']))?.autoReplyEnabled===true; }
/** The office's own number running on Cloud API next to the Business app (coexistence), or Meta's test number. */
function agentNumber(mapping){return mapping?.platformType==='CLOUD_API'&&mapping.metaPhoneStatus==='CONNECTED'&&(mapping.isOnBizApp===true||mapping.isTestNumber===true);}
const recipientAllowed=(ctx,phone)=>list(ctx.env.WHATSAPP_AGENT_ALLOWED_RECIPIENTS).map(digits).includes(digits(phone));
const mediaOrigin=env=>{const o=clean(env.WHATSAPP_MEDIA_ORIGIN,200).replace(/\/$/,'');return /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o)?o:'';};

async function appendPending(ctx,officeId,conversationId,id,flags={}) {
 const p=conversationPath(officeId,conversationId);
 await ctx.store.create(p,{officeId,pending:[],turns:[],draft:{},createdAt:ctx.now()});
 await ctx.store.update(p,c=>{
  const pending=Array.isArray(c.pending)?c.pending:[];
  if(pending.includes(id))return null;
  if(pending.length>=100)throw ctx.deps.appError('conversation_backlog_full',503,'تعذر حفظ المزيد من الرسائل الآن');
  return {pending:[...pending,id],...flags,updatedAt:ctx.now()};
 });
}

async function receiveStatus(ctx,mapping,phoneNumberId,status) {
 const callback=clean(status.biz_opaque_callback_data,400).split('|');
 if(callback.length!==3||callback[0]!=='waq'||callback[1]!==mapping.officeId||!/^wa_[a-f0-9]{40}$/.test(callback[2]))return;
 const p=path(mapping.officeId,callback[2]);const job=await ctx.store.get(p);
 if(!job||job.phoneNumberId!==phoneNumberId||digits(status.recipient_id)!==job.senderPhone)return;
 const delivery=clean(status.status,20);if(!['sent','delivered','read','failed'].includes(delivery))return;
 const rank={sent:1,failed:2,delivered:3,read:4};
 await ctx.store.update(p,c=>{
  if(c.outboundMessageId&&c.outboundMessageId!==status.id)return null;
  if((rank[c.deliveryState]||0)>rank[delivery])return null;
  return {outboundMessageId:clean(status.id,200),deliveryState:delivery,deliveryAt:ctx.now(),...(delivery==='failed'?{waQueueState:'HUMAN_REVIEW',waError:'meta_delivery_failed'}:{waQueueState:'SENT'})};
 });
}

export async function ingestWhatsAppEvents(ctx,payload) {
 if(!whatsappAgentAvailable(ctx.env)||payload?.object!=='whatsapp_business_account')return {received:0,ignored:true};
 let received=0,statuses=0;
 for(const entry of Array.isArray(payload.entry)?payload.entry:[])for(const change of Array.isArray(entry.changes)?entry.changes:[]){
  if(change.field!=='messages')continue;
  const value=change.value||{},phoneNumberId=clean(value.metadata?.phone_number_id);
  if(!phoneNumberId)continue;
  const mapping=await mappingFor(ctx,phoneNumberId,clean(entry.id));if(!mapping)continue;
  for(const status of Array.isArray(value.statuses)?value.statuses:[]){await receiveStatus(ctx,mapping,phoneNumberId,status);statuses++;}
  const names=new Map((value.contacts||[]).map(c=>[digits(c.wa_id),clean(c.profile?.name,80)]));
  for(const message of Array.isArray(value.messages)?value.messages:[]){
   if(!clean(message.id,200)||!/^\d{8,15}$/.test(String(message.from||'')))continue;
   const officeId=mapping.officeId,senderPhone=String(message.from),conversationId=(await ctx.deps.sha256Hex(`${phoneNumberId}|${senderPhone}`)).slice(0,40);
   const id=`wa_${(await ctx.deps.sha256Hex(message.id)).slice(0,40)}`;
   const inbound=readInbound(message);
   const media=inbound.kind==='media'?(message[message.type]||{}):null;
   const receivedAt=new Date(Number(message.timestamp)*1000||ctx.now().getTime());
   const created=await ctx.store.create(path(officeId,id),{officeId,id,source:'whatsapp_cloud_api',channel:'whatsapp_business',direction:'inbound',messageId:clean(message.id,200),phoneNumberId,wabaId:clean(entry.id),senderPhone,senderName:names.get(senderPhone)||'',conversationId,messageText:inbound.text,actionId:inbound.actionId,messageType:clean(message.type,30),mediaRef:media?{id:clean(media.id,200),caption:clean(media.caption,1000),mimeType:clean(media.mime_type,100),fileName:clean(media.filename,200)}:null,receivedAt,createdAt:ctx.now(),status:'pending_review',processingState:'queued',isProcessed:false,waQueueState:'QUEUED',waAttempts:0});
   const saved=await ctx.store.get(path(officeId,id));
   // A replay repairs a pointer after partial persistence instead of discarding the message.
   if(!terminal.has(saved.waQueueState)){
    const text=inbound.kind==='text'?inbound.text:'';
    const flags=STOP.test(text)?{optedOut:true}:sensitive(text)?{handoff:true}:{};
    await appendPending(ctx,officeId,conversationId,id,{...flags,lastInboundAt:receivedAt,phoneNumberId,wabaId:clean(entry.id),senderPhone});
    await ctx.store.create([...queueRoot,'jobs',`${officeId}_${id}`],{officeId,inboxId:id,dueAt:ctx.now(),createdAt:ctx.now()});
   }
   if(created)received++;
  }
 }
 return {received,statuses};
}

// ------------------------------------------------------------------ the agent's turn

/** The snapshot with the price and status read from the office's record now. */
const fresh=(item,listing)=>({...item,price:Number(priceOf(listing.row))||item.price,status:listing.status,statusLabel:LISTING_STATUS_LABEL[listing.status]||item.statusLabel});

/** Every result is re-read before it is shown: an unpublished, reserved or sold offer is never sent. */
async function verifiedResults(ctx,results){
 const out=[];
 for(const item of results){
  try{const listing=await currentListing(ctx,item.reference);if(listing)out.push(fresh(item,listing));}
  catch{throw Object.assign(Error('inventory_unavailable'),{code:'inventory_unavailable'});}
 }
 return out;
}

async function officeLinkFor(ctx,officeId){
 const office=await ctx.store.get(['publicOffices',officeId]).catch(()=>null);
 const slug=clean(office?.publicSlug||office?.slug,80);
 return slug&&/^[a-z0-9-]+$/i.test(slug)&&ctx.appOrigin?`${ctx.appOrigin}/m/${encodeURIComponent(slug)}`:'';
}

async function caseIdFor(ctx,conversationId,reference){return `wc_${(await ctx.deps.sha256Hex(`${conversationId}|${reference}`)).slice(0,32)}`;}
const event=(ctx,type,text,by='whatsapp_agent')=>({type,text:String(text||'').slice(0,300),by,at:ctx.now().toISOString()});

async function tellOffice(ctx,officeId,{key,title,body,brokerId=''}){
 await notifyOffice(ctx.store,ctx.deps,{officeId,brokerId,key:`wa-agent:${key}`,title,body,route:'inbox',now:ctx.now()}).catch(e=>console.warn('[whatsapp-agent] office notify failed',e?.code||e?.message));
}

/** The property case the client acts on: one per conversation and listing. Interest is recorded once. */
async function ensureCase(ctx,job,c,item,index){
 const id=await caseIdFor(ctx,job.conversationId,item.reference),p=casePath(job.officeId,id);
 let doc=await ctx.store.get(p);
 if(doc)return {id,doc,leadCreated:false};
 const chosen=await selectGuestResultForChannel(ctx,{searchToken:c.searchToken,reference:item.reference,name:job.senderName||'عميل واتساب',phone:job.senderPhone,channel:'whatsapp',via:'whatsapp_agent'});
 const row=chosen.listing.row||{};
 // Same office: the pair enters the office's own match review (Daily Tasks → deal journey). Best effort.
 let pair=null;
 if(c.requestRecordId&&chosen.listing.officeId===job.officeId){
  try{pair=await pairRecords(ctx,{officeId:job.officeId,recordId:c.requestRecordId,counterpartId:chosen.listing.recordId});}
  catch(e){pair={ok:false,error:errorCode(e)};}
 }
 doc={officeId:job.officeId,id,conversationId:job.conversationId,phoneNumberId:job.phoneNumberId,wabaId:job.wabaId,senderPhone:job.senderPhone,senderName:job.senderName||'',
  reference:item.reference,listingOfficeId:chosen.listing.officeId,recordId:chosen.listing.recordId,resultIndex:index,
  listing:{propertyType:chosen.item.propertyType,district:chosen.item.district,city:chosen.item.city,purpose:chosen.item.purpose||'',price:chosen.item.price},
  requestRecordId:c.requestRecordId||'',assignedBrokerId:clean(row.brokerId||row.assignedBrokerId,128),matchId:pair?.matchId||'',pairResult:pair?(pair.ok?(pair.alreadyOpen?'journey_open':'match_created'):pair.error):'',
  stage:CASE_STAGE.INTERESTED,negotiation:{status:'NONE',offers:[],ownerDecisions:[]},viewing:{state:'NONE',history:[]},readinessEvents:[READINESS_EVENT.SELECTED,READINESS_EVENT.CONTACT_CONSENT],
  events:[event(ctx,'INTEREST',`اهتمام العميل بالعرض ${index+1}`)],createdAt:ctx.now(),updatedAt:ctx.now()};
 const created=await ctx.store.create(p,doc);
 if(!created)return {id,doc:await ctx.store.get(p),leadCreated:false};
 await writeAudit(ctx,{officeId:job.officeId,action:'WHATSAPP_AGENT_INTEREST',actorUid:'whatsapp-agent',entityType:'whatsapp_case',entityId:id,key:job.id,details:{reference:item.reference}}).catch(()=>{});
 return {id,doc,leadCreated:chosen.leadCreated,interestNotice:chosen.interestNotice};
}

async function updateCase(ctx,officeId,id,mutate){
 const r=await ctx.store.update(casePath(officeId,id),current=>{const patch=mutate(current);if(!patch)return null;return {...patch,events:[...(current.events||[]),...(patch.events||[])].slice(-60),updatedAt:ctx.now()};});
 return r?.next||r?.current||null;
}

function needItem(c,action){
 const results=c.results||[];
 if(Number.isInteger(action.index)&&action.index>=0&&action.index<results.length)return action.index;
 if(Number.isInteger(c.selectedIndex)&&c.selectedIndex<results.length)return c.selectedIndex;
 return results.length===1?0:null;
}

function whichOfferMessage(c,verb){
 const rows=(c.results||[]).slice(0,9).map((r,i)=>({id:actionId(verb,i),title:`العرض ${i+1}`,description:`${r.propertyType} — ${r.district}`}));
 return listMessage('أي عرض تقصد؟',{button:'اختر العرض',sections:[{title:'عروضك',rows}]});
}

async function agentTurn(ctx,job,c){
 const action=detectAction({text:job.messageText,actionId:job.actionId},c);
 const results=c.results||[];
 if(action.type===ACTION.NEW_SEARCH)return {messages:[textMessage('تمام، نبدأ طلبًا جديدًا. وش العقار اللي تبحث عنه؟ (النوع، الحي، والميزانية)')],patch:{draft:{},missing:'',results:[],shown:0,selectedIndex:null,searchToken:'',awaiting:'',stage:'INTAKE',awaitingConsent:false}};
 if(action.type===ACTION.MORE){
  // The client's list keeps its numbering: unavailable entries are skipped, never renumbered under them.
  const start=Math.min(Number(c.shown||3),results.length),page=[];let next=start;
  for(;next<results.length&&page.length<3;next++){const [ok]=await verifiedResults(ctx,[results[next]]);if(ok)page.push({...ok,position:next});}
  if(!page.length)return {messages:[buttonsMessage('ما عندي بدائل إضافية منشورة ومتاحة الآن لنفس طلبك. تقدر تبدأ بحثًا بشروط مختلفة.',[{id:actionId(ACTION.NEW_SEARCH),title:'بحث جديد'},{id:actionId(ACTION.HUMAN),title:'التواصل مع المسؤول'}])],patch:{awaiting:''},inventory:true};
  const tail=results.length-next;
  return {messages:resultsMessages(page,{criteria:c.draft,from:0,count:page.length,more:tail>0?tail:0,continuation:true}),patch:{shown:next,awaiting:''},inventory:true};
 }
 if(action.type===ACTION.NONE){
  return {messages:[textMessage('ما تأكدت من طلبك. اختر من القائمة، أو اكتب مثلًا: «تفاصيل العرض 1»، «صور العرض 2»، «معاينة»، أو «موظف».'),...(results.length?[whichOfferMessage(c,ACTION.DETAILS)]:[])],patch:{}};
 }
 const viewingCaseId=c.selectedCaseId||'';
 if(action.type===ACTION.CANCEL_VIEWING||(action.type===ACTION.RESCHEDULE&&viewingCaseId)){
  if(!viewingCaseId)return {messages:[textMessage('ما عندك طلب معاينة مسجل حاليًا.')],patch:{}};
  const current=await ctx.store.get(casePath(job.officeId,viewingCaseId));
  if(!current||!['REQUESTED','RESCHEDULE_REQUESTED','CONFIRMED'].includes(current.viewing?.state))return {messages:[textMessage('ما عندك طلب معاينة قائم حاليًا. اكتب «معاينة» لطلب موعد.')],patch:{}};
  if(action.type===ACTION.CANCEL_VIEWING){
   await updateCase(ctx,job.officeId,viewingCaseId,cur=>cur.viewing?.state==='CANCELLED_BY_CLIENT'?null:{viewing:{...cur.viewing,state:'CANCELLED_BY_CLIENT',cancelledAt:ctx.now().toISOString(),history:[...(cur.viewing.history||[]),{state:cur.viewing.state,at:cur.viewing.at||null,preferredLabel:cur.viewing.preferredLabel||''}].slice(-10)},stage:CASE_STAGE.INTERESTED,events:[event(ctx,'VIEWING_CANCELLED_BY_CLIENT','ألغى العميل طلب/موعد المعاينة')]});
   await tellOffice(ctx,job.officeId,{key:`viewing-cancel:${job.id}`,title:'إلغاء معاينة من العميل',body:`${current.listing?.propertyType||''} — ${current.listing?.district||''} (المرجع ${current.reference})`,brokerId:current.assignedBrokerId});
   return {messages:[textMessage('تم إلغاء طلب المعاينة وإبلاغ المكتب. تقدر تطلب موعدًا جديدًا متى ما حبيت.')],patch:{awaiting:''}};
  }
  const pref=parseViewingTime(action.timeText||'',ctx.now());
  if(!TIME_WORDS.test(action.timeText||'')||job.actionId)return {messages:[askViewingTimeMessage(current.listing||{})],patch:{awaiting:'viewing_time',awaitingReschedule:true}};
  return recordViewingPreference(ctx,job,c,{caseId:viewingCaseId,doc:current,pref,reschedule:true});
 }
 const index=needItem(c,action);
 if(index===null)return {messages:[whichOfferMessage(c,action.type===ACTION.RESCHEDULE?ACTION.VIEWING:action.type)],patch:{}};
 const snapshot=results[index];
 const listing=await currentListing(ctx,snapshot.reference).catch(()=>{throw Object.assign(Error('inventory_unavailable'),{code:'inventory_unavailable'});});
 if(!listing)return {messages:[buttonsMessage(`العرض ${index+1} (المرجع ${snapshot.reference}) لم يعد متاحًا حسب بيانات المكتب الآن.`,[{id:actionId(ACTION.MORE),title:'عرض بدائل'},{id:actionId(ACTION.HUMAN),title:'التواصل مع المسؤول'}])],patch:{selectedIndex:null},inventory:true};
 const item=fresh(snapshot,listing);
 const base={selectedIndex:index};
 switch(action.type){
  case ACTION.DETAILS:
   return {messages:detailsMessages(item,index,{criteria:c.draft,officeLink:await officeLinkFor(ctx,listing.officeId)}),patch:{...base,awaiting:''},inventory:true};
  case ACTION.PHOTOS:{
   const origin=mediaOrigin(ctx.env);
   const photos=recordImages(listing.row).filter(img=>keyBelongsTo(img.path,listing.officeId,listing.recordId)).slice(0,3);
   const next=buttonsMessage('تبي تكمل على هذا العقار؟',[{id:actionId(ACTION.INTEREST,index),title:'مهتم بالعقار'},{id:actionId(ACTION.VIEWING,index),title:'حجز معاينة'},{id:actionId(ACTION.MORE),title:'عرض بدائل'}]);
   if(!photos.length)return {messages:[textMessage(`ما فيه صور منشورة لهذا العرض حاليًا (المرجع ${item.reference}). تقدر تطلب من المكتب صورًا إضافية أو معاينة.`),next],patch:{...base,awaiting:''},inventory:true};
   if(!origin)return {messages:[textMessage(`لهذا العرض ${photos.length} صور منشورة، والإرسال الآلي للصور غير مفعل في بيئة الاختبار. اطلبها من المكتب بكتابة «موظف».`),next],patch:{...base,awaiting:''},inventory:true};
   return {messages:[...photos.map((img,k)=>imageMessage(`${origin}/media/public/${img.path.split('/').map(encodeURIComponent).join('/')}`,k===0?`${item.propertyType} — ${item.district} (المرجع ${item.reference})`:'')),next],patch:{...base,awaiting:''},inventory:true};
  }
  case ACTION.INTEREST:{
   const kase=await ensureCase(ctx,job,c,item,index);
   return {messages:afterInterestMessages(item,index,{leadCreated:kase.leadCreated}),patch:{...base,selectedCaseId:kase.id,awaiting:''},inventory:true};
  }
  case ACTION.NEGOTIATE:{
   const kase=await ensureCase(ctx,job,c,item,index);
   return {messages:[askOfferMessage(item)],patch:{...base,selectedCaseId:kase.id,awaiting:'offer_price'},inventory:true};
  }
  case ACTION.OFFER_PRICE:{
   if(!action.price||action.price<1000)return {messages:[askOfferMessage(item)],patch:{...base,awaiting:'offer_price'}};
   const kase=await ensureCase(ctx,job,c,item,index);
   // The owner's floor (if the office recorded one) only tells the office how to route it; the client never learns it.
   const mandate=mandateDecision({floor:Number(listing.row.negotiationFloor)||null},action.price);
   await updateCase(ctx,job.officeId,kase.id,cur=>{
    const offers=cur.negotiation?.offers||[];if(offers.some(o=>o.id===job.id))return null;
    return {stage:CASE_STAGE.NEGOTIATING,negotiation:{...cur.negotiation,status:'AWAITING_OWNER',offers:[...offers,{id:job.id,price:action.price,listedPrice:item.price,at:ctx.now().toISOString(),source:'client_whatsapp',mandate}].slice(-20)},events:[event(ctx,'CLIENT_OFFER',`عرض العميل ${action.price} ريال (المعلن ${item.price})`)]};
   });
   await tellOffice(ctx,job.officeId,{key:`offer:${job.id}`,title:'عرض سعر من عميل واتساب',body:`${action.price.toLocaleString('en-US')} ريال على ${item.propertyType} — ${item.district} (المرجع ${item.reference}). يحتاج رد المالك.`,brokerId:kase.doc.assignedBrokerId});
   return {messages:offerRecordedMessages(item,action.price),patch:{...base,selectedCaseId:kase.id,awaiting:''},inventory:true};
  }
  case ACTION.VIEWING:
  case ACTION.VIEWING_TIME:
  case ACTION.RESCHEDULE:{
   const kase=await ensureCase(ctx,job,c,item,index);
   const said=action.timeText||'';
   if(job.actionId||!TIME_WORDS.test(said))return {messages:[askViewingTimeMessage(item)],patch:{...base,selectedCaseId:kase.id,awaiting:'viewing_time'},inventory:true};
   return recordViewingPreference(ctx,job,c,{caseId:kase.id,doc:kase.doc,pref:parseViewingTime(said,ctx.now()),reschedule:c.awaitingReschedule===true||action.type===ACTION.RESCHEDULE,index});
  }
  case ACTION.FOLLOWUP_GOOD:
  case ACTION.FOLLOWUP_NOTES:{
   const id=c.selectedCaseId;const current=id?await ctx.store.get(casePath(job.officeId,id)):null;
   if(!current)return {messages:[textMessage('شكرًا لك. وصلت رسالتك للمكتب.')],patch:{awaiting:''}};
   const good=action.type===ACTION.FOLLOWUP_GOOD;
   if(!good&&job.actionId)return {messages:[textMessage('تفضل اكتب ملاحظاتك على العقار، وبنوصلها للمكتب.')],patch:{awaiting:'followup'}};
   await updateCase(ctx,job.officeId,id,cur=>({stage:CASE_STAGE.VIEWED,followUp:{result:good?'SUITABLE':'NOTES',note:good?'':clean(action.note||job.messageText,500),at:ctx.now().toISOString()},opportunityTemperature:good?'HOT':'NEEDS_ATTENTION',readinessEvents:[...new Set([...(cur.readinessEvents||[]),...(good?[READINESS_EVENT.EXPLICIT_INTENT]:[])])],events:[event(ctx,'FOLLOW_UP',good?'العميل: العقار مناسب ويرغب بالمتابعة':`ملاحظات العميل: ${clean(action.note||job.messageText,200)}`)]}));
   await tellOffice(ctx,job.officeId,{key:`followup:${job.id}`,title:good?'عميل جاهز للمتابعة بعد المعاينة':'ملاحظات عميل بعد المعاينة',body:`${current.listing?.propertyType||''} — ${current.listing?.district||''} (المرجع ${current.reference})`,brokerId:current.assignedBrokerId});
   return {messages:[good?buttonsMessage('ممتاز! بلغت المكتب برغبتك في المتابعة. تقدر تقدم عرض سعر الآن، أو ينتظر المكتب يتواصل معك بالخطوات التالية.',[{id:actionId(ACTION.NEGOTIATE,current.resultIndex??index),title:'طلب تفاوض'},{id:actionId(ACTION.HUMAN),title:'التواصل مع المسؤول'}]):textMessage('وصلت ملاحظاتك للمكتب، وبيتواصل معك. تقدر تكتب «بدائل» لعرض عقارات أخرى.')],patch:{awaiting:''}};
  }
  default:
   return {messages:[textMessage('ما تأكدت من طلبك. اكتب «موظف» للتواصل مع المكتب.')],patch:{}};
 }
}

async function recordViewingPreference(ctx,job,c,{caseId,doc,pref,reschedule,index}){
 const item={...(doc.listing||{}),reference:doc.reference};
 await updateCase(ctx,job.officeId,caseId,cur=>{
  if(cur.viewing?.requestMessageId===job.id)return null;
  const prev=cur.viewing||{};
  return {stage:CASE_STAGE.VIEWING_REQUESTED,viewing:{state:reschedule&&prev.state&&prev.state!=='NONE'?'RESCHEDULE_REQUESTED':'REQUESTED',preferredLabel:pref.label,preferredAt:pref.at,at:null,requestMessageId:job.id,requestedAt:ctx.now().toISOString(),history:prev.state&&prev.state!=='NONE'?[...(prev.history||[]),{state:prev.state,at:prev.at||null,preferredLabel:prev.preferredLabel||''}].slice(-10):(prev.history||[])},readinessEvents:[...new Set([...(cur.readinessEvents||[]),READINESS_EVENT.VIEWING_REQUESTED])],events:[event(ctx,reschedule?'VIEWING_RESCHEDULE_REQUESTED':'VIEWING_REQUESTED',`الوقت المفضل: ${pref.label}`)]};
 });
 await tellOffice(ctx,job.officeId,{key:`viewing:${job.id}`,title:reschedule?'طلب تغيير موعد معاينة':'طلب معاينة من عميل واتساب',body:`${item.propertyType||''} — ${item.district||''} (المرجع ${item.reference}). الوقت المفضل: ${pref.label}. يحتاج تنسيقًا مع المالك وتأكيدًا.`,brokerId:doc.assignedBrokerId});
 return {messages:viewingRequestedMessages(item,pref,{reschedule}),patch:{selectedCaseId:caseId,...(Number.isInteger(index)?{selectedIndex:index}:{}),awaiting:'',awaitingReschedule:false},inventory:true};
}

/** First contact → understood request → consent → saved in the office CRM → real, verified results. */
async function intakeTurn(ctx,job,c){
 const text=job.messageText;
 let classified;
 // A retry rebuilds inventory but never pays for the same understanding twice.
 if(job.waIntent&&job.waClassified===true) classified={intent:job.waIntent,requiresHuman:false,usage:{inputTokens:0,outputTokens:0}};
 else if(usesPaidClassifier(ctx.env)) {
  const usagePath=['offices',job.officeId,'usage',`whatsapp_claude_${ctx.now().toISOString().slice(0,10)}`];
  await ctx.store.create(usagePath,{attempts:0,createdAt:ctx.now()});let reserved=false;
  await ctx.store.update(usagePath,u=>{reserved=false;if(Number(u.attempts||0)>=200)return null;reserved=true;return {attempts:Number(u.attempts||0)+1,updatedAt:ctx.now()};});
  if(!reserved)return {human:true,reason:'claude_daily_budget_reached'};
  classified=await classifyWithClaude(ctx,text,c.turns||[]);
  await ctx.store.update(usagePath,u=>({inputTokens:Number(u.inputTokens||0)+classified.usage.inputTokens,outputTokens:Number(u.outputTokens||0)+classified.usage.outputTokens}));
 } else classified=await classifyWithClaude(ctx,text,c.turns||[]);
 if(classified.requiresHuman)return {human:true,reason:'claude_handoff'};
 const persona=personaFromText(text);
 let draft={...(c.draft||{})};
 if(!draft.kind)draft.kind=persona===PERSONA.OWNER?'OFFER':persona===PERSONA.CLIENT?'REQUEST':'';
 draft=mergeDraft(draft,extractFacts(text,{expectNumber:c.missing||''}));
 // Customer data never grants permission to edit a listing, price, contract or commission.
 if(draft.kind==='OFFER')return {human:true,reason:'offer_requires_broker_review',patch:{draft},usage:classified.usage};
 const missing=nextMissing(draft);
 if(missing)return {messages:[textMessage(questionFor(missing,draft,'ar'))],patch:{draft,missing,stage:'INTAKE'},intent:classified.intent,usage:classified.usage};
 const consent=c.consent===true||(/^موافق[.،!\s]*$/.test(text)&&c.awaitingConsent===true);
 if(!consent)return {messages:[textMessage(`فهمت طلبك: ${summaryLines(draft,'ar').map(l=>l.replace(/^•\s*/,'')).join('، ')}.\nهل توافق على حفظ طلبك لدى المكتب والبحث في العروض المنشورة والتواصل معك بخصوصه؟ اكتب «موافق» للمتابعة.`)],patch:{draft,missing:'',awaitingConsent:true,stage:'INTAKE'},intent:classified.intent,usage:classified.usage};
 // The request enters the office's own CRM through the normal save path (validation, duplicates, matching).
 let requestRecordId=c.requestRecordId||'';
 if(!requestRecordId){
  try{
   const office=await ctx.store.get(['offices',job.officeId]).catch(()=>null)||{};
   const assignment=await ctx.store.get(['offices',job.officeId,'officeSettings','assignment']).catch(()=>null);
   const actor={uid:clean(assignment?.defaultBrokerId||office.ownerUid,128)||'whatsapp-agent',role:'broker',isManager:false};
   const phone=`0${digits(job.senderPhone).replace(/^966/,'')}`;
   const input={...toRecordInput(draft,{phone,name:job.senderName||'عميل واتساب'}),intakeOrigin:{channel:'WHATSAPP',role:'CLIENT',method:'SMART_FILL',text:(c.turns||[]).filter(t=>t.role==='customer').map(t=>t.text).concat(text).join('\n').slice(0,2000)}};
   const saved=await saveRecord(ctx,{actor,officeId:job.officeId,input,requestKey:`wa-${job.id}`});
   requestRecordId=saved.recordId||'';
  }catch(e){console.warn('[whatsapp-agent] crm save failed',errorCode(e));}
 }
 const shareSearch=(await ctx.store.get(['offices',job.officeId,'integrations','whatsapp']).catch(()=>null))?.agentSearchScope==='all';
 let result;
 try{
  result=await guestSearch({...ctx,officeId:job.officeId},{input:{officeId:job.officeId,scope:shareSearch?'all':'office',criteria:toRecordInput(draft,{phone:job.senderPhone,name:job.senderName||'عميل واتساب'}),name:job.senderName||'عميل واتساب',phone:job.senderPhone,channel:'whatsapp',requestKey:`wa_${job.id.slice(3)}`,consentProcessing:true,consentContact:true},ip:`wa:${job.conversationId}`});
 }catch(e){
  if(['request_invalid','scope_invalid'].includes(e?.code))return {messages:[textMessage(`${e.message||'بيانات الطلب غير مكتملة'}. صحّح المعلومة وأرسلها.`)],patch:{draft,consent:true,awaitingConsent:false,requestRecordId}};
  throw Object.assign(Error('inventory_unavailable'),{code:'inventory_unavailable'});
 }
 const verified=await verifiedResults(ctx,result.results||[]);
 const patch={draft,missing:'',consent:true,awaitingConsent:false,requestRecordId,searchToken:result.searchToken,results:verified,shown:3,selectedIndex:null,stage:'RESULTS',awaiting:''};
 if(!verified.length){
  await tellOffice(ctx,job.officeId,{key:`no-match:${job.id}`,title:'طلب واتساب بدون عروض مطابقة',body:summaryLines(draft,'ar').join(' ').slice(0,200)});
  return {messages:[textMessage(NO_RESULTS_TEXT)],patch,intent:classified.intent,usage:classified.usage,inventory:true};
 }
 return {messages:resultsMessages(verified,{criteria:draft,from:0,count:3}),patch,intent:classified.intent,usage:classified.usage,inventory:true};
}

async function buildReply(ctx,job,c){
 // «موظف» / the button: one honest message, then the conversation belongs to a person until the office resumes it.
 if(job.actionId==='wa:HUMAN'||wantsHuman(job.messageText)){
  await tellOffice(ctx,job.officeId,{key:`human:${job.id}`,title:'عميل واتساب يطلب موظفًا',body:`${job.senderName||'عميل'} طلب التحدث مع المسؤول`});
  return {messages:[textMessage(HUMAN_TEXT)],patch:{awaiting:''},handoffAfterSend:true};
 }
 try{
  if(c.consent===true&&Array.isArray(c.results)&&(c.results.length||c.stage==='RESULTS'))return await agentTurn(ctx,job,c);
  return await intakeTurn(ctx,job,c);
 }catch(e){
  if(errorCode(e)==='inventory_unavailable')return {messages:[textMessage(UNAVAILABLE_TEXT)],patch:{},degraded:true};
  throw e;
 }
}

// ------------------------------------------------------------------ queue processing

async function finish(ctx,job,queue,state,extra={}) {
 const stored=await ctx.store.get(path(job.officeId,job.id));
 await ctx.store.set(path(job.officeId,job.id),{waQueueState:state,processingState:state==='SENT'||state==='SIMULATED'?'processed':'pending_review',isProcessed:['SENT','SIMULATED','OPTED_OUT'].includes(state),...extra,updatedAt:ctx.now()});
 await ctx.store.update(conversationPath(job.officeId,job.conversationId),c=>({
  pending:(c.pending||[]).filter(id=>id!==job.id),
  ...(['SENT','SIMULATED'].includes(state)&&(c.pending||[])[0]===job.id&&stored?.waReply?{...(stored.waDraftPatch||{}),turns:[...(c.turns||[]),{role:'customer',text:job.messageText},{role:'assistant',text:stored.waReply}].slice(-16)}:{}),
  ...(['HUMAN_REVIEW','DELIVERY_UNKNOWN','DEAD_LETTER'].includes(state)?{handoff:true}:{}),updatedAt:ctx.now()
 }));
 await ctx.store.remove([...queueRoot,'jobs',queue.id]);
}

const summaryOf=messages=>messages.map(m=>m.type==='text'?m.text.body:m.type==='interactive'?m.interactive.body.text:m.type==='image'?`[صورة] ${m.image.caption||''}`:'').filter(Boolean).join('\n—\n').slice(0,4000);

async function processJob(ctx,queue) {
 const p=path(queue.officeId,queue.inboxId);let job=await ctx.store.get(p);if(!job){await ctx.store.remove([...queueRoot,'jobs',queue.id]);return;}
 if(terminal.has(job.waQueueState)){await finish(ctx,job,queue,job.waQueueState);return;}
 const cp=conversationPath(job.officeId,job.conversationId),lease=crypto.randomUUID();let locked=false;
 await ctx.store.update(cp,c=>{locked=false;if(millis(c.leaseUntil)>ctx.now().getTime()||(c.pending||[])[0]!==job.id)return null;locked=true;return {lease,leaseUntil:new Date(ctx.now().getTime()+120000)};});
 if(!locked)return;
 try {
  job=await ctx.store.get(p);const c=await ctx.store.get(cp);
  if(job.waQueueState==='SENDING') {await finish(ctx,job,queue,'DELIVERY_UNKNOWN',{waError:'send_result_not_persisted'});return;}
  if(terminal.has(job.waQueueState)){await finish(ctx,job,queue,job.waQueueState);return;}
  if(!await officeOn(ctx,job.officeId)){await finish(ctx,job,queue,'AUTOMATION_PAUSED',{waError:'office_automation_off'});return;}
  if(STOP.test(job.messageText)){
   await ctx.store.update(cp,()=>({optedOut:true}));await finish(ctx,job,queue,'OPTED_OUT');return;
  }
  const isMedia=!['text','interactive','button'].includes(job.messageType);
  if(c.optedOut||c.handoff||sensitive(job.messageText)||isMedia) {await finish(ctx,job,queue,'HUMAN_REVIEW',{waError:'human_review_required'});return;}
  const mapping=await mappingFor(ctx,job.phoneNumberId,job.wabaId);
  if(!agentNumber(mapping)||mapping.officeId!==job.officeId||!recipientAllowed(ctx,job.senderPhone)){await finish(ctx,job,queue,'HUMAN_REVIEW',{waError:'coexistence_or_recipient_not_authorised'});return;}
  const age=ctx.now().getTime()-millis(job.receivedAt);
  if(age<0||age>=DAY){await finish(ctx,job,queue,'HUMAN_REVIEW',{waError:'service_window_closed'});return;}
  job.waAttempts=Number(job.waAttempts||0)+1;
  await ctx.store.set(p,{waQueueState:'PROCESSING',waAttempts:job.waAttempts,updatedAt:ctx.now()});
  const contact=['offices',job.officeId,'contacts',job.senderPhone];
  await ctx.store.create(contact,{officeId:job.officeId,phone:`+${job.senderPhone}`,whatsappDisplayName:job.senderName,source:'whatsapp_cloud_api',createdAt:ctx.now()});
  // A saved non-inventory reply is resent as is; inventory is rebuilt so a retry re-verifies every listing.
  let reply=job.waMessagesJson&&!job.waInventory?{messages:JSON.parse(job.waMessagesJson),patch:job.waDraftPatch||{},handoffAfterSend:job.waHandoffAfterSend===true}:await buildReply(ctx,job,c);
  if(reply.human){
   if(reply.patch)await ctx.store.update(cp,()=>reply.patch);
   await finish(ctx,job,queue,'HUMAN_REVIEW',{waError:reply.reason});return;
  }
  const messages=Array.isArray(reply.messages)?reply.messages.slice(0,6):[];
  if(!messages.length){await finish(ctx,job,queue,'HUMAN_REVIEW',{waError:'empty_reply'});return;}
  const patch={...(reply.patch||{})};
  const summary=summaryOf(messages);
  await ctx.store.set(p,{waReply:summary,waMessagesJson:JSON.stringify(messages),waDraftPatch:patch,waHandoffAfterSend:reply.handoffAfterSend===true,waIntent:reply.intent||job.waIntent||'',waClassified:Boolean(reply.intent||job.waClassified),claudeUsage:reply.usage||job.claudeUsage||{inputTokens:0,outputTokens:0},waInventory:reply.inventory===true,waQueueState:'READY_REPLY'});
  // Last-moment kill switch + ownership + recipient check; no queued reply bypasses policy.
  const freshC=await ctx.store.get(cp),freshMapping=await mappingFor(ctx,job.phoneNumberId,job.wabaId);
  if(freshC.lease!==lease||millis(freshC.leaseUntil)<=ctx.now().getTime())return;
  if(!whatsappAgentAvailable(ctx.env)||!await officeOn(ctx,job.officeId)||freshC.optedOut||freshC.handoff||!agentNumber(freshMapping)||freshMapping.officeId!==job.officeId||!recipientAllowed(ctx,job.senderPhone)||ctx.now().getTime()-millis(job.receivedAt)>=DAY){await finish(ctx,job,queue,'HUMAN_REVIEW',{waError:'policy_changed'});return;}
  if(economicModeActive(ctx.env)||ctx.env.WHATSAPP_AGENT_SEND!=='enabled'){
   await finish(ctx,job,queue,'SIMULATED');
   if(reply.handoffAfterSend)await ctx.store.update(cp,()=>({handoff:true}));
   return;
  }
  if(!whatsappAccessToken(ctx.env))throw Object.assign(Error('meta_token_missing'),{code:'meta_token_missing'});
  await ctx.store.set(p,{waQueueState:'SENDING',sendingAt:ctx.now()});
  const sentIds=[];
  for(let k=0;k<messages.length;k++){
   const sent=await sendWhatsAppMessage(ctx,{phoneNumberId:job.phoneNumberId,to:job.senderPhone,message:messages[k],callback:k===0?`waq|${job.officeId}|${job.id}`:''});
   if(!sent.ok){
    if(k===0&&sent.retryable){await ctx.store.set(p,{waQueueState:'READY_REPLY'});throw Object.assign(Error('meta_rate_limited'),{code:'meta_rate_limited'});}
    if(k===0){await finish(ctx,job,queue,sent.unknown?'DELIVERY_UNKNOWN':'HUMAN_REVIEW',{waError:sent.error});return;}
    // Part of the reply reached the client: never resend the first part; a person completes it.
    await ctx.store.set(p,{outboundMessageIds:sentIds,partialDelivery:true});
    await finish(ctx,job,queue,'HUMAN_REVIEW',{waError:`partial_${sent.error}`});return;
   }
   sentIds.push(sent.messageId);
   if(k===0)await ctx.store.update(p,current=>({outboundMessageId:sent.messageId,deliveryState:['delivered','read','failed','sent'].includes(current.deliveryState)?current.deliveryState:'accepted'}));
  }
  await ctx.store.set(p,{outboundMessageIds:sentIds});
  const final=await ctx.store.get(p);
  await finish(ctx,job,queue,final.deliveryState==='failed'?'HUMAN_REVIEW':'SENT');
  if(reply.handoffAfterSend)await ctx.store.update(cp,()=>({handoff:true}));
 }catch(e){
  const current=await ctx.store.get(p);
  if(current?.outboundMessageId){
   await finish(ctx,job,queue,current.deliveryState==='failed'?'HUMAN_REVIEW':'SENT',{waError:'post_send_projection_recovered'});
  }else if(current?.waQueueState==='SENDING'){
   await finish(ctx,job,queue,'DELIVERY_UNKNOWN',{waError:'send_completion_uncertain'});
  }else if(errorCode(e)==='claude_auth_failed'){
   await finish(ctx,job,queue,'HUMAN_REVIEW',{waError:'claude_auth_failed'});
  }else if(Number(job.waAttempts||0)>=5){await finish(ctx,job,queue,'DEAD_LETTER',{waError:errorCode(e)});}
  else{
   await ctx.store.set(p,{waQueueState:'RETRY',waError:errorCode(e),updatedAt:ctx.now()});
   await ctx.store.set([...queueRoot,'jobs',queue.id],{dueAt:new Date(ctx.now().getTime()+Math.min(1800000,30000*2**Math.max(0,Number(job.waAttempts||1)-1)))});
  }
 }finally{await ctx.store.update(cp,c=>c.lease===lease?{lease:'',leaseUntil:ctx.now()}:null);}
}

// ------------------------------------------------------------------ office → client (verified facts only)

/**
 * One message the office caused (owner's answer, confirmed viewing, reminder, follow-up, deal update).
 * Idempotent per key; the same gates as replies; outside the 24-hour window nothing is sent — an approved
 * template would be required, so the outbox says so instead of pretending.
 */
async function deliverOfficeUpdate(ctx,{officeId,caseDoc,key,messages,conversationPatch=null}){
 const id=`wo_${(await ctx.deps.sha256Hex(`${officeId}|${key}`)).slice(0,40)}`,op=outboxPath(officeId,id);
 const existing=await ctx.store.get(op);if(existing)return {id,state:existing.state,duplicate:true};
 const cp=conversationPath(officeId,caseDoc.conversationId),c=await ctx.store.get(cp)||{};
 const mapping=await mappingFor(ctx,caseDoc.phoneNumberId,caseDoc.wabaId);
 let state='';
 if(!whatsappAgentAvailable(ctx.env)||!await officeOn(ctx,officeId))state='AUTOMATION_OFF';
 else if(c.optedOut)state='OPTED_OUT';
 else if(!agentNumber(mapping)||mapping.officeId!==officeId||!recipientAllowed(ctx,caseDoc.senderPhone))state='NOT_AUTHORISED';
 else if(ctx.now().getTime()-millis(c.lastInboundAt)>=DAY)state='TEMPLATE_REQUIRED';
 const created=await ctx.store.create(op,{officeId,id,caseId:caseDoc.id,key:String(key).slice(0,200),state:state||'PENDING',summary:summaryOf(messages),createdAt:ctx.now()});
 if(!created)return {id,state:(await ctx.store.get(op))?.state,duplicate:true};
 if(state)return {id,state};
 if(economicModeActive(ctx.env)||ctx.env.WHATSAPP_AGENT_SEND!=='enabled'||!whatsappAccessToken(ctx.env)){
  await ctx.store.set(op,{state:'SIMULATED',updatedAt:ctx.now()});
  if(conversationPatch)await ctx.store.update(cp,()=>conversationPatch);
  return {id,state:'SIMULATED'};
 }
 await ctx.store.set(op,{state:'SENDING',updatedAt:ctx.now()});
 const ids=[];
 for(const message of messages){
  const sent=await sendWhatsAppMessage(ctx,{phoneNumberId:caseDoc.phoneNumberId,to:caseDoc.senderPhone,message});
  if(!sent.ok){await ctx.store.set(op,{state:ids.length?'PARTIAL':sent.unknown?'DELIVERY_UNKNOWN':'FAILED',error:sent.error,messageIds:ids,updatedAt:ctx.now()});return {id,state:ids.length?'PARTIAL':'FAILED'};}
  ids.push(sent.messageId);
 }
 await ctx.store.set(op,{state:'SENT',messageIds:ids,updatedAt:ctx.now()});
 if(conversationPatch)await ctx.store.update(cp,()=>conversationPatch);
 return {id,state:'SENT'};
}

async function sweepOffice(ctx,officeId){
 const cases=(await ctx.store.list(['offices',officeId,'whatsappCases'],300).catch(()=>[])).filter(k=>k.viewing?.state==='CONFIRMED'&&k.viewing?.at);
 let reminders=0,followUps=0;const now=ctx.now().getTime();
 for(const k of cases){
  const at=millis(k.viewing.at);
  if(at>now&&at-now<=3*3600000&&!k.viewing.reminderClaimedAt){
   let claimed=false;await updateCase(ctx,officeId,k.id,cur=>cur.viewing?.reminderClaimedAt||cur.viewing?.at!==k.viewing.at?null:(claimed=true,{viewing:{...cur.viewing,reminderClaimedAt:ctx.now().toISOString()}}));
   if(claimed){const r=await deliverOfficeUpdate(ctx,{officeId,caseDoc:k,key:`reminder:${k.id}:${k.viewing.at}`,messages:[textMessage(reminderText(k))]});await updateCase(ctx,officeId,k.id,cur=>({viewing:{...cur.viewing,reminderState:r.state},events:[event(ctx,'VIEWING_REMINDER',`تذكير المعاينة: ${r.state}`)]}));reminders++;}
  }
  if(now-at>=2*3600000&&!k.viewing.followUpClaimedAt){
   let claimed=false;await updateCase(ctx,officeId,k.id,cur=>cur.viewing?.followUpClaimedAt||cur.viewing?.at!==k.viewing.at?null:(claimed=true,{viewing:{...cur.viewing,followUpClaimedAt:ctx.now().toISOString()}}));
   if(claimed){const r=await deliverOfficeUpdate(ctx,{officeId,caseDoc:k,key:`followup:${k.id}:${k.viewing.at}`,messages:[followUpQuestion(k.listing)],conversationPatch:{awaiting:'followup',selectedCaseId:k.id,...(Number.isInteger(k.resultIndex)?{selectedIndex:k.resultIndex}:{})}});await updateCase(ctx,officeId,k.id,cur=>({viewing:{...cur.viewing,followUpState:r.state},events:[event(ctx,'FOLLOW_UP_ASKED',`سؤال المتابعة: ${r.state}`)]}));followUps++;}
  }
 }
 return {reminders,followUps};
}

export async function drainWhatsAppQueue(ctx,{officeId=''}={}) {
 if(!whatsappAgentAvailable(ctx.env))return {ok:true,processed:0,disabled:true};
 const jobs=await ctx.store.queryAfter(queueRoot,'jobs',{field:'dueAt',before:new Date(ctx.now().getTime()+1),limit:50});let processed=0;
 for(const job of jobs){if(officeId&&job.officeId!==officeId)continue;await processJob(ctx,job);processed++;}
 let reminders=0,followUps=0;
 for(const id of list(ctx.env.WHATSAPP_AGENT_OFFICE_IDS)){if(officeId&&id!==officeId)continue;if(!await officeOn(ctx,id))continue;const s=await sweepOffice(ctx,id).catch(e=>{console.warn('[whatsapp-agent] sweep failed',errorCode(e));return {reminders:0,followUps:0};});reminders+=s.reminders;followUps+=s.followUps;}
 return {ok:true,processed,reminders,followUps};
}

// ------------------------------------------------------------------ office endpoints

const CASE_VIEW=k=>({id:k.id,reference:k.reference,listing:k.listing,stage:k.stage,senderName:k.senderName,senderPhoneTail:String(k.senderPhone||'').slice(-4),negotiation:k.negotiation,viewing:k.viewing,followUp:k.followUp||null,agreement:k.agreement||null,outcome:k.outcome||null,assignedBrokerId:k.assignedBrokerId||'',pairResult:k.pairResult||'',requestRecordId:k.requestRecordId||'',recordId:k.recordId,listingOfficeId:k.listingOfficeId,events:(k.events||[]).slice(-20),updatedAt:k.updatedAt});

export async function listWhatsAppCases(ctx,{officeId,actor}) {
 if(!actor?.uid)throw ctx.deps.appError('forbidden',403,'غير مصرح');
 const rows=await ctx.store.list(['offices',officeId,'whatsappCases'],300);
 const mine=actor.isManager?rows:rows.filter(k=>!k.assignedBrokerId||k.assignedBrokerId===actor.uid);
 return {ok:true,cases:mine.filter(k=>k.officeId===officeId).sort((a,b)=>millis(b.updatedAt)-millis(a.updatedAt)).map(CASE_VIEW)};
}

/**
 * The office acts on a case. Every action is recorded with who, when and the stated source of the owner's
 * approval; the client hears only what a person decided. Replays of the same requestKey change nothing.
 */
export async function actOnWhatsAppCase(ctx,{officeId,actor,caseId,action,input={},requestKey=''}) {
 if(!actor?.uid)throw ctx.deps.appError('forbidden',403,'غير مصرح');
 const key=clean(requestKey,100);if(!/^[a-zA-Z0-9_-]{8,100}$/.test(key))throw ctx.deps.appError('request_key_required',400,'أعد المحاولة');
 if(!/^wc_[a-f0-9]{32}$/.test(String(caseId||'')))throw ctx.deps.appError('case_invalid',400,'الحالة غير صالحة');
 const p=casePath(officeId,caseId);const doc=await ctx.store.get(p);
 if(!doc||doc.officeId!==officeId)throw ctx.deps.appError('case_not_found',404,'الحالة غير موجودة');
 if(!actor.isManager&&doc.assignedBrokerId&&doc.assignedBrokerId!==actor.uid)throw ctx.deps.appError('forbidden',403,'هذه الحالة لوسيط آخر');
 if((doc.actionKeys||[]).includes(key))return {ok:true,duplicate:true,case:CASE_VIEW(doc)};
 if(action===OFFICE_ACTION.RESUME_AGENT){
  await ctx.store.update(conversationPath(officeId,doc.conversationId),()=>({handoff:false,awaiting:''}));
  await updateCase(ctx,officeId,caseId,cur=>({actionKeys:[...(cur.actionKeys||[]),key].slice(-50),events:[event(ctx,'AGENT_RESUMED','أعاد المكتب تشغيل الرد الآلي',actor.uid)]}));
  await writeAudit(ctx,{officeId,action:'WHATSAPP_AGENT_RESUMED',actorUid:actor.uid,entityType:'whatsapp_case',entityId:caseId,key});
  return {ok:true,resumed:true};
 }
 if(!Object.values(OFFICE_ACTION).includes(action)||!officeActionAllowed(doc,action))throw ctx.deps.appError('action_not_allowed',409,'هذا الإجراء غير متاح في مرحلة الحالة الحالية');
 if([OFFICE_ACTION.AGREEMENT,OFFICE_ACTION.CLOSE_WON].includes(action)&&!actor.isManager&&actor.uid!==doc.assignedBrokerId)throw ctx.deps.appError('forbidden',403,'الاتفاق والإغلاق للمدير أو الوسيط المسؤول');
 const by=actor.uid,at=ctx.now().toISOString();
 let patch={},clientInput={},conversationPatch=null,messages=null;
 switch(action){
  case OFFICE_ACTION.NEGOTIATION_ANSWER:{
   const decision=clean(input.decision,20);if(!['accepted','rejected','counter'].includes(decision))throw ctx.deps.appError('decision_invalid',400,'اختر رد المالك');
   const last=(doc.negotiation.offers||[]).at(-1);
   const price=decision==='counter'?Number(input.price):Number(last?.price);
   if(decision==='counter'&&!(price>0))throw ctx.deps.appError('price_required',400,'اكتب السعر المقترح من المالك');
   // The owner's answer must come from the owner (or a mandate holder) and say how it was obtained.
   if(decision!=='rejected'&&(input.ownerConfirmed!==true||clean(input.ownerConfirmationSource,200).length<3))throw ctx.deps.appError('owner_confirmation_required',400,'وثّق موافقة المالك ومصدرها قبل إبلاغ العميل');
   const status={accepted:'ACCEPTED_BY_OWNER',rejected:'REJECTED_BY_OWNER',counter:'COUNTERED_BY_OWNER'}[decision];
   patch={negotiation:{...doc.negotiation,status,ownerDecisions:[...(doc.negotiation.ownerDecisions||[]),{decision,price,offerId:last?.id||'',source:clean(input.ownerConfirmationSource,200),by,at}].slice(-20),...(decision==='accepted'?{agreedPrice:price}:{})},events:[event(ctx,'OWNER_ANSWER',`رد المالك: ${decision} ${price||''}`,by)]};
   clientInput={decision,price};
   if(decision==='counter')conversationPatch={awaiting:'offer_price',selectedCaseId:caseId};
   break;
  }
  case OFFICE_ACTION.VIEWING_CONFIRM:{
   const when=new Date(input.at);if(!Number.isFinite(when.getTime())||when.getTime()<=ctx.now().getTime())throw ctx.deps.appError('viewing_time_invalid',400,'حدد موعدًا قادمًا');
   if(input.ownerConfirmed!==true)throw ctx.deps.appError('owner_confirmation_required',400,'أكّد أن الموعد منسق مع المالك أو المسؤول');
   const others=await ctx.store.list(['offices',officeId,'whatsappCases'],300);
   const clash=viewingConflict(others,{caseId,reference:doc.reference,brokerId:doc.assignedBrokerId,at:when.toISOString()});
   if(clash)throw ctx.deps.appError('viewing_conflict',409,'يوجد موعد معاينة مؤكد آخر في نفس الوقت لهذا العقار أو الوسيط');
   const iso=when.toISOString();
   patch={stage:CASE_STAGE.VIEWING_CONFIRMED,viewing:{...doc.viewing,state:'CONFIRMED',at:iso,confirmedBy:by,confirmedAt:at,ownerCoordinated:true,note:clean(input.note,200),reminderClaimedAt:'',followUpClaimedAt:'',history:doc.viewing.state==='CONFIRMED'?[...(doc.viewing.history||[]),{state:'CONFIRMED',at:doc.viewing.at}].slice(-10):(doc.viewing.history||[])},events:[event(ctx,'VIEWING_CONFIRMED',`تأكيد المعاينة ${iso}`,by)]};
   clientInput={at:iso,note:input.note};
   messages=[buttonsMessage(officeUpdateText(action,doc,clientInput),[{id:actionId(ACTION.RESCHEDULE),title:'تغيير الموعد'},{id:actionId(ACTION.CANCEL_VIEWING),title:'إلغاء الموعد'}])];
   conversationPatch={selectedCaseId:caseId};
   break;
  }
  case OFFICE_ACTION.VIEWING_CANCEL:
   patch={stage:CASE_STAGE.INTERESTED,viewing:{...doc.viewing,state:'CANCELLED_BY_OFFICE',cancelledAt:at,cancelledBy:by,history:[...(doc.viewing.history||[]),{state:doc.viewing.state,at:doc.viewing.at||null}].slice(-10)},events:[event(ctx,'VIEWING_CANCELLED_BY_OFFICE',clean(input.reason,200),by)]};
   clientInput={reason:input.reason};
   break;
  case OFFICE_ACTION.VIEWING_RESULT:{
   const result=clean(input.result,20);if(!['attended','no_show'].includes(result))throw ctx.deps.appError('viewing_result_invalid',400,'اختر نتيجة المعاينة');
   patch={stage:result==='attended'?CASE_STAGE.VIEWED:CASE_STAGE.INTERESTED,viewing:{...doc.viewing,state:result==='attended'?'DONE':'NO_SHOW',resultBy:by,resultAt:at,followUpClaimedAt:at},events:[event(ctx,'VIEWING_RESULT',result,by)]};
   if(result==='attended'){messages=[followUpQuestion(doc.listing)];conversationPatch={awaiting:'followup',selectedCaseId:caseId};}
   else messages=[textMessage(`ما تمت معاينة ${doc.listing?.propertyType||'العقار'} في الموعد. اكتب «معاينة» مع وقت آخر يناسبك.`)];
   break;
  }
  case OFFICE_ACTION.AGREEMENT:
   patch={stage:CASE_STAGE.AGREEMENT,agreement:{price:Number(doc.negotiation.agreedPrice)||null,at,by,documents:'COORDINATED_BY_OFFICE'},events:[event(ctx,'AGREEMENT','اتفاق مبدئي مسجل',by)]};
   break;
  case OFFICE_ACTION.CLOSE_WON:{
   const c=input.confirmations||{};
   // Closing is a record of what already happened through the official channels — never an action here.
   if(c.ownerApproval!==true||c.contractSigned!==true||c.paymentHandledOfficially!==true)throw ctx.deps.appError('closing_confirmations_required',400,'أكّد موافقة المالك وتوقيع العقد وإتمام الدفع عبر القنوات النظامية');
   const finalPrice=Number(input.finalPrice)||Number(doc.agreement?.price)||null;
   patch={stage:CASE_STAGE.CLOSED_WON,outcome:{result:'WON',finalPrice,closedAt:at,closedBy:by,confirmations:{ownerApproval:true,contractSigned:true,paymentHandledOfficially:true}},events:[event(ctx,'CLOSED_WON',`إتمام الصفقة ${finalPrice||''}`,by)]};
   // Stop marketing a property that is no longer available (only this office's own listing).
   if(doc.listingOfficeId===officeId){
    const sold=String(doc.listing?.purpose||'').toUpperCase()==='RENT'?'RENTED':'SOLD';
    await ctx.store.set(['offices',officeId,'opportunities',doc.recordId],{availabilityStatus:sold,availabilityConfirmedAt:ctx.now(),availabilityConfirmedBy:`broker:${by}`,validityReason:'whatsapp_case_closed_won'});
    await writeAudit(ctx,{officeId,action:'RECORD_AVAILABILITY_CLOSED',actorUid:by,entityType:'record',entityId:doc.recordId,key:`case:${caseId}`,details:{status:sold}}).catch(()=>{});
   }
   break;
  }
  case OFFICE_ACTION.CLOSE_LOST:
   patch={stage:CASE_STAGE.CLOSED_LOST,outcome:{result:'LOST',reason:clean(input.reason,200),closedAt:at,closedBy:by},events:[event(ctx,'CLOSED_LOST',clean(input.reason,200),by)]};
   clientInput={reason:input.reason};
   break;
 }
 const next=await updateCase(ctx,officeId,caseId,cur=>(cur.actionKeys||[]).includes(key)?null:{...patch,actionKeys:[...(cur.actionKeys||[]),key].slice(-50)});
 await writeAudit(ctx,{officeId,action:`WHATSAPP_CASE_${String(action).toUpperCase()}`,actorUid:by,entityType:'whatsapp_case',entityId:caseId,key,details:{stage:patch.stage||doc.stage}}).catch(()=>{});
 const body=messages?null:officeUpdateText(action,doc,clientInput);
 const delivery=await deliverOfficeUpdate(ctx,{officeId,caseDoc:doc,key:`${action}:${caseId}:${key}`,messages:messages||[textMessage(body)],conversationPatch});
 await updateCase(ctx,officeId,caseId,()=>({events:[event(ctx,'CLIENT_UPDATE',`${action}: ${delivery.state}`,by)]}));
 return {ok:true,case:CASE_VIEW(next||doc),delivery};
}

export async function configureWhatsAppAgent(ctx,{officeId,actor,enabled}) {
 if(!actor?.isManager)throw ctx.deps.appError('forbidden',403,'إعداد الموظف العقاري لمدير المكتب فقط');
 if(typeof enabled!=='boolean')throw ctx.deps.appError('enabled_required',400,'حدد حالة التشغيل');
 if(enabled&&!whatsappAgentAvailable(ctx.env))throw ctx.deps.appError('whatsapp_agent_not_configured',503,'التكامل التجريبي غير مهيأ');
 const paid=usesPaidClassifier(ctx.env);
 if(enabled&&(!list(ctx.env.WHATSAPP_AGENT_OFFICE_IDS).includes(officeId)||(paid&&(!ctx.env.ANTHROPIC_API_KEY||!ctx.env.ANTHROPIC_MODEL))||!list(ctx.env.WHATSAPP_AGENT_ALLOWED_RECIPIENTS).length||(ctx.env.WHATSAPP_AGENT_SEND==='enabled'&&!whatsappAccessToken(ctx.env))))throw ctx.deps.appError('whatsapp_agent_not_configured',503,'مفاتيح واتساب أو نطاق الاختبار غير مكتملة');
 await ctx.store.set(['offices',officeId,'integrations','whatsapp'],{autoReplyEnabled:enabled===true,autoReplyUpdatedAt:ctx.now(),autoReplyUpdatedBy:actor.uid});
 await writeAudit(ctx,{officeId,action:enabled?'WHATSAPP_AGENT_ENABLED':'WHATSAPP_AGENT_DISABLED',actorUid:actor.uid,entityType:'channel',entityId:'whatsapp',key:ctx.now().toISOString()});
 return {ok:true,enabled:enabled===true};
}

export async function whatsappAgentStatus(ctx,{officeId,actor}) {
 if(!actor?.isManager)throw ctx.deps.appError('forbidden',403,'لمدير المكتب فقط');
 const integration=await ctx.store.get(['offices',officeId,'integrations','whatsapp'])||{};
 const sample=(await ctx.store.list(['offices',officeId,'inbox'],300)).filter(r=>r.source==='whatsapp_cloud_api'&&r.waQueueState);
 const counts={};for(const row of sample)counts[row.waQueueState]=(counts[row.waQueueState]||0)+1;
 return {ok:true,environmentReady:whatsappAgentAvailable(ctx.env),enabled:integration.autoReplyEnabled===true,sendingEnabled:ctx.env.WHATSAPP_AGENT_SEND==='enabled'&&!economicModeActive(ctx.env),economicMode:economicModeActive(ctx.env),paidClassifier:usesPaidClassifier(ctx.env),claudeConfigured:Boolean(ctx.env.ANTHROPIC_API_KEY&&ctx.env.ANTHROPIC_MODEL),metaTokenConfigured:Boolean(whatsappAccessToken(ctx.env)),mediaOrigin:Boolean(mediaOrigin(ctx.env)),sampleLimit:300,sampled:sample.length,counts};
}
