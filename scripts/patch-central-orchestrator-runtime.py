from pathlib import Path


def require_replace(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old, new, 1)

# ---- canonical intake ----
p = Path("worker/src/canonical-intake-service.js")
s = p.read_text()
if 'from "./central-orchestrator-service.js"' not in s:
    first_import = s.index("import {")
    imports = '''import { ORCHESTRATOR_EVENT, ORCHESTRATOR_OWNER } from "./central-orchestrator-domain.js";\nimport { buildOrchestratorEventId, dispatchOrchestratorEvent } from "./central-orchestrator-service.js";\n'''
    s = s[:first_import] + imports + s[first_import:]

pending_return = '''  return {\n    ok: true,\n    duplicate: false,\n    officeId,\n    opportunityId,\n    importJobId,\n    analysisStatus: ANALYSIS_STATUS.PENDING,'''
if "ORCHESTRATOR_EVENT.INTAKE_PERSISTED" not in s:
    intake_dispatch = '''  const intakeOrchestration = await dispatchOrchestratorEvent({\n    event: ORCHESTRATOR_EVENT.INTAKE_PERSISTED,\n    eventId: buildOrchestratorEventId({\n      event: ORCHESTRATOR_EVENT.INTAKE_PERSISTED, officeId, entityId: opportunityId, occurrenceId: importJobId\n    }),\n    context: { officeId, entityId: opportunityId, importJobId, sourceChannel },\n    deferredTargets: [ORCHESTRATOR_OWNER.COMPLETION]\n  });\n  if (!intakeOrchestration.ok) {\n    throw ctx.appError("orchestrator_dispatch_failed", 500, `فشل تنسيق الإدخال: ${intakeOrchestration.error || "unknown"}`);\n  }\n\n'''
    s = require_replace(s, pending_return, intake_dispatch + pending_return, "canonical pending return")

shadow = '''  if (typeof ctx.observeOpportunityCoverageShadow === "function") {\n    await ctx.observeOpportunityCoverageShadow({\n      officeId,\n      opportunityId,\n      source: "canonical_intake_complete"\n    });\n  }\n'''
if "ORCHESTRATOR_EVENT.OPPORTUNITY_COMPLETED" not in s:
    complete_dispatch = '''\n  const completionOrchestration = await dispatchOrchestratorEvent({\n    event: ORCHESTRATOR_EVENT.OPPORTUNITY_COMPLETED,\n    eventId: buildOrchestratorEventId({\n      event: ORCHESTRATOR_EVENT.OPPORTUNITY_COMPLETED, officeId, entityId: opportunityId, occurrenceId: importJobId\n    }),\n    context: { officeId, entityId: opportunityId, importJobId, matchingReadiness },\n    deferredTargets: [ORCHESTRATOR_OWNER.MATCHING]\n  });\n  if (!completionOrchestration.ok) {\n    throw ctx.appError("orchestrator_dispatch_failed", 500, `فشل تنسيق اكتمال الفرصة: ${completionOrchestration.error || "unknown"}`);\n  }\n'''
    s = require_replace(s, shadow, shadow + complete_dispatch, "canonical completion shadow")
p.write_text(s)

# ---- party coordination/viewing ----
p = Path("worker/src/party-session-service.js")
s = p.read_text()
if 'from "./central-orchestrator-service.js"' not in s:
    first_import = s.index("import {")
    imports = '''import { ORCHESTRATOR_EVENT, ORCHESTRATOR_OWNER } from "./central-orchestrator-domain.js";\nimport { buildOrchestratorEventId, dispatchOrchestratorEvent } from "./central-orchestrator-service.js";\n'''
    s = s[:first_import] + imports + s[first_import:]

