/** Economic test controller. Existing inbox, records, validity and central matching are the only stores/engines. */
import { analyzeListing } from '../../../public/os/domain/smart-fill-domain.js';
import { availabilityIntent } from '../../../public/os/domain/validity-domain.js';
import { saveRecord } from './records-service.js';
import { pairRecords } from './records-service.js';
import { decideMatchReview } from './journey-service.js';
import { searchThroughCentral } from './central-search-service.js';
import { applyAvailabilityAnswer, sweepValidityNow } from './validity-service.js';
import { economicModeFor, economicContext } from './economic-policy.js';
import { writeAudit } from './audit-log.js';

const clean = (v, n=120) => String(v??'').trim().slice(0,n);
function assertPilot(ctx, actor) {
  if (!actor?.isManager || !economicModeFor(ctx.env,ctx.officeId)) throw ctx.deps.appError('economic_test_forbidden',403,'وضع التجارب الاقتصادية متاح لمدير مكتب الاختبار المحدد في Staging فقط');
}
function requireConfirmation(ctx,input) {
  if(input.confirmed!==true) throw ctx.deps.appError('review_required',400,'راجع السجل والحقول وأكدها أولًا');
}
export async function economicTest(ctx,{actor,action,input={}}) {
  assertPilot(ctx,actor); ctx=economicContext(ctx);
  const officeId=ctx.officeId;
  const result = data => ({ok:true,mode:'ECONOMIC_TEST',provider:'RULES',modelSimulated:false,sendingEnabled:false,messagesSent:0,providerCalls:0,...data});
  if(action==='status') {
    const messages=(await ctx.store.list(['offices',officeId,'inbox'],300)).filter(r=>r.economicTest===true);
    return result({enabled:true,messages,scope:officeId,coexistence:'COEXISTENCE_UNCONFIRMED'});
  }
  if(action==='ingest') {
    const text=clean(input.text,4000),key=clean(input.messageKey,100);
    if(!text||!key)throw ctx.deps.appError('message_required',400,'اكتب الرسالة وحدد معرفها التجريبي');
    const id=`econ_${(await ctx.deps.sha256Hex(`${officeId}|${actor.uid}|${key}`)).slice(0,32)}`;
    const analysis=analyzeListing(text),intent=availabilityIntent(text)||'';
    const created=await ctx.store.create(['offices',officeId,'inbox',id],{officeId,source:'economic_test_simulation',channel:'economic_test',economicTest:true,economicSimulation:true,messageText:text,messageId:key,receivedAt:ctx.now(),createdAt:ctx.now(),senderName:'مرسل تجريبي',direction:'inbound',status:'pending_review',isProcessed:false,economicAnalysis:analysis,economicAvailabilityIntent:intent,createdBy:actor.uid});
    const saved=await ctx.store.get(['offices',officeId,'inbox',id]);
    return result({inboxId:id,duplicate:!created,analysis:saved.economicAnalysis,availabilityIntent:saved.economicAvailabilityIntent});
  }
  if(action==='save') {
    requireConfirmation(ctx,input);
    const inboxId=clean(input.inboxId),p=['offices',officeId,'inbox',inboxId],message=await ctx.store.get(p);
    if(!message||message.officeId!==officeId||message.economicTest!==true)throw ctx.deps.appError('message_not_found',404,'الرسالة غير موجودة في مكتب الاختبار');
    const a=message.economicAnalysis;
    if(!a||message.economicAvailabilityIntent)throw ctx.deps.appError('record_review_required',400,'الرسالة تحتاج مراجعة بشرية ولا تنشئ عرضًا جديدًا');
    // Only the server's extracted fields + explicitly reviewed contact identity. No model-authored tool arguments.
    const record={kind:a.kind,purpose:a.purpose,propertyType:a.propertyType,city:a.city,district:a.districts?.[0]||'',price:a.price,area:a.area,rooms:a.rooms,
      contactName:clean(input.contactName,80),contactPhone:clean(input.contactPhone,20),advertiserRole:a.kind==='OFFER'?'OWNER':'CLIENT',
      notes:'سجل تجربة اقتصادية — مصدره رسالة محاكاة، راجعه مدير المكتب',intakeOrigin:{channel:'OTHER',role:'OWNER',method:'SMART_FILL',originalText:message.messageText}};
    const saved=await saveRecord(ctx,{actor,officeId,input:record,requestKey:`economic:${inboxId}`});
    const existing=await ctx.store.get(['offices',officeId,'opportunities',saved.recordId]);
    if(saved.duplicate&&existing?.economicTest!==true)return result({...saved,existingRecord:true});
    await ctx.store.set(['offices',officeId,'opportunities',saved.recordId],{economicTest:true,economicSimulation:message.economicSimulation===true,economicSourceInboxId:inboxId,sourceReceivedAt:message.receivedAt,reviewedBy:actor.uid,reviewedAt:ctx.now(),publicSearchVisible:false});
    await ctx.store.set(p,{economicRecordId:saved.recordId,isProcessed:true,status:'processed',processingState:'processed'});
    await ctx.store.create(['offices',officeId,'contacts',record.contactPhone.replace(/\D/g,'').replace(/^0/,'966')],{officeId,name:record.contactName,phone:record.contactPhone,economicTest:true,source:'economic_test_review',createdAt:ctx.now()});
    return result(saved);
  }
  if(action==='search') return result(await searchThroughCentral(ctx,{actor,recordId:clean(input.recordId),limit:3}));
  if(action==='pair') {
    const requestId=clean(input.recordId),offerId=clean(input.counterpartId);
    const [request,offer]=await Promise.all([
      ctx.store.get(['offices',officeId,'opportunities',requestId]),
      ctx.store.get(['offices',officeId,'opportunities',offerId])
    ]);
    if(!request||!offer||request.officeId!==officeId||offer.officeId!==officeId)throw ctx.deps.appError('record_not_found',404,'العقار غير موجود في مكتبك');
    if(request.economicTest!==true&&offer.economicTest!==true)throw ctx.deps.appError('test_record_required',403,'يمكن بدء المسار من سجل تجريبي فقط');
    if(String(request.opportunityKind||request.kind).toUpperCase()!=='REQUEST'||String(offer.opportunityKind||offer.kind).toUpperCase()!=='OFFER')throw ctx.deps.appError('pair_role_invalid',400,'اختر طلب عميل وعرضًا عقاريًا');
    const paired=await pairRecords(ctx,{officeId,recordId:requestId,counterpartId:offerId});
    if(paired.matchId){
      await ctx.store.set(['offices',officeId,'matches',paired.matchId],{economicTest:true,economicSimulation:true,economicRequestId:requestId,economicOfferId:offerId});
      await writeAudit(ctx,{officeId,actorUid:actor.uid,action:'ECONOMIC_MATCH_STARTED',entityType:'match',entityId:paired.matchId,key:'create',details:{requestId,offerId}});
    }
    return result(paired);
  }
  if(action==='approve') {
    const matchId=clean(input.matchId),match=await ctx.store.get(['offices',officeId,'matches',matchId]);
    if(!match||match.officeId!==officeId||match.economicTest!==true)throw ctx.deps.appError('match_not_found',404,'المطابقة التجريبية غير موجودة');
    requireConfirmation(ctx,input);
    const approved=await decideMatchReview(ctx,{actor,officeId,matchId,decision:'approve'});
    if(approved.journeyId){
      await ctx.store.set(['offices',officeId,'journeys',approved.journeyId],{economicTest:true,economicSimulation:true,economicMatchId:matchId});
      await writeAudit(ctx,{officeId,actorUid:actor.uid,action:'ECONOMIC_JOURNEY_APPROVED',entityType:'journey',entityId:approved.journeyId,key:'approve',details:{matchId}});
    }
    return result(approved);
  }
  if(action==='availability') {
    requireConfirmation(ctx,input);
    const recordId=clean(input.recordId),record=await ctx.store.get(['offices',officeId,'opportunities',recordId]);
    if(!record||record.officeId!==officeId)throw ctx.deps.appError('record_not_found',404,'السجل غير موجود في مكتبك');
    // The panel only mutates marked test inventory; ordinary records keep their existing review screens.
    if(record.economicTest!==true)throw ctx.deps.appError('test_record_required',403,'تحديث الحالة هنا للسجلات التجريبية فقط');
    const answer=clean(input.answer).toUpperCase();
    if(!['AVAILABLE','SOLD','RENTED','FOUND','PAUSE','STILL_LOOKING'].includes(answer))throw ctx.deps.appError('answer_invalid',400,'اختر حالة معروفة');
    const changed=await applyAvailabilityAnswer(ctx,{actor,officeId,recordId,answer});
    await writeAudit(ctx,{officeId,actorUid:actor.uid,action:'ECONOMIC_AVAILABILITY_REVIEWED',entityType:'record',entityId:recordId,key:`${answer}|${ctx.now().toISOString()}`});
    return result(changed);
  }
  if(action==='sweep')return result(await sweepValidityNow(ctx,{actor,officeId}));
  throw ctx.deps.appError('not_found',404,'الإجراء غير موجود');
}
