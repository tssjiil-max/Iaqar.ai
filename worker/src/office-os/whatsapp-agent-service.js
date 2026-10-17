/** Durable WhatsApp intake/queue on the existing Firestore store. No new CRM or matching engine.
 * Inbox is the message record; serviceQueues/whatsapp/jobs contains only durable work pointers.
 * The global Staging gate, office switch, current mapping and recipient allowlist all fail closed.
 */
import { classifyWithClaude, sendWhatsAppReply } from './whatsapp-agent-transport.js';
import { extractFacts, mergeDraft, nextMissing, questionFor, personaFromText, PERSONA, wantsHuman, toRecordInput, summaryLines } from '../../../public/os/domain/visitor-domain.js';
import { guestSearch } from './public-search-service.js';
import { writeAudit } from './audit-log.js';
import { economicModeFor } from './economic-policy.js';

const clean=(v,n=120)=>String(v??'').trim().slice(0,n);
const digits=v=>String(v||'').replace(/\D/g,'');
const list=v=>String(v||'').split(',').map(x=>x.trim()).filter(Boolean);
const millis=v=>new Date(v||0).getTime()||0;
const queueRoot=['serviceQueues','whatsapp'];
const path=(officeId,id)=>['offices',officeId,'inbox',id];
const conversationPath=(officeId,id)=>['offices',officeId,'whatsappConversations',id];
const terminal=new Set(['SENT','SIMULATED','HUMAN_REVIEW','DEAD_LETTER','DELIVERY_UNKNOWN','OPTED_OUT','AUTOMATION_PAUSED']);
const errorCode=e=>/^[a-z_0-9]{1,70}$/i.test(e?.code||'')?e.code:'processing_failed';
const sensitive=t=>/(عمول[ةه]|عربون|توقيع|وقع العقد|غي[رّ]+ السعر|غير السعر|سعر نهائي|رقم الهوي[ةه]|حساب بنكي|تجاهل.*تعليمات|ignore.*instructions|token|secret|مفتاح API)/i.test(t);

export function whatsappAgentAvailable(env={}) {
  return env.DEPLOYMENT_ENV==='staging'&&env.FIREBASE_PROJECT_ID==='iaqar-ai-staging'&&env.WHATSAPP_AGENT_ENABLED==='enabled'&&list(env.WHATSAPP_AGENT_OFFICE_IDS).length>0;
}
async function mappingFor(ctx,phoneNumberId,wabaId) {
 const mapping=await ctx.store.get(['whatsapp_accounts',phoneNumberId]);
 return mapping&&mapping.status==='connected'&&mapping.wabaId===wabaId&&list(ctx.env.WHATSAPP_AGENT_OFFICE_IDS).includes(mapping.officeId)?mapping:null;
}
async function officeOn(ctx,officeId) { return (await ctx.store.get(['offices',officeId,'integrations','whatsapp']))?.autoReplyEnabled===true; }
function coexistence(mapping){return mapping?.isOnBizApp===true&&mapping.platformType==='CLOUD_API'&&mapping.metaPhoneStatus==='CONNECTED';}

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
  // Economic Test Mode is strictly offline. Keep a second guard here so a
  // misconfigured WhatsApp pilot allowlist cannot enqueue its Meta events.
  if(economicModeFor(ctx.env,mapping.officeId))continue;
  for(const status of Array.isArray(value.statuses)?value.statuses:[]){await receiveStatus(ctx,mapping,phoneNumberId,status);statuses++;}
  const names=new Map((value.contacts||[]).map(c=>[digits(c.wa_id),clean(c.profile?.name,80)]));
  for(const message of Array.isArray(value.messages)?value.messages:[]){
   if(!clean(message.id,200)||!/^\d{8,15}$/.test(String(message.from||'')))continue;
   const officeId=mapping.officeId,senderPhone=String(message.from),conversationId=(await ctx.deps.sha256Hex(`${phoneNumberId}|${senderPhone}`)).slice(0,40);
   const id=`wa_${(await ctx.deps.sha256Hex(message.id)).slice(0,40)}`;
   const media=message[message.type]||{};
   const created=await ctx.store.create(path(officeId,id),{officeId,id,source:'whatsapp_cloud_api',channel:'whatsapp_business',direction:'inbound',messageId:clean(message.id,200),phoneNumberId,wabaId:clean(entry.id),senderPhone,senderName:names.get(senderPhone)||'',conversationId,messageText:message.type==='text'?clean(message.text?.body,4000):'',messageType:clean(message.type,30),mediaRef:message.type==='text'?null:{id:clean(media.id,200),caption:clean(media.caption,1000),mimeType:clean(media.mime_type,100),fileName:clean(media.filename,200)},receivedAt:new Date(Number(message.timestamp)*1000||ctx.now().getTime()),createdAt:ctx.now(),status:'pending_review',processingState:'queued',isProcessed:false,waQueueState:'QUEUED',waAttempts:0});
   const saved=await ctx.store.get(path(officeId,id));
   // A replay repairs a pointer after partial persistence instead of discarding the message.
   if(!terminal.has(saved.waQueueState)){
    const text=message.type==='text'?clean(message.text?.body,4000):'';
    const flags=/^(توقف|قف|الغاء|إلغاء|لا تراسلني|stop|unsubscribe)$/i.test(text)?{optedOut:true}:wantsHuman(text)||sensitive(text)?{handoff:true}:{};
    await appendPending(ctx,officeId,conversationId,id,flags);
    await ctx.store.create([...queueRoot,'jobs',`${officeId}_${id}`],{officeId,inboxId:id,dueAt:ctx.now(),createdAt:ctx.now()});
   }
   if(created)received++;
  }
 }
 return {received,statuses};
}

