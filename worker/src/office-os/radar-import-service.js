import { parseRadarExport, RADAR_LIMITS } from '../../../public/os/domain/radar-import-domain.js';
import { scoutAvailable, loadSettings, loadSchedule, isRunning } from './scout-store.js';
import { consumePublicRateLimit, publicRateLimitKey } from '../public-rate-limit.js';
export function radarImportStatus(ctx) {
  const available = ctx.env.FIREBASE_PROJECT_ID === 'iaqar-ai-staging' && scoutAvailable(ctx.env);
  return {ok:true,available,mode:'MANUAL_FILE',message:available?'استيراد يدوي من تصدير الرادار؛ لا توجد مزامنة تلقائية.':'استيراد الرادار متاح في بيئة التجربة فقط عند تفعيل الباحث.'};
}
export async function importRadarExport(ctx, {officeId,actor,input,includeContacts=false,runCycle}) {
  if (!actor?.isManager) throw ctx.deps.appError('forbidden',403,'استيراد الرادار لمدير المكتب فقط.');
  if (!radarImportStatus(ctx).available) throw ctx.deps.appError('radar_unavailable',503,'استيراد الرادار غير متاح في هذه البيئة.');
  if (new TextEncoder().encode(JSON.stringify(input) || '').length > RADAR_LIMITS.bytes) throw ctx.deps.appError('payload_too_large',413,'ملف الرادار أكبر من الحد المسموح.');
  let parsed;try {parsed=parseRadarExport(input,{includeContacts:includeContacts===true});} catch(e) {throw ctx.deps.appError('radar_invalid',400,e.message);}
  const settings=await loadSettings(ctx,officeId);
  if (!settings.enabled) throw ctx.deps.appError('scout_off',409,'شغّل الباحث عن الفرص لهذا المكتب أولًا.');
  if (!consumePublicRateLimit(publicRateLimitKey({route:'radar-import',ip:actor.uid,officeId}),{limit:60,windowMs:3600000}).ok) throw ctx.deps.appError('rate_limited',429,'عمليات استيراد كثيرة؛ حاول لاحقًا.');
  const report={ok:true,saved:0,updated:0,duplicates:0,processing:'NOT_NEEDED',source:'BROKER_RADAR',reviewStatus:'PENDING_REVIEW'};
  const now=ctx.now();const pending=[];
  for(const item of parsed.items){
    const hash=await ctx.deps.sha256Hex(`${officeId}|BROKER_RADAR|${item.sourceId}`);
    const path=['offices',officeId,'scoutFeed',`sf_radar_${hash.slice(0,28)}`];
    const contentHash=await ctx.deps.sha256Hex(JSON.stringify(item));const old=await ctx.store.get(path);
    if(old?.contentHash===contentHash){report.duplicates++;pending.push(path);continue;}
    const evidence=item.contacts.map(c=>`رقم تواصل (${c.role || 'غير محدد'}): ${c.phone}`).join('\n');
    await ctx.store.set(path,{officeId,text:[item.originalText,evidence].filter(Boolean).join('\n'),channel:'FILE',sourceName:'رادار الوسيط',sourceType:'BROKER_RADAR',sourceListingId:item.sourceId,sourceCapturedAt:item.capturedAt,sourceCityAssumed:item.cityAssumed,contactEvidenceJson:JSON.stringify(item.contacts),structured:JSON.stringify(item.structured),pinned:true,single:true,reviewStatus:'PENDING_REVIEW',contentHash,radarProcessing:'PENDING',createdBy:actor.uid,createdAt:now,updatedAt:now});
    old?report.updated++:report.saved++;pending.push(path);
  }
  if(pending.length){
    report.processing='DEFERRED';
    if(typeof runCycle==='function')try {
      const tasks=(await ctx.store.list(['offices',officeId,'scoutTasks'],100)).filter(isRunning).slice(0,12).map(t=>t.id);
      const schedule=await loadSchedule(ctx);
      const outcome=await runCycle(ctx,officeId,{taskIds:tasks,runtime:schedule.entries[officeId]?.t||{},inline:true,onlySource:'broker_feed',sinceMs:0,now});
      if(outcome?.ok !== false && !outcome?.off && Number(outcome?.stats?.fetched)>0 && !outcome?.stats?.sourceErrors) report.processing='CYCLE_RAN';
    }catch{ /* Stored feed remains pending for the normal scheduled cycle or an explicit retry. */ }
  }
  report.note='وارد من رادار الوسيط قيد المراجعة. لا يصبح عرضًا معتمدًا ولا يُرسل لأحد دون الإجراء المعتاد من الوسيط.';
  return report;
}