# Insert coordination event before the final response of handlePartySessionBundle.
if "ORCHESTRATOR_EVENT.COORDINATION_UPDATED" not in s:
    start = s.index("export async function handlePartySessionBundle")
    end = s.index("export async function", start + 10)
    section = s[start:end]
    pos = section.rfind("  return helpers.jsonResponse({")
    if pos < 0:
        raise SystemExit("missing coordination final response")
    absolute = start + pos
    block = '''  const coordinationOrchestration = await dispatchOrchestratorEvent({\n    event: ORCHESTRATOR_EVENT.COORDINATION_UPDATED,\n    eventId: buildOrchestratorEventId({\n      event: ORCHESTRATOR_EVENT.COORDINATION_UPDATED,\n      officeId: loaded.officeId,\n      entityId: matchId,\n      occurrenceId: `${party}:${coordinationSession.outcome || "updated"}`\n    }),\n    context: { officeId: loaded.officeId, entityId: matchId, party, outcome: coordinationSession.outcome || "" },\n    adapters: {\n      [ORCHESTRATOR_OWNER.TASKS]: async () => ({ ok: Boolean(coordinationSession) })\n    },\n    deferredTargets: [ORCHESTRATOR_OWNER.VIEWING]\n  });\n  if (!coordinationOrchestration.ok) {\n    throw helpers.appError("orchestrator_dispatch_failed", 500, `فشل تنسيق التفاوض: ${coordinationOrchestration.error || "unknown"}`);\n  }\n\n'''
    s = s[:absolute] + block + s[absolute:]

if "ORCHESTRATOR_EVENT.VIEWING_CONFIRMED" not in s:
    branch_start = s.index('  if (action === "CONFIRM_VIEWING") {')
    next_branch = s.find('\n  if (action === ', branch_start + 10)
    if next_branch < 0:
        next_branch = s.index('\n  return helpers.jsonResponse', branch_start + 10)
    section = s[branch_start:next_branch]
    marker = '''    return helpers.jsonResponse({\n      ok: true,\n      idempotent: false,\n      livingStage: LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED,'''
    pos = section.rfind(marker)
    if pos < 0:
        raise SystemExit("missing viewing success response")
    absolute = branch_start + pos
    block = '''    const viewingOrchestration = await dispatchOrchestratorEvent({\n      event: ORCHESTRATOR_EVENT.VIEWING_CONFIRMED,\n      eventId: buildOrchestratorEventId({\n        event: ORCHESTRATOR_EVENT.VIEWING_CONFIRMED, officeId, entityId: matchId, occurrenceId: confirmation.appointmentAt\n      }),\n      context: { officeId, entityId: matchId, appointmentAt: confirmation.appointmentAt },\n      adapters: {\n        [ORCHESTRATOR_OWNER.TASKS]: async () => ({ ok: true })\n      }\n    });\n    if (!viewingOrchestration.ok) {\n      throw helpers.appError("orchestrator_dispatch_failed", 500, `فشل تنسيق المعاينة: ${viewingOrchestration.error || "unknown"}`);\n    }\n\n'''
    s = s[:absolute] + block + s[absolute:]
p.write_text(s)

# ---- central worker runtime ----
p = Path("worker/src/index.js")
s = p.read_text()
if 'from "./central-orchestrator-service.js"' not in s:
    first_import = s.index("import {")
    imports = '''import { ORCHESTRATOR_EVENT, ORCHESTRATOR_OWNER } from "./central-orchestrator-domain.js";\nimport { buildOrchestratorEventId, dispatchOrchestratorEvent } from "./central-orchestrator-service.js";\n'''
    s = s[:first_import] + imports + s[first_import:]

if "async function runRuntimeOrchestration" not in s:
    anchor = 'const ESTIMATED_WRITES_PER_MESSAGE = 8;\n'
    helper = '''\nasync function runRuntimeOrchestration({ event, officeId, entityId, occurrenceId = "", context = {}, adapters = {}, deferredTargets = [] }) {\n  const eventId = buildOrchestratorEventId({ event, officeId, entityId, occurrenceId });\n  const result = await dispatchOrchestratorEvent({\n    event, eventId, context: { ...context, officeId, entityId }, adapters, deferredTargets\n  });\n  if (!result.ok) {\n    throw appError("orchestrator_dispatch_failed", 500, `فشل تنسيق الحدث ${event}: ${result.error || "unknown"}`);\n  }\n  return result;\n}\n'''
    s = require_replace(s, anchor, anchor + helper, "index orchestrator helper")

