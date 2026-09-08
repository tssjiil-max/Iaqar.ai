#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(file, before, after, label = before.slice(0, 60)) {
  const source = readFileSync(file, "utf8");
  const count = source.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${file}: expected exactly one match for ${label}, found ${count}`);
  }
  writeFileSync(file, source.replace(before, after));
  console.log(`[patched] ${file} :: ${label}`);
}

// 1) Canonical viewing domain: a confirmed appointment is not a completed viewing.
replaceOnce(
  "public/js/viewing-domain.js",
  '  CONFIRMED: "CONFIRMED",\n  CONFLICT: "CONFLICT"',
  '  CONFIRMED: "CONFIRMED",\n  COMPLETED: "COMPLETED",\n  CONFLICT: "CONFLICT"',
  "VIEWING_STATE.COMPLETED"
);
replaceOnce(
  "public/js/viewing-domain.js",
  'export function resolveViewingState(match = {}) {\n  const status = upper(match.appointmentStatus || match.viewingAppointmentStatus);\n  const confirmedAt = canonicalConfirmedAppointmentAt(match);\n  if (confirmedAt) {',
  'export function resolveViewingState(match = {}) {\n  const status = upper(match.appointmentStatus || match.viewingAppointmentStatus);\n  const completedAt = text(match.viewingCompletedAt);\n  const confirmedAt = canonicalConfirmedAppointmentAt(match);\n  if (completedAt) {\n    return {\n      state: VIEWING_STATE.COMPLETED,\n      candidateAt: canonicalViewingCandidateAt(match) || confirmedAt,\n      appointmentAt: confirmedAt || text(match.appointmentAt || match.viewingAt),\n      completedAt,\n      terminal: true\n    };\n  }\n  if (confirmedAt) {',
  "resolve completed viewing before confirmed"
);
replaceOnce(
  "public/js/viewing-domain.js",
  'export function viewingBoundaryGuarantees() {\n  return {',
  `/**\n * Complete the viewing only after a broker-confirmed appointment has started.\n * Completion never creates a Deal; it only records Match-owned viewing state.\n */\nexport function planViewingCompletion({ match = {}, now = new Date() } = {}) {\n  const existing = text(match.viewingCompletedAt);\n  const appointmentAt = canonicalConfirmedAppointmentAt(match);\n  if (existing) {\n    return { ok: true, idempotent: true, appointmentAt, completedAt: existing, patch: null };\n  }\n  if (!appointmentAt) {\n    return { ok: false, error: "viewing_not_confirmed" };\n  }\n  const appointmentMs = new Date(appointmentAt).getTime();\n  const current = now instanceof Date ? now : new Date(now);\n  const currentMs = current.getTime();\n  if (!Number.isFinite(appointmentMs) || !Number.isFinite(currentMs)) {\n    return { ok: false, error: "viewing_time_invalid" };\n  }\n  if (appointmentMs > currentMs) {\n    return { ok: false, error: "viewing_not_started_yet", appointmentAt };\n  }\n  const completedAt = current.toISOString();\n  return {\n    ok: true,\n    idempotent: false,\n    appointmentAt,\n    completedAt,\n    patch: {\n      viewingCompletedAt: completedAt,\n      viewingOutcome: "",\n      seriousIntentConfirmed: false\n    }\n  };\n}\n\nexport function viewingBoundaryGuarantees() {\n  return {`,
  "planViewingCompletion"
);
replaceOnce(
  "public/js/viewing-domain.js",
  '    confirmedField: "appointmentAt",\n    statusField: "appointmentStatus",',
  '    confirmedField: "appointmentAt",\n    completedField: "viewingCompletedAt",\n    statusField: "appointmentStatus",',
  "viewing completed boundary field"
);

// 2) Living match stage + broker copy.
replaceOnce(
  "public/js/match-group-domain.js",
  '  APPOINTMENT_CONFIRMED: "APPOINTMENT_CONFIRMED",\n  FOLLOW_UP: "FOLLOW_UP",',
  '  APPOINTMENT_CONFIRMED: "APPOINTMENT_CONFIRMED",\n  VIEWING_COMPLETED: "VIEWING_COMPLETED",\n  FOLLOW_UP: "FOLLOW_UP",',
  "LIVING_TASK_STAGE.VIEWING_COMPLETED"
);
replaceOnce(
  "public/js/match-group-domain.js",
  '  if (key === LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED) return "موعد مؤكد";\n  if (key === LIVING_TASK_STAGE.FOLLOW_UP) return "قيد المتابعة";',
  '  if (key === LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED) return "موعد مؤكد";\n  if (key === LIVING_TASK_STAGE.VIEWING_COMPLETED) return "تمت المعاينة";\n  if (key === LIVING_TASK_STAGE.FOLLOW_UP) return "قيد المتابعة";',
  "living status viewing completed"
);
replaceOnce(
  "public/js/match-group-domain.js",
  '    || key === LIVING_TASK_STAGE.CLIENT_NEEDS_MISSING_INFO\n    || key === LIVING_TASK_STAGE.FOLLOW_UP\n  ) {',
  '    || key === LIVING_TASK_STAGE.CLIENT_NEEDS_MISSING_INFO\n    || key === LIVING_TASK_STAGE.VIEWING_COMPLETED\n    || key === LIVING_TASK_STAGE.FOLLOW_UP\n  ) {',
  "viewing completed needs broker action"
);
replaceOnce(
  "public/js/match-group-domain.js",
  'export function livingCopy(stage, {\n  missingInfoKey = "",\n  hasNextCandidate = false,\n  appointmentLine = "",\n  ownerContactNeeded = false\n} = {}) {',
  'export function livingCopy(stage, {\n  missingInfoKey = "",\n  hasNextCandidate = false,\n  appointmentLine = "",\n  ownerContactNeeded = false,\n  viewingOutcome = ""\n} = {}) {',
  "livingCopy viewingOutcome"
);
replaceOnce(
  "public/js/match-group-domain.js",
  `  if (key === LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED) {\n    return {\n      kindLabel: appointmentLine ? \`الموعد مؤكد — \${appointmentLine}\` : "الموعد مؤكد",\n      statusLabel: "",\n      happenedLine: appointmentLine ? \`تم تأكيد المعاينة — \${appointmentLine}\` : "تم تأكيد المعاينة",\n      turnLine: "",\n      yourTurnLine: appointmentLine || "الموعد مؤكد",\n      nextActionLine: "لا يوجد إجراء مطلوب منك الآن.",\n      waiting: true,\n      ...reveal\n    };\n  }\n  if (key === LIVING_TASK_STAGE.FOLLOW_UP) {`,
  `  if (key === LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED) {\n    return {\n      kindLabel: appointmentLine ? \`الموعد مؤكد — \${appointmentLine}\` : "الموعد مؤكد",\n      statusLabel: "موعد مؤكد",\n      happenedLine: appointmentLine ? \`تم تأكيد المعاينة — \${appointmentLine}\` : "تم تأكيد المعاينة",\n      turnLine: "دورك الآن",\n      yourTurnLine: "بعد انتهاء المعاينة",\n      nextActionLine: "تأكيد أن المعاينة تمت",\n      waiting: false,\n      ...reveal\n    };\n  }\n  if (key === LIVING_TASK_STAGE.VIEWING_COMPLETED) {\n    const outcome = upper(viewingOutcome);\n    if (outcome === "SERIOUS") {\n      return {\n        kindLabel: "المعاينة تمت",\n        statusLabel: "جدية مؤكدة",\n        happenedLine: "تمت المعاينة وتم تأكيد الجدية",\n        turnLine: "دورك الآن",\n        yourTurnLine: "إنشاء الصفقة",\n        nextActionLine: "إنشاء الصفقة والانتقال للتفاوض",\n        waiting: false,\n        ...reveal\n      };\n    }\n    if (outcome === "FOLLOW_UP") {\n      return {\n        kindLabel: "المعاينة تمت",\n        statusLabel: "متابعة لاحقًا",\n        happenedLine: "تمت المعاينة",\n        turnLine: "",\n        yourTurnLine: "متابعة لاحقًا",\n        nextActionLine: "تم تسجيل قرار المتابعة.",\n        waiting: true,\n        ...reveal\n      };\n    }\n    if (outcome === "NOT_SERIOUS") {\n      return {\n        kindLabel: "المعاينة تمت",\n        statusLabel: "لا توجد جدية حاليًا",\n        happenedLine: "تمت المعاينة ولم تتحول إلى جدية",\n        turnLine: "",\n        yourTurnLine: "لا توجد صفقة ناشئة",\n        nextActionLine: "لن تُنشأ صفقة من هذه المعاينة.",\n        waiting: true,\n        ...reveal\n      };\n    }\n    return {\n      kindLabel: "المعاينة تمت",\n      statusLabel: "بانتظار تقييم الجدية",\n      happenedLine: "تمت المعاينة",\n      turnLine: "دورك الآن",\n      yourTurnLine: "قيّم جدية العميل",\n      nextActionLine: "اختر نتيجة المعاينة",\n      waiting: false,\n      ...reveal\n    };\n  }\n  if (key === LIVING_TASK_STAGE.FOLLOW_UP) {`,
  "living copy appointment -> completion -> seriousness"
);

// 3) Post-match domain: confirmed appointment alone cannot create a Deal.
replaceOnce(
  "worker/src/post-match-chain-domain.js",
  '  VIEWING_CONFIRMED: "VIEWING_CONFIRMED",\n  DEAL_CONTACT: "DEAL_CONTACT",',
  '  VIEWING_CONFIRMED: "VIEWING_CONFIRMED",\n  VIEWING_COMPLETED: "VIEWING_COMPLETED",\n  DEAL_CONTACT: "DEAL_CONTACT",',
  "POST_MATCH_STAGE.VIEWING_COMPLETED"
);
replaceOnce(
  "worker/src/post-match-chain-domain.js",
  '  const appointmentStatus = upper(match.appointmentStatus);\n  if (appointmentStatus === "CONFIRMED" || text(match.viewingAt) || text(match.appointmentAt)) {',
  '  const livingStage = upper(match.livingStage);\n  if (text(match.viewingCompletedAt) || livingStage === POST_MATCH_STAGE.VIEWING_COMPLETED) {\n    return POST_MATCH_STAGE.VIEWING_COMPLETED;\n  }\n  const appointmentStatus = upper(match.appointmentStatus);\n  if (appointmentStatus === "CONFIRMED" || text(match.viewingAt) || text(match.appointmentAt)) {',
  "resolve viewing completed before confirmed"
);
replaceOnce(
  "worker/src/post-match-chain-domain.js",
  '  const livingStage = upper(match.livingStage);\n  if (livingStage.includes("NEGOTIATION") || livingStage.includes("COORDINATION")) {',
  '  if (livingStage.includes("NEGOTIATION") || livingStage.includes("COORDINATION")) {',
  "reuse livingStage"
);
replaceOnce(
  "worker/src/post-match-chain-domain.js",
  `export function canCreateDeal({ match = {}, coordination = {} } = {}) {\n  const outcome = upper(coordination.outcome || match.coordinationOutcome);\n  const stage = resolvePostMatchStage({ match, coordination });\n  const serious = [\n    "VIEWING_READY",\n    "NEGOTIATION_READY",\n    "AGREEMENT_READY",\n    "BOTH_INTERESTED",\n    "PRICE_ALIGNED"\n  ].includes(outcome);\n  const viewingConfirmed = stage === POST_MATCH_STAGE.VIEWING_CONFIRMED;\n  return {\n    allowed: serious || viewingConfirmed,\n    reason: viewingConfirmed ? "viewing_confirmed" : serious ? "serious_coordination" : "not_serious_yet"\n  };\n}`,
  `export function canCreateDeal({ match = {}, coordination = {} } = {}) {\n  const outcome = upper(coordination.outcome || match.coordinationOutcome);\n  const stage = resolvePostMatchStage({ match, coordination });\n  const seriousCoordination = [\n    "NEGOTIATION_READY",\n    "AGREEMENT_READY",\n    "BOTH_INTERESTED",\n    "PRICE_ALIGNED"\n  ].includes(outcome);\n  const seriousIntent = match.seriousIntentConfirmed === true || upper(match.seriousIntentConfirmed) === "TRUE";\n  const completedViewingSerious = stage === POST_MATCH_STAGE.VIEWING_COMPLETED && seriousIntent;\n  return {\n    allowed: seriousCoordination || completedViewingSerious,\n    reason: completedViewingSerious\n      ? "viewing_completed_serious"\n      : seriousCoordination\n        ? "serious_coordination"\n        : "not_serious_yet"\n  };\n}`,
  "deal creation seriousness gate"
);
replaceOnce(
  "worker/src/post-match-chain-domain.js",
  '  VIEWING_CONFIRMED: "VIEWING_CONFIRMED",\n  DEAL_CREATED: "DEAL_CREATED",',
  '  VIEWING_CONFIRMED: "VIEWING_CONFIRMED",\n  VIEWING_COMPLETED: "VIEWING_COMPLETED",\n  DEAL_CREATED: "DEAL_CREATED",',
  "POST_MATCH_EVENT.VIEWING_COMPLETED"
);
replaceOnce(
  "worker/src/post-match-chain-domain.js",
  '  if (type === POST_MATCH_EVENT.DEAL_CREATED) {',
  `  if (type === POST_MATCH_EVENT.VIEWING_COMPLETED) {\n    if (!text(payload.completedAt || match.viewingCompletedAt)) {\n      return { ok: false, reason: "viewing_completion_required", writes: [] };\n    }\n    return {\n      ok: true,\n      writes: [\n        { target: POST_MATCH_SOURCE_OF_TRUTH.VIEWING, mode: "authoritative" },\n        { target: POST_MATCH_SOURCE_OF_TRUTH.TASKS, mode: "projection" }\n      ],\n      createsDeal: false,\n      sendsMessage: false\n    };\n  }\n\n  if (type === POST_MATCH_EVENT.DEAL_CREATED) {`,
  "post-match viewing completion transition"
);
replaceOnce(
  "worker/src/post-match-chain-domain.js",
  '    viewingConfirmationAutoCreatesDeal: false,\n    autoSendsWhatsApp: false,',
  '    viewingConfirmationAutoCreatesDeal: false,\n    viewingCompletionAutoCreatesDeal: false,\n    autoSendsWhatsApp: false,',
  "completion does not auto create deal"
);

// 4) Central orchestrator knows completion as a deterministic Match event.
replaceOnce(
  "worker/src/central-orchestrator-domain.js",
  '  VIEWING_CONFIRMED: "VIEWING_CONFIRMED",\n  DEAL_CREATED: "DEAL_CREATED",',
  '  VIEWING_CONFIRMED: "VIEWING_CONFIRMED",\n  VIEWING_COMPLETED: "VIEWING_COMPLETED",\n  DEAL_CREATED: "DEAL_CREATED",',
  "orchestrator VIEWING_COMPLETED event"
);
replaceOnce(
  "worker/src/central-orchestrator-domain.js",
  '    case ORCHESTRATOR_EVENT.VIEWING_CONFIRMED:\n      return { owner: ORCHESTRATOR_OWNER.VIEWING, next: [ORCHESTRATOR_OWNER.TASKS] };',
  '    case ORCHESTRATOR_EVENT.VIEWING_CONFIRMED:\n    case ORCHESTRATOR_EVENT.VIEWING_COMPLETED:\n      return { owner: ORCHESTRATOR_OWNER.VIEWING, next: [ORCHESTRATOR_OWNER.TASKS] };',
  "orchestrator route viewing completion"
);

// 5) Match living endpoint: complete viewing, assess seriousness, ban legacy direct deal completion.
replaceOnce(
  "worker/src/party-session-service.js",
  '  canonicalViewingCandidateAt,\n  planViewingConfirmation\n} from "../../public/js/viewing-domain.js";',
  '  canonicalViewingCandidateAt,\n  planViewingConfirmation,\n  planViewingCompletion\n} from "../../public/js/viewing-domain.js";',
  "import planViewingCompletion"
);
replaceOnce(
  "worker/src/party-session-service.js",
  '  if (patch.appointmentStatus) fields.appointmentStatus = helpers.firestoreString(String(patch.appointmentStatus));\n  await helpers.setFirestoreDocument({',
  '  if (patch.appointmentStatus) fields.appointmentStatus = helpers.firestoreString(String(patch.appointmentStatus));\n  if (Object.prototype.hasOwnProperty.call(patch, "viewingCompletedAt")) fields.viewingCompletedAt = helpers.firestoreString(String(patch.viewingCompletedAt || ""));\n  if (Object.prototype.hasOwnProperty.call(patch, "viewingOutcome")) fields.viewingOutcome = helpers.firestoreString(String(patch.viewingOutcome || ""));\n  if (Object.prototype.hasOwnProperty.call(patch, "seriousIntentConfirmed")) fields.seriousIntentConfirmed = helpers.firestoreString(patch.seriousIntentConfirmed ? "true" : "");\n  await helpers.setFirestoreDocument({',
  "persist completion fields on Match"
);
replaceOnce(
  "worker/src/party-session-service.js",
  '      ...(coordinationOwnerSummary ? { coordinationOwnerSummary: helpers.firestoreString(coordinationOwnerSummary) } : {})\n    }\n  });',
  '      ...(coordinationOwnerSummary ? { coordinationOwnerSummary: helpers.firestoreString(coordinationOwnerSummary) } : {}),\n      ...(Object.prototype.hasOwnProperty.call(patch, "viewingCompletedAt") ? { viewingCompletedAt: helpers.firestoreString(String(patch.viewingCompletedAt || "")) } : {}),\n      ...(Object.prototype.hasOwnProperty.call(patch, "viewingOutcome") ? { viewingOutcome: helpers.firestoreString(String(patch.viewingOutcome || "")) } : {}),\n      ...(Object.prototype.hasOwnProperty.call(patch, "seriousIntentConfirmed") ? { seriousIntentConfirmed: helpers.firestoreString(patch.seriousIntentConfirmed ? "true" : "") } : {})\n    }\n  });',
  "project completion fields to operation"
);
replaceOnce(
  "worker/src/party-session-service.js",
  `  if (action !== "CONFIRM_COMPLETION") {\n    throw helpers.appError("unknown_action", 400, "إجراء غير معروف.");\n  }\n  await stampMatchLiving(helpers, {\n    projectId,\n    officeId,\n    matchId,\n    accessToken,\n    patch: {\n      livingStage: "COMPLETED",\n      activeMatchId: matchId,\n      ownerContactNeeded: false,\n      hasNewResponse: false,\n      nextActor: "NONE",\n      timelineEvent: {\n        type: "deal_completed",\n        actor: "BROKER",\n        label: "تم إتمام الصفقة"\n      }\n    }\n  });\n  return helpers.jsonResponse({ ok: true, livingStage: "COMPLETED", requestId });`,
  `  if (action === "CONFIRM_VIEWING_COMPLETED") {\n    const match = await readOfficeDoc(helpers, {\n      projectId, officeId, collection: "matches", id: matchId, accessToken\n    });\n    if (!match) throw helpers.appError("match_not_found", 404, "المطابقة غير موجودة.");\n    const completion = planViewingCompletion({ match, now: new Date() });\n    if (!completion.ok) {\n      if (completion.error === "viewing_not_confirmed") {\n        throw helpers.appError("viewing_not_confirmed", 409, "يجب تأكيد موعد المعاينة أولًا.");\n      }\n      if (completion.error === "viewing_not_started_yet") {\n        throw helpers.appError("viewing_not_started_yet", 409, "لا يمكن تسجيل إتمام المعاينة قبل موعدها.");\n      }\n      throw helpers.appError("viewing_completion_invalid", 400, "تعذر تسجيل إتمام المعاينة.");\n    }\n    if (!completion.idempotent) {\n      await stampMatchLiving(helpers, {\n        projectId, officeId, matchId, accessToken,\n        patch: {\n          livingStage: LIVING_TASK_STAGE.VIEWING_COMPLETED,\n          activeMatchId: matchId,\n          ownerContactNeeded: false,\n          hasNewResponse: false,\n          ...completion.patch,\n          nextActor: "BROKER",\n          timelineEvent: {\n            type: "viewing_completed_by_broker",\n            actor: "BROKER",\n            label: "تمت المعاينة"\n          }\n        }\n      });\n      const viewingCompletionOrchestration = await dispatchOrchestratorEvent({\n        event: ORCHESTRATOR_EVENT.VIEWING_COMPLETED,\n        eventId: buildOrchestratorEventId({\n          event: ORCHESTRATOR_EVENT.VIEWING_COMPLETED, officeId, entityId: matchId, occurrenceId: completion.completedAt\n        }),\n        context: { officeId, entityId: matchId, appointmentAt: completion.appointmentAt, completedAt: completion.completedAt },\n        adapters: {\n          [ORCHESTRATOR_OWNER.TASKS]: async () => ({ ok: true })\n        }\n      });\n      if (!viewingCompletionOrchestration.ok) {\n        throw helpers.appError("orchestrator_dispatch_failed", 500, \`فشل تنسيق إتمام المعاينة: \${viewingCompletionOrchestration.error || "unknown"}\`);\n      }\n    }\n    return helpers.jsonResponse({\n      ok: true,\n      idempotent: Boolean(completion.idempotent),\n      livingStage: LIVING_TASK_STAGE.VIEWING_COMPLETED,\n      appointmentAt: completion.appointmentAt,\n      viewingCompletedAt: completion.completedAt,\n      requestId\n    });\n  }\n  if (action === "SET_VIEWING_OUTCOME") {\n    const outcome = String(body.outcome || "").toUpperCase();\n    const allowedOutcomes = new Set(["SERIOUS", "FOLLOW_UP", "NOT_SERIOUS"]);\n    if (!allowedOutcomes.has(outcome)) {\n      throw helpers.appError("viewing_outcome_invalid", 400, "نتيجة المعاينة غير صحيحة.");\n    }\n    const match = await readOfficeDoc(helpers, {\n      projectId, officeId, collection: "matches", id: matchId, accessToken\n    });\n    if (!match) throw helpers.appError("match_not_found", 404, "المطابقة غير موجودة.");\n    if (!String(match.viewingCompletedAt || "").trim() && String(match.livingStage || "").toUpperCase() !== LIVING_TASK_STAGE.VIEWING_COMPLETED) {\n      throw helpers.appError("viewing_not_completed", 409, "سجّل إتمام المعاينة قبل تقييم الجدية.");\n    }\n    const serious = outcome === "SERIOUS";\n    await stampMatchLiving(helpers, {\n      projectId, officeId, matchId, accessToken,\n      patch: {\n        livingStage: LIVING_TASK_STAGE.VIEWING_COMPLETED,\n        activeMatchId: matchId,\n        ownerContactNeeded: false,\n        hasNewResponse: false,\n        viewingOutcome: outcome,\n        seriousIntentConfirmed: serious,\n        nextActor: serious ? "BROKER" : "NONE",\n        timelineEvent: {\n          type: "viewing_outcome_recorded",\n          actor: "BROKER",\n          label: serious\n            ? "تم تأكيد الجدية بعد المعاينة"\n            : outcome === "FOLLOW_UP"\n              ? "تم اختيار المتابعة بعد المعاينة"\n              : "لا توجد جدية بعد المعاينة"\n        }\n      }\n    });\n    return helpers.jsonResponse({\n      ok: true, livingStage: LIVING_TASK_STAGE.VIEWING_COMPLETED, viewingOutcome: outcome, seriousIntentConfirmed: serious, requestId\n    });\n  }\n  if (action === "CONFIRM_COMPLETION") {\n    throw helpers.appError(\n      "legacy_match_completion_removed",\n      409,\n      "إتمام الصفقة يتم من مسار الصفقة بعد الجدية وعقد الوساطة، وليس من المطابقة."\n    );\n  }\n  throw helpers.appError("unknown_action", 400, "إجراء غير معروف.");`,
  "replace unsafe direct completion with viewing completion gate"
);

// 6) Deal creation from a completed serious viewing starts at negotiation, not contact.
replaceOnce(
  "worker/src/index.js",
  '    const startStage=matchStatus==="negotiation"?"negotiation":matchStatus==="viewing"?"viewing":"contact";',
  '    const completedViewing=Boolean(m.viewingCompletedAt)||String(m.livingStage||"").toUpperCase()==="VIEWING_COMPLETED";\n    const startStage=matchStatus==="negotiation"||completedViewing?"negotiation":matchStatus==="viewing"?"viewing":"contact";',
  "completed viewing deal start stage"
);
replaceOnce(
  "worker/src/index.js",
  '    return jsonResponse({ok:true,dealId,status:"open",workflowStage:matchStatus==="negotiation"?"negotiation":"contact",requestId});',
  '    return jsonResponse({ok:true,dealId,status:"open",workflowStage:startStage,requestId});',
  "create_deal response uses startStage"
);

// 7) Content V2 source: actions for completion, seriousness, and explicit Deal creation.
const taskDomain = "src/v2/content/daily-tasks/domain.js";
replaceOnce(
  taskDomain,
  '  CONFIRM_DEAL: "confirm_deal",\n  CONFIRM_VIEWING: "confirm_viewing",\n  OPEN_RECORD: "open_record",',
  '  CONFIRM_DEAL: "confirm_deal",\n  CONFIRM_VIEWING: "confirm_viewing",\n  CONFIRM_VIEWING_COMPLETED: "confirm_viewing_completed",\n  MARK_VIEWING_SERIOUS: "mark_viewing_serious",\n  MARK_VIEWING_FOLLOW_UP: "mark_viewing_follow_up",\n  MARK_VIEWING_NOT_SERIOUS: "mark_viewing_not_serious",\n  CREATE_DEAL: "create_deal",\n  OPEN_RECORD: "open_record",',
  "daily task viewing completion actions"
);
replaceOnce(
  taskDomain,
  `  if (living === LIVING_TASK_STAGE.FOLLOW_UP) {\n    primary = confirmDealAction();\n    if (offerAction) secondary.push(offerAction);\n    return { primaryAction: primary, secondaryActions: secondary.slice(0, 2) };\n  }`,
  `  if (living === LIVING_TASK_STAGE.FOLLOW_UP) {\n    if (offerAction) secondary.push(offerAction);\n    return { primaryAction: null, secondaryActions: secondary.slice(0, 2) };\n  }`,
  "remove direct deal completion from FOLLOW_UP"
);
replaceOnce(
  taskDomain,
  `  if (living === LIVING_TASK_STAGE.WAITING_PROPERTY_CONFIRMATION\n    || living === LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED\n    || living === LIVING_TASK_STAGE.PROPERTY_AVAILABLE\n    || living === LIVING_TASK_STAGE.APPOINTMENT_COORDINATION) {`,
  `  if (living === LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED) {\n    primary = {\n      id: EXEC_ACTION.CONFIRM_VIEWING_COMPLETED,\n      label: "تمت المعاينة"\n    };\n    if (offerAction) secondary.push(offerAction);\n    return { primaryAction: primary, secondaryActions: secondary.slice(0, 2) };\n  }\n  if (living === LIVING_TASK_STAGE.VIEWING_COMPLETED) {\n    const outcome = upper(record.viewingOutcome);\n    if (!outcome) {\n      primary = { id: EXEC_ACTION.MARK_VIEWING_SERIOUS, label: "جدي ونكمل" };\n      secondary.push(\n        { id: EXEC_ACTION.MARK_VIEWING_FOLLOW_UP, label: "متابعة لاحقًا" },\n        { id: EXEC_ACTION.MARK_VIEWING_NOT_SERIOUS, label: "غير جاد" }\n      );\n    } else if (outcome === "SERIOUS") {\n      primary = { id: EXEC_ACTION.CREATE_DEAL, label: "إنشاء الصفقة" };\n    }\n    if (offerAction && secondary.length < 2) secondary.push(offerAction);\n    return { primaryAction: primary, secondaryActions: secondary.slice(0, 2) };\n  }\n  if (living === LIVING_TASK_STAGE.WAITING_PROPERTY_CONFIRMATION\n    || living === LIVING_TASK_STAGE.PROPERTY_AVAILABLE\n    || living === LIVING_TASK_STAGE.APPOINTMENT_COORDINATION) {`,
  "actions after confirmed and completed viewing"
);
replaceOnce(
  taskDomain,
  '    livingStage: text(record.livingStage),\n    missingInfoKey: text(record.missingInfoKey),',
  '    livingStage: text(record.livingStage),\n    viewingCompletedAt: text(record.viewingCompletedAt),\n    viewingOutcome: text(record.viewingOutcome),\n    seriousIntentConfirmed: record.seriousIntentConfirmed === true || upper(record.seriousIntentConfirmed) === "TRUE",\n    missingInfoKey: text(record.missingInfoKey),',
  "daily view exposes viewing completion fields"
);
replaceOnce(
  taskDomain,
  '    appointmentAt: item.appointmentAt,\n    livingTimeline: item.livingTimeline || item.livingTimelineJson || item.metadata?.livingTimeline,',
  '    appointmentAt: item.appointmentAt,\n    viewingCompletedAt: item.viewingCompletedAt || item.metadata?.viewingCompletedAt,\n    viewingOutcome: item.viewingOutcome || item.metadata?.viewingOutcome,\n    seriousIntentConfirmed: item.seriousIntentConfirmed || item.metadata?.seriousIntentConfirmed,\n    livingTimeline: item.livingTimeline || item.livingTimelineJson || item.metadata?.livingTimeline,',
  "match record viewing completion fields"
);
replaceOnce(
  taskDomain,
  '    appointmentLine: formatAppointmentLine(active.viewingAt || active.appointmentAt),\n    ownerContactNeeded: group.living.ownerContactNeeded\n  });',
  '    appointmentLine: formatAppointmentLine(active.viewingAt || active.appointmentAt),\n    ownerContactNeeded: group.living.ownerContactNeeded,\n    viewingOutcome: active.viewingOutcome\n  });',
  "living copy gets viewing outcome"
);

const taskCard = "src/v2/content/daily-tasks/card.js";
replaceOnce(
  taskCard,
  '    confirm_deal: "complete-deal",\n    open_offer: "match-details",',
  '    confirm_deal: "complete-deal",\n    confirm_viewing_completed: "complete-viewing",\n    mark_viewing_serious: "viewing-serious",\n    mark_viewing_follow_up: "viewing-follow-up",\n    mark_viewing_not_serious: "viewing-not-serious",\n    create_deal: "create-deal",\n    open_offer: "match-details",',
  "viewing completion test ids"
);

const taskController = "src/v2/content/daily-tasks/controller.js";
replaceOnce(
  taskController,
  'async function confirmDealCompletion(task, button) {',
  `async function confirmViewingCompletion(task, button) {\n  if (button?.dataset?.cv2ExecState === "working") return { ok: false, error: "busy" };\n  setExecState(button, "working");\n  try {\n    const token = await idToken();\n    const officeId = currentOfficeId();\n    const response = await fetch(\`${workerBase()}\/match\/living-action\`, {\n      method: "POST",\n      headers: { "Content-Type": "application/json", Authorization: \`Bearer \${token}\` },\n      body: JSON.stringify({ officeId, matchId: task.matchId, action: "CONFIRM_VIEWING_COMPLETED" })\n    });\n    const payload = await response.json().catch(() => ({}));\n    if (!response.ok || payload.ok === false) {\n      notify(payload.message || "تعذر تسجيل إتمام المعاينة.");\n      setExecState(button, "error");\n      return { ok: false };\n    }\n    notify("تم تسجيل إتمام المعاينة");\n    setExecState(button, "success");\n    window.dispatchEvent(new CustomEvent("iaqar:operations-refresh"));\n    return { ok: true };\n  } catch {\n    notify("تعذر تسجيل إتمام المعاينة.");\n    setExecState(button, "error");\n    return { ok: false };\n  }\n}\n\nasync function setViewingOutcome(task, outcome, button) {\n  if (button?.dataset?.cv2ExecState === "working") return { ok: false, error: "busy" };\n  setExecState(button, "working");\n  try {\n    const token = await idToken();\n    const officeId = currentOfficeId();\n    const response = await fetch(\`${workerBase()}\/match\/living-action\`, {\n      method: "POST",\n      headers: { "Content-Type": "application/json", Authorization: \`Bearer \${token}\` },\n      body: JSON.stringify({ officeId, matchId: task.matchId, action: "SET_VIEWING_OUTCOME", outcome })\n    });\n    const payload = await response.json().catch(() => ({}));\n    if (!response.ok || payload.ok === false) {\n      notify(payload.message || "تعذر حفظ نتيجة المعاينة.");\n      setExecState(button, "error");\n      return { ok: false };\n    }\n    notify(outcome === "SERIOUS" ? "تم تأكيد الجدية" : outcome === "FOLLOW_UP" ? "تم تسجيل المتابعة" : "تم تسجيل عدم الجدية");\n    setExecState(button, "success");\n    window.dispatchEvent(new CustomEvent("iaqar:operations-refresh"));\n    return { ok: true };\n  } catch {\n    notify("تعذر حفظ نتيجة المعاينة.");\n    setExecState(button, "error");\n    return { ok: false };\n  }\n}\n\nasync function createDealFromViewing(task, button) {\n  if (button?.dataset?.cv2ExecState === "working") return { ok: false, error: "busy" };\n  setExecState(button, "working");\n  try {\n    const token = await idToken();\n    const officeId = currentOfficeId();\n    const response = await fetch(\`${workerBase()}\/workflow\/action\`, {\n      method: "POST",\n      headers: { "Content-Type": "application/json", Authorization: \`Bearer \${token}\` },\n      body: JSON.stringify({ officeId, recordId: task.matchId, action: "create_deal" })\n    });\n    const payload = await response.json().catch(() => ({}));\n    if (!response.ok || payload.ok === false || !payload.dealId) {\n      notify(payload.message || "تعذر إنشاء الصفقة.");\n      setExecState(button, "error");\n      return { ok: false };\n    }\n    notify("تم إنشاء الصفقة والانتقال للتفاوض");\n    setExecState(button, "success");\n    window.dispatchEvent(new CustomEvent("iaqar:operations-refresh"));\n    return { ok: true, dealId: payload.dealId };\n  } catch {\n    notify("تعذر إنشاء الصفقة.");\n    setExecState(button, "error");\n    return { ok: false };\n  }\n}\n\nasync function confirmDealCompletion(task, button) {`,
  "controller completion and seriousness actions"
);
replaceOnce(
  taskController,
  `    if (action === "confirm_viewing") {\n      void confirmViewingAppointment(task, primary);\n      return;\n    }\n    if (action === "complete_info") {`,
  `    if (action === "confirm_viewing") {\n      void confirmViewingAppointment(task, primary);\n      return;\n    }\n    if (action === "confirm_viewing_completed") {\n      void confirmViewingCompletion(task, primary);\n      return;\n    }\n    if (action === "mark_viewing_serious") {\n      void setViewingOutcome(task, "SERIOUS", primary);\n      return;\n    }\n    if (action === "mark_viewing_follow_up") {\n      void setViewingOutcome(task, "FOLLOW_UP", primary);\n      return;\n    }\n    if (action === "mark_viewing_not_serious") {\n      void setViewingOutcome(task, "NOT_SERIOUS", primary);\n      return;\n    }\n    if (action === "create_deal") {\n      void createDealFromViewing(task, primary);\n      return;\n    }\n    if (action === "complete_info") {`,
  "primary click handlers for viewing completion"
);
replaceOnce(
  taskController,
  `    if (action === "complete_info") {\n      toggleTaskDetails(task.id);\n      return;\n    }\n    if (action === "open_record") {`,
  `    if (action === "mark_viewing_follow_up") {\n      void setViewingOutcome(task, "FOLLOW_UP", secondary);\n      return;\n    }\n    if (action === "mark_viewing_not_serious") {\n      void setViewingOutcome(task, "NOT_SERIOUS", secondary);\n      return;\n    }\n    if (action === "complete_info") {\n      toggleTaskDetails(task.id);\n      return;\n    }\n    if (action === "open_record") {`,
  "secondary click handlers for viewing outcomes"
);

// 8) Tests: update lifecycle contract and add explicit regression coverage.
replaceOnce(
  "test/viewing-cleanup-phase5.test.mjs",
  '  planViewingConfirmation,\n  resolveViewingState,',
  '  planViewingConfirmation,\n  planViewingCompletion,\n  resolveViewingState,',
  "import planViewingCompletion test"
);
replaceOnce(
  "test/viewing-cleanup-phase5.test.mjs",
  '    confirmedField: "appointmentAt",\n    statusField: "appointmentStatus",',
  '    confirmedField: "appointmentAt",\n    completedField: "viewingCompletedAt",\n    statusField: "appointmentStatus",',
  "viewing boundary expected completedField"
);
replaceOnce(
  "test/viewing-cleanup-phase5.test.mjs",
  'test("stale candidate no longer reserves broker schedule", () => {',
  `test("viewing completion requires a confirmed appointment that has started", () => {\n  assert.equal(planViewingCompletion({ match: {} }).error, "viewing_not_confirmed");\n  const early = planViewingCompletion({\n    match: {\n      appointmentStatus: VIEWING_APPOINTMENT_STATUS.CONFIRMED_BY_BROKER,\n      appointmentAt: future\n    },\n    now: new Date("2030-01-15T09:00:00.000Z")\n  });\n  assert.equal(early.ok, false);\n  assert.equal(early.error, "viewing_not_started_yet");\n});\n\ntest("completed viewing is Match-owned, idempotent, and distinct from appointment confirmation", () => {\n  const match = {\n    appointmentStatus: VIEWING_APPOINTMENT_STATUS.CONFIRMED_BY_BROKER,\n    appointmentAt: future\n  };\n  const first = planViewingCompletion({ match, now: new Date("2030-01-15T11:00:00.000Z") });\n  assert.equal(first.ok, true);\n  assert.equal(first.idempotent, false);\n  assert.equal(first.patch.viewingCompletedAt, "2030-01-15T11:00:00.000Z");\n  assert.equal(first.patch.seriousIntentConfirmed, false);\n  const completed = { ...match, ...first.patch };\n  assert.equal(resolveViewingState(completed).state, VIEWING_STATE.COMPLETED);\n  const second = planViewingCompletion({ match: completed, now: new Date("2030-01-15T12:00:00.000Z") });\n  assert.equal(second.ok, true);\n  assert.equal(second.idempotent, true);\n  assert.equal(second.patch, null);\n});\n\ntest("stale candidate no longer reserves broker schedule", () => {`,
  "viewing completion tests"
);

replaceOnce(
  "test/post-match-chain-release-gate.test.mjs",
  '  assert.equal(boundaries.viewingConfirmationAutoCreatesDeal, false);',
  '  assert.equal(boundaries.viewingConfirmationAutoCreatesDeal, false);\n  assert.equal(boundaries.viewingCompletionAutoCreatesDeal, false);',
  "post-match completion boundary"
);
replaceOnce(
  "test/post-match-chain-release-gate.test.mjs",
  `test("confirmed viewing or serious coordination may open Deal", () => {\n  const confirmed = canCreateDeal({\n    match: {\n      appointmentStatus: "CONFIRMED",\n      appointmentAt: "2026-09-08T18:00:00+03:00"\n    }\n  });\n  assert.equal(confirmed.allowed, true);\n  assert.equal(confirmed.reason, "viewing_confirmed");\n\n  const serious = canCreateDeal({ coordination: { outcome: "VIEWING_READY" } });\n  assert.equal(serious.allowed, true);\n});`,
  `test("confirmed appointment is not enough; completed serious viewing or explicit serious coordination may open Deal", () => {\n  const confirmed = canCreateDeal({\n    match: {\n      appointmentStatus: "CONFIRMED",\n      appointmentAt: "2026-09-08T18:00:00+03:00"\n    }\n  });\n  assert.equal(confirmed.allowed, false);\n  assert.equal(confirmed.reason, "not_serious_yet");\n\n  const completedNotSerious = canCreateDeal({\n    match: { viewingCompletedAt: "2026-09-08T19:00:00+03:00", livingStage: "VIEWING_COMPLETED" }\n  });\n  assert.equal(completedNotSerious.allowed, false);\n\n  const completedSerious = canCreateDeal({\n    match: {\n      viewingCompletedAt: "2026-09-08T19:00:00+03:00",\n      livingStage: "VIEWING_COMPLETED",\n      seriousIntentConfirmed: true\n    }\n  });\n  assert.equal(completedSerious.allowed, true);\n  assert.equal(completedSerious.reason, "viewing_completed_serious");\n\n  assert.equal(canCreateDeal({ coordination: { outcome: "VIEWING_READY" } }).allowed, false);\n  assert.equal(canCreateDeal({ coordination: { outcome: "PRICE_ALIGNED" } }).allowed, true);\n});`,
  "deal gate after viewing completion"
);
replaceOnce(
  "test/post-match-chain-release-gate.test.mjs",
  '  assert.equal(resolvePostMatchStage({ match: { appointmentStatus: "CONFIRMED", appointmentAt: "x" } }), POST_MATCH_STAGE.VIEWING_CONFIRMED);',
  '  assert.equal(resolvePostMatchStage({ match: { appointmentStatus: "CONFIRMED", appointmentAt: "x" } }), POST_MATCH_STAGE.VIEWING_CONFIRMED);\n  assert.equal(resolvePostMatchStage({ match: { viewingCompletedAt: "x", livingStage: "VIEWING_COMPLETED" } }), POST_MATCH_STAGE.VIEWING_COMPLETED);',
  "resolve VIEWING_COMPLETED test"
);
replaceOnce(
  "test/post-match-chain-release-gate.test.mjs",
  'test("deal cannot be created from a weak match before seriousness", () => {',
  `test("viewing completion event remains Match-owned and does not create Deal", () => {\n  const missing = planPostMatchTransition({ event: POST_MATCH_EVENT.VIEWING_COMPLETED });\n  assert.deepEqual(missing, { ok: false, reason: "viewing_completion_required", writes: [] });\n  const plan = planPostMatchTransition({\n    event: POST_MATCH_EVENT.VIEWING_COMPLETED,\n    payload: { completedAt: "2026-09-08T19:00:00+03:00" }\n  });\n  assert.equal(plan.ok, true);\n  assert.equal(plan.createsDeal, false);\n  assert.deepEqual(plan.writes, [\n    { target: "matches", mode: "authoritative" },\n    { target: "operations", mode: "projection" }\n  ]);\n});\n\ntest("deal cannot be created from a weak match before seriousness", () => {`,
  "post-match viewing completion event test"
);

replaceOnce(
  "test/deal-contract-cleanup-phase6.test.mjs",
  `test("deal creation requires serious coordination or confirmed viewing", () => {\n  assert.equal(evaluateDealCreation({ match: { status: "active" } }).allowed, false);\n  assert.equal(evaluateDealCreation({ match: { appointmentAt: "2026-09-08T10:00:00.000Z" } }).allowed, true);\n  assert.equal(evaluateDealCreation({ coordination: { outcome: "VIEWING_READY" } }).allowed, true);\n  assert.equal(evaluateDealCreation({ coordination: { outcome: "PRICE_ALIGNED" } }).allowed, true);\n});`,
  `test("deal creation requires explicit seriousness; confirmed or merely ready viewing is insufficient", () => {\n  assert.equal(evaluateDealCreation({ match: { status: "active" } }).allowed, false);\n  assert.equal(evaluateDealCreation({ match: { appointmentStatus: "CONFIRMED", appointmentAt: "2026-09-08T10:00:00.000Z" } }).allowed, false);\n  assert.equal(evaluateDealCreation({ coordination: { outcome: "VIEWING_READY" } }).allowed, false);\n  assert.equal(evaluateDealCreation({\n    match: { viewingCompletedAt: "2026-09-08T11:00:00.000Z", livingStage: "VIEWING_COMPLETED", seriousIntentConfirmed: true }\n  }).allowed, true);\n  assert.equal(evaluateDealCreation({ coordination: { outcome: "PRICE_ALIGNED" } }).allowed, true);\n});`,
  "deal contract explicit seriousness test"
);

replaceOnce(
  "test/full-transaction-chain-contract.test.mjs",
  `  const deal = planPostMatchTransition({\n    event: POST_MATCH_EVENT.DEAL_CREATED,\n    match: {\n      appointmentStatus: "CONFIRMED",\n      appointmentAt: "2026-09-10T18:00:00+03:00"\n    }\n  });\n  assert.equal(deal.ok, true);\n  assert.equal(deal.createsDeal, true);`,
  `  const completedViewing = planPostMatchTransition({\n    event: POST_MATCH_EVENT.VIEWING_COMPLETED,\n    payload: { completedAt: "2026-09-10T19:00:00+03:00" }\n  });\n  assert.equal(completedViewing.ok, true);\n  assert.equal(completedViewing.createsDeal, false);\n\n  const prematureDeal = planPostMatchTransition({\n    event: POST_MATCH_EVENT.DEAL_CREATED,\n    match: { appointmentStatus: "CONFIRMED", appointmentAt: "2026-09-10T18:00:00+03:00" }\n  });\n  assert.equal(prematureDeal.ok, false);\n\n  const deal = planPostMatchTransition({\n    event: POST_MATCH_EVENT.DEAL_CREATED,\n    match: {\n      appointmentStatus: "CONFIRMED",\n      appointmentAt: "2026-09-10T18:00:00+03:00",\n      viewingCompletedAt: "2026-09-10T19:00:00+03:00",\n      livingStage: "VIEWING_COMPLETED",\n      seriousIntentConfirmed: true\n    }\n  });\n  assert.equal(deal.ok, true);\n  assert.equal(deal.createsDeal, true);`,
  "full transaction chain requires viewing completion and seriousness"
);

// New focused regression test for the UI/domain/worker wiring.
writeFileSync("test/viewing-completed-deal-gate.test.mjs", `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\nimport { LIVING_TASK_STAGE, livingCopy } from "../public/js/match-group-domain.js";\nimport { buildDailyTaskView, EXEC_ACTION, DAILY_TASK_STATE } from "../public/js/v2/daily-tasks/domain.js";\n\ntest("appointment confirmed exposes completion instead of direct deal completion", () => {\n  const task = buildDailyTaskView({\n    id: "mg_1", matchId: "m1", offerId: "o1", requestId: "r1",\n    livingStage: LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED,\n    stateKey: DAILY_TASK_STATE.APPOINTMENT_TODAY,\n    canOpenOffer: false\n  });\n  assert.equal(task.primaryAction.id, EXEC_ACTION.CONFIRM_VIEWING_COMPLETED);\n  assert.equal(task.primaryAction.label, "تمت المعاينة");\n  assert.equal(livingCopy(LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED).waiting, false);\n});\n\ntest("completed viewing requires explicit seriousness before create Deal action", () => {\n  const base = {\n    id: "mg_1", matchId: "m1", offerId: "o1", requestId: "r1",\n    livingStage: LIVING_TASK_STAGE.VIEWING_COMPLETED,\n    stateKey: DAILY_TASK_STATE.NEW_MATCH, canOpenOffer: false\n  };\n  const pending = buildDailyTaskView(base);\n  assert.equal(pending.primaryAction.id, EXEC_ACTION.MARK_VIEWING_SERIOUS);\n  assert.deepEqual(pending.secondaryActions.map((action) => action.id), [\n    EXEC_ACTION.MARK_VIEWING_FOLLOW_UP, EXEC_ACTION.MARK_VIEWING_NOT_SERIOUS\n  ]);\n  const serious = buildDailyTaskView({ ...base, viewingOutcome: "SERIOUS", seriousIntentConfirmed: true });\n  assert.equal(serious.primaryAction.id, EXEC_ACTION.CREATE_DEAL);\n  const notSerious = buildDailyTaskView({ ...base, viewingOutcome: "NOT_SERIOUS" });\n  assert.equal(notSerious.primaryAction, null);\n});\n\ntest("worker wiring bans legacy direct completion and exposes safe viewing lifecycle actions", () => {\n  const party = readFileSync(new URL("../worker/src/party-session-service.js", import.meta.url), "utf8");\n  const controller = readFileSync(new URL("../public/js/v2/daily-tasks/controller.js", import.meta.url), "utf8");\n  assert.match(party, /CONFIRM_VIEWING_COMPLETED/);\n  assert.match(party, /SET_VIEWING_OUTCOME/);\n  assert.match(party, /legacy_match_completion_removed/);\n  assert.doesNotMatch(party, /type: "deal_completed"/);\n  assert.match(controller, /action: "CONFIRM_VIEWING_COMPLETED"/);\n  assert.match(controller, /action: "SET_VIEWING_OUTCOME"/);\n  assert.match(controller, /action: "create_deal"/);\n});\n`);
console.log("[created] test/viewing-completed-deal-gate.test.mjs");

console.log("Viewing completion + seriousness + explicit Deal gate patch applied.");