async function buildReply(ctx,job,c) {
 const text=job.messageText;
 let classified;
 if(job.waReply&&job.waInventory)classified={intent:job.waIntent,requiresHuman:false,usage:job.claudeUsage||{inputTokens:0,outputTokens:0}};
 else {
 if(ctx.env.ECONOMIC_TEST_MODE!=='enabled') {
 const usagePath=['offices',job.officeId,'usage',`whatsapp_claude_${ctx.now().toISOString().slice(0,10)}`];
 await ctx.store.create(usagePath,{attempts:0,createdAt:ctx.now()});let reserved=false;
 await ctx.store.update(usagePath,u=>{reserved=false;if(Number(u.attempts||0)>=200)return null;reserved=true;return {attempts:Number(u.attempts||0)+1,updatedAt:ctx.now()};});
 if(!reserved)return {human:true,reason:'claude_daily_budget_reached'};
 }
 classified=await classifyWithClaude(ctx,text,c.turns||[]);
 if(ctx.env.ECONOMIC_TEST_MODE!=='enabled') {
 const usagePath=['offices',job.officeId,'usage',`whatsapp_claude_${ctx.now().toISOString().slice(0,10)}`];
 await ctx.store.update(usagePath,u=>({inputTokens:Number(u.inputTokens||0)+classified.usage.inputTokens,outputTokens:Number(u.outputTokens||0)+classified.usage.outputTokens}));
 }
 }
 if(classified.requiresHuman)return {human:true,reason:'claude_handoff'};
 const persona=personaFromText(text);
 let draft={...(c.draft||{})};
 if(!draft.kind)draft.kind=persona===PERSONA.OWNER?'OFFER':persona===PERSONA.CLIENT?'REQUEST':'';
 draft=mergeDraft(draft,extractFacts(text,{expectNumber:c.missing||''}));
 // Customer data never grants permission to edit a listing, price, contract or commission.
 if(draft.kind==='OFFER')return {human:true,reason:'offer_requires_broker_review',draft,intent:classified.intent,usage:classified.usage};
 const missing=nextMissing(draft);
 if(missing)return {body:questionFor(missing,draft,'ar'),draft,missing,intent:classified.intent,usage:classified.usage};
 const consent=c.consent===true||(/^موافق[.،!\s]*$/.test(text)&&c.awaitingConsent===true);
 if(!consent)return {body:`فهمت طلبك: ${summaryLines(draft,'ar').join('، ')}. هل توافق على حفظ طلبك والبحث والتواصل معك بخصوصه؟ اكتب «موافق» للمتابعة.`,draft,awaitingConsent:true,intent:classified.intent,usage:classified.usage};
 const result=await guestSearch({...ctx,officeId:job.officeId},{input:{officeId:job.officeId,scope:'office',criteria:toRecordInput(draft,{phone:job.senderPhone,name:job.senderName||'عميل واتساب'}),name:job.senderName||'عميل واتساب',phone:job.senderPhone,channel:'whatsapp',requestKey:`wa_${job.id.slice(3)}`,consentProcessing:true,consentContact:true},ip:`wa:${job.conversationId}`});
 const top=result.results.slice(0,3);
 const body=top.length?['هذه أفضل النتائج المنشورة المطابقة لطلبك:',...top.map((r,i)=>`${i+1}. ${r.propertyType} — ${r.city}، ${r.district} — ${r.price} ريال. المرجع: ${r.reference}`),'التوفر يحتاج تأكيد المكتب قبل المعاينة أو الاتفاق.'].join('\n'):'تم حفظ طلبك. ما وجدت عروضًا منشورة مطابقة للشروط الآن؛ يحتاج المكتب متابعة الطلب.';
 return {body,draft,consent:true,awaitingConsent:false,intent:classified.intent,usage:classified.usage,inventory:true};
}

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
  if(/^(توقف|قف|الغاء|إلغاء|لا تراسلني|stop|unsubscribe)$/i.test(job.messageText)){
   await ctx.store.update(cp,()=>({optedOut:true}));await finish(ctx,job,queue,'OPTED_OUT');return;
  }
  if(c.optedOut||c.handoff||wantsHuman(job.messageText)||sensitive(job.messageText)||job.messageType!=='text') {await finish(ctx,job,queue,'HUMAN_REVIEW',{waError:'human_review_required'});return;}
  const mapping=await mappingFor(ctx,job.phoneNumberId,job.wabaId);
  if(!coexistence(mapping)||mapping.officeId!==job.officeId||!list(ctx.env.WHATSAPP_AGENT_ALLOWED_RECIPIENTS).map(digits).includes(job.senderPhone)){await finish(ctx,job,queue,'HUMAN_REVIEW',{waError:'coexistence_or_recipient_not_authorised'});return;}
  const age=ctx.now().getTime()-millis(job.receivedAt);
  if(age<0||age>=86400000){await finish(ctx,job,queue,'HUMAN_REVIEW',{waError:'service_window_closed'});return;}
  job.waAttempts=Number(job.waAttempts||0)+1;
  await ctx.store.set(p,{waQueueState:'PROCESSING',waAttempts:job.waAttempts,updatedAt:ctx.now()});
  const contact=['offices',job.officeId,'contacts',job.senderPhone];
  await ctx.store.create(contact,{officeId:job.officeId,phone:`+${job.senderPhone}`,whatsappDisplayName:job.senderName,source:'whatsapp_cloud_api',createdAt:ctx.now()});
  let reply=job.waReply&&!job.waInventory ? {body:job.waReply,...(job.waDraftPatch||{})}:await buildReply(ctx,job,c);
  if(reply.human){await finish(ctx,job,queue,'HUMAN_REVIEW',{waError:reply.reason});return;}
  const patch={draft:reply.draft||c.draft||{},missing:reply.missing||'',consent:reply.consent??c.consent??false,awaitingConsent:reply.awaitingConsent??c.awaitingConsent??false};
  await ctx.store.set(p,{waReply:reply.body,waDraftPatch:patch,waIntent:reply.intent||job.waIntent||'',claudeUsage:reply.usage||job.claudeUsage||{},waInventory:reply.inventory===true||job.waInventory===true,waQueueState:'READY_REPLY'});
  // Last-moment kill switch + ownership + recipient check; no queued reply bypasses policy.
  const fresh=await ctx.store.get(cp),freshMapping=await mappingFor(ctx,job.phoneNumberId,job.wabaId);
  if(fresh.lease!==lease||millis(fresh.leaseUntil)<=ctx.now().getTime())return;
  if(!whatsappAgentAvailable(ctx.env)||!await officeOn(ctx,job.officeId)||fresh.optedOut||fresh.handoff||!coexistence(freshMapping)||freshMapping.officeId!==job.officeId||!list(ctx.env.WHATSAPP_AGENT_ALLOWED_RECIPIENTS).map(digits).includes(job.senderPhone)||ctx.now().getTime()-millis(job.receivedAt)>=86400000){await finish(ctx,job,queue,'HUMAN_REVIEW',{waError:'policy_changed'});return;}
  if(ctx.env.ECONOMIC_TEST_MODE==='enabled'||ctx.env.WHATSAPP_AGENT_SEND!=='enabled'){
   await finish(ctx,job,queue,'SIMULATED');return;
  }
  if(!ctx.env.META_WHATSAPP_ACCESS_TOKEN)throw Object.assign(Error('meta_token_missing'),{code:'meta_token_missing'});
  await ctx.store.set(p,{waQueueState:'SENDING',sendingAt:ctx.now()});
  const sent=await sendWhatsAppReply(ctx,{phoneNumberId:job.phoneNumberId,to:job.senderPhone,body:reply.body,callback:`waq|${job.officeId}|${job.id}`});
  if(!sent.ok){
   if(sent.retryable){await ctx.store.set(p,{waQueueState:'READY_REPLY'});throw Object.assign(Error('meta_rate_limited'),{code:'meta_rate_limited'});}
   await finish(ctx,job,queue,sent.unknown?'DELIVERY_UNKNOWN':'HUMAN_REVIEW',{waError:sent.error});return;
  }
  await ctx.store.update(p,current=>({outboundMessageId:sent.messageId,deliveryState:['delivered','read','failed','sent'].includes(current.deliveryState)?current.deliveryState:'accepted',waQueueState:current.deliveryState==='failed'?'HUMAN_REVIEW':'SENT'}));
  const final=await ctx.store.get(p);
  await finish(ctx,job,queue,final.deliveryState==='failed'?'HUMAN_REVIEW':'SENT');
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