# Deal create: make task projection an orchestrated side effect.
old = '''  await observeDealCoverageShadow({\n    projectId, officeId, dealId, accessToken, source: "deal_created"\n  });\n  return dealId;'''
if "ORCHESTRATOR_EVENT.DEAL_CREATED" not in s:
    new = '''  await runRuntimeOrchestration({\n    event: ORCHESTRATOR_EVENT.DEAL_CREATED,\n    officeId, entityId: dealId, occurrenceId: "created",\n    context: { projectId, dealId },\n    adapters: {\n      [ORCHESTRATOR_OWNER.TASKS]: async () => {\n        await observeDealCoverageShadow({ projectId, officeId, dealId, accessToken, source: "deal_created" });\n        return { ok: true };\n      }\n    }\n  });\n  return dealId;'''
    s = require_replace(s, old, new, "deal created orchestration")

old = '    await observeDealCoverageShadow({ projectId, officeId, dealId: recordId, accessToken, source: "deal_stage_changed" });\n    return jsonResponse({ok:true,status:"open",workflowStage:requested,'
if "ORCHESTRATOR_EVENT.DEAL_STAGE_CHANGED" not in s:
    new = '''    await runRuntimeOrchestration({\n      event: ORCHESTRATOR_EVENT.DEAL_STAGE_CHANGED,\n      officeId, entityId: recordId, occurrenceId: requested,\n      context: { projectId, dealId: recordId, workflowStage: requested },\n      adapters: {\n        [ORCHESTRATOR_OWNER.TASKS]: async () => {\n          await observeDealCoverageShadow({ projectId, officeId, dealId: recordId, accessToken, source: "deal_stage_changed" });\n          return { ok: true };\n        }\n      }\n    });\n    return jsonResponse({ok:true,status:"open",workflowStage:requested,'''
    s = require_replace(s, old, new, "deal stage orchestration")

# Match creation: verify the just-created Operation projection and explicitly defer negotiation until party action.
if "ORCHESTRATOR_EVENT.MATCH_CREATED" not in s:
    marker = '    const bundle = await createMatchReviewBundle({'
    start = s.index(marker)
    close = s.index('\n    });', start) + len('\n    });')
    block = '''\n    await runRuntimeOrchestration({\n      event: ORCHESTRATOR_EVENT.MATCH_CREATED,\n      officeId, entityId: matchId, occurrenceId: "created",\n      context: { projectId, matchId, operationCreated: Boolean(bundle) },\n      adapters: {\n        [ORCHESTRATOR_OWNER.TASKS]: async () => ({ ok: Boolean(bundle), error: bundle ? "" : "match_operation_missing" })\n      },\n      deferredTargets: [ORCHESTRATOR_OWNER.NEGOTIATION]\n    });'''
    s = s[:close] + block + s[close:]

# Cooperation lifecycle: route the successful lifecycle result through the central boundary.
if "ORCHESTRATOR_EVENT.COOPERATION_UPDATED" not in s:
    start = s.index("async function handleCooperationLifecycle")
    end = s.index("async function handleCooperationScopeRevoke", start)
    section = s[start:end]
    pos = section.rfind("  return jsonResponse({")
    if pos < 0:
        raise SystemExit("missing cooperation lifecycle response")
    absolute = start + pos
    block = '''  await runRuntimeOrchestration({\n    event: ORCHESTRATOR_EVENT.COOPERATION_UPDATED,\n    officeId, entityId: cooperationId, occurrenceId: action || "updated",\n    context: { projectId, cooperationId, action },\n    adapters: {\n      [ORCHESTRATOR_OWNER.TASKS]: async () => ({ ok: Boolean(result) })\n    }\n  });\n\n'''
    s = s[:absolute] + block + s[absolute:]

p.write_text(s)