export async function drainWhatsAppQueue(ctx,{officeId=''}={}) {
 if(!whatsappAgentAvailable(ctx.env))return {ok:true,processed:0,disabled:true};
 const jobs=await ctx.store.queryAfter(queueRoot,'jobs',{field:'dueAt',before:new Date(ctx.now().getTime()+1),limit:50});let processed=0;
 for(const job of jobs){if(officeId&&job.officeId!==officeId)continue;await processJob(ctx,job);processed++;}
 return {ok:true,processed};
}

export async function configureWhatsAppAgent(ctx,{officeId,actor,enabled}) {
 if(!actor?.isManager)throw ctx.deps.appError('forbidden',403,'إعداد الموظف العقاري لمدير المكتب فقط');
 if(typeof enabled!=='boolean')throw ctx.deps.appError('enabled_required',400,'حدد حالة التشغيل');
 if(enabled&&!whatsappAgentAvailable(ctx.env))throw ctx.deps.appError('whatsapp_agent_not_configured',503,'التكامل التجريبي غير مهيأ');
 if(enabled&&(!list(ctx.env.WHATSAPP_AGENT_OFFICE_IDS).includes(officeId)||!ctx.env.ANTHROPIC_API_KEY||!ctx.env.ANTHROPIC_MODEL||!list(ctx.env.WHATSAPP_AGENT_ALLOWED_RECIPIENTS).length||(ctx.env.WHATSAPP_AGENT_SEND==='enabled'&&!ctx.env.META_WHATSAPP_ACCESS_TOKEN)))throw ctx.deps.appError('whatsapp_agent_not_configured',503,'مفاتيح Claude وواتساب أو نطاق الاختبار غير مكتملة');
 await ctx.store.set(['offices',officeId,'integrations','whatsapp'],{autoReplyEnabled:enabled===true,autoReplyUpdatedAt:ctx.now(),autoReplyUpdatedBy:actor.uid});
 await writeAudit(ctx,{officeId,action:enabled?'WHATSAPP_AGENT_ENABLED':'WHATSAPP_AGENT_DISABLED',actorUid:actor.uid,entityType:'channel',entityId:'whatsapp',key:ctx.now().toISOString()});
 return {ok:true,enabled:enabled===true};
}

export async function whatsappAgentStatus(ctx,{officeId,actor}) {
 if(!actor?.isManager)throw ctx.deps.appError('forbidden',403,'لمدير المكتب فقط');
 const integration=await ctx.store.get(['offices',officeId,'integrations','whatsapp'])||{};
 const sample=(await ctx.store.list(['offices',officeId,'inbox'],300)).filter(r=>r.source==='whatsapp_cloud_api'&&r.waQueueState);
 const counts={};for(const row of sample)counts[row.waQueueState]=(counts[row.waQueueState]||0)+1;
 return {ok:true,environmentReady:whatsappAgentAvailable(ctx.env),enabled:integration.autoReplyEnabled===true,sendingEnabled:ctx.env.WHATSAPP_AGENT_SEND==='enabled',claudeConfigured:Boolean(ctx.env.ANTHROPIC_API_KEY&&ctx.env.ANTHROPIC_MODEL),metaTokenConfigured:Boolean(ctx.env.META_WHATSAPP_ACCESS_TOKEN),sampleLimit:300,sampled:sample.length,counts};
}
