/**
 * Phase 6 — trusted cooperation lifecycle (accept/reject/revoke) + audit + cleanup.
 */

import {
  COOPERATION_AUDIT_ACTIONS,
  applyCooperationDecision,
  buildCooperationAuditEntry,
  buildCooperationRequestId,
  buildRevocationCleanupPlan,
  buildSharedProjection,
  cooperationModeAllowsAccept,
  cooperationModeAllowsExplicitRequest,
  defaultCooperationRequestPermissions,
  minimumSharedFields,
  normalizeCooperationMode,
  opportunityStatusFromShare,
  phase6BoundaryGuarantees
} from "./cooperation-phase6-domain.js";
import { ensureCooperationRoom } from "./opportunity-workspace-service.mjs";
import { readTargetOfficeEligibility } from "./suitable-offices-service.mjs";

function firestoreHelpersBundle(h) {
  return h;
}

export function auditToFirestoreFields(entry, h) {
  return {
    schemaVersion: h.firestoreInteger(entry.schemaVersion || 1),
    id: h.firestoreString(entry.id),
    officeId: h.firestoreString(entry.officeId),
    action: h.firestoreString(entry.action),
    actorUid: h.firestoreString(entry.actorUid || ""),
    cooperationId: h.firestoreString(entry.cooperationId || ""),
    originatingOfficeId: h.firestoreString(entry.originatingOfficeId || ""),
    targetOfficeId: h.firestoreString(entry.targetOfficeId || ""),
    opportunityIdsJson: h.firestoreString(JSON.stringify(entry.opportunityIds || [])),
    detailsJson: h.firestoreString(JSON.stringify(entry.details || {})),
    createdAt: h.firestoreTimestamp(new Date(entry.createdAt)),
    createdBySystem: h.firestoreBoolean(entry.createdBySystem !== false)
  };
}

async function writeAudit({
  projectId,
  officeId,
  entry,
  accessToken,
  setFirestoreDocument,
  firestoreHelpers
}) {
  if (!officeId || !entry?.id) return;
  await setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "auditLogs", entry.id],
    accessToken,
    fields: auditToFirestoreFields(entry, firestoreHelpers)
  });
}

async function readCooperationMode({
  projectId,
  officeId,
  accessToken,
  getFirestoreDocument,
  firestoreFieldsToJs
}) {
  const doc = await getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "officeSettings", "cooperation"],
    accessToken,
    allowMissing: true
  });
  if (!doc) return "APPROVAL_REQUIRED";
  const data = firestoreFieldsToJs(doc.fields || {});
  return normalizeCooperationMode(data.mode);
}

async function patchOpportunityCooperation({
  projectId,
  officeId,
  opportunityId,
  shareStatus,
  cooperationId,
  accessToken,
  setFirestoreDocument,
  firestoreHelpers
}) {
  const state = opportunityStatusFromShare(shareStatus);
  const now = new Date();
  await setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "opportunities", opportunityId],
    accessToken,
    fields: {
      officeId: firestoreHelpers.firestoreString(officeId),
      cooperationState: firestoreHelpers.firestoreString(state),
      cooperationStatus: firestoreHelpers.firestoreString(state),
      activeCooperationId: ["ACTIVE", "PENDING_APPROVAL"].includes(state)
        ? firestoreHelpers.firestoreString(cooperationId)
        : firestoreHelpers.firestoreString(""),
      currentOwningOfficeId: firestoreHelpers.firestoreString(officeId),
      updatedAt: firestoreHelpers.firestoreTimestamp(now)
    }
  });
}

async function deleteSharedProjections({
  projectId,
  targetOfficeId,
  opportunityIds,
  accessToken,
  deleteFirestoreDocument,
  setFirestoreDocument,
  firestoreHelpers
}) {
  const now = new Date();
  let removed = 0;
  for (const opportunityId of opportunityIds) {
    if (typeof deleteFirestoreDocument === "function") {
      await deleteFirestoreDocument({
        projectId,
        segments: ["offices", targetOfficeId, "sharedOpportunities", opportunityId],
        accessToken
      }).catch(async () => {
        // Fallback: mark revoked if hard delete unavailable.
        await setFirestoreDocument({
          projectId,
          segments: ["offices", targetOfficeId, "sharedOpportunities", opportunityId],
          accessToken,
          fields: {
            revokedAt: firestoreHelpers.firestoreTimestamp(now),
            cooperationStatus: firestoreHelpers.firestoreString("ENDED"),
            readOnly: firestoreHelpers.firestoreBoolean(true),
            updatedAt: firestoreHelpers.firestoreTimestamp(now)
          }
        });
      });
    } else {
      await setFirestoreDocument({
        projectId,
        segments: ["offices", targetOfficeId, "sharedOpportunities", opportunityId],
        accessToken,
        fields: {
          revokedAt: firestoreHelpers.firestoreTimestamp(now),
          cooperationStatus: firestoreHelpers.firestoreString("ENDED"),
          contactPhone: firestoreHelpers.firestoreString(""),
          phone: firestoreHelpers.firestoreString(""),
          contactName: firestoreHelpers.firestoreString(""),
          readOnly: firestoreHelpers.firestoreBoolean(true),
          updatedAt: firestoreHelpers.firestoreTimestamp(now)
        }
      });
    }
    removed += 1;
  }
  return removed;
}

export async function runCooperationLifecycle({
  projectId,
  actorOfficeId,
  actorUid,
  cooperationId,
  action,
  reason = "",
  accessToken,
  deps
}) {
  const {
    getFirestoreDocument,
    setFirestoreDocument,
    deleteFirestoreDocument,
    firestoreFieldsToJs,
    firestoreHelpers,
    upsertCooperationOperations
  } = deps;

  const coopDoc = await getFirestoreDocument({
    projectId,
    segments: ["cooperationRequests", cooperationId],
    accessToken,
    allowMissing: true
  });
  if (!coopDoc) return { ok: false, error: "cooperation_not_found", status: 404 };

  const request = { id: cooperationId, ...firestoreFieldsToJs(coopDoc.fields || {}) };
  // permissions may be nested — REST may flatten; restore defaults if missing.
  if (!request.permissions || typeof request.permissions !== "object") {
    request.permissions = {
      readOnly: true,
      contactVisible: false,
      ownershipModifiable: false,
      canDelete: false
    };
  }

  const origin = String(request.originatingOfficeId || "");
  const target = String(request.targetOfficeId || "");
  if (actorOfficeId !== origin && actorOfficeId !== target) {
    return { ok: false, error: "cooperation_forbidden", status: 403 };
  }

  const decision = String(action || "").toUpperCase();
  if (["ACCEPT", "ACCEPTED", "REJECT", "REJECTED", "REQUEST_DETAILS", "DETAILS_REQUESTED"].includes(decision) && actorOfficeId !== target) {
    return { ok: false, error: "target_only", status: 403 };
  }
  if (["REVOKE", "REVOKED", "END", "ENDED"].includes(decision) && actorOfficeId !== origin) {
    return { ok: false, error: "origin_only", status: 403 };
  }

  if (["ACCEPT", "ACCEPTED"].includes(decision)) {
    const mode = await readCooperationMode({
      projectId, officeId: target, accessToken, getFirestoreDocument, firestoreFieldsToJs
    });
    if (!cooperationModeAllowsAccept(mode)) {
      return { ok: false, error: "cooperation_disabled", status: 403 };
    }
  }

  const applied = applyCooperationDecision(request, decision, { actorUid });
  if (!applied.ok) return { ok: false, error: applied.error, status: 400 };

  if (applied.patch) {
    const fields = {};
    for (const [key, value] of Object.entries(applied.patch)) {
      if (value == null) continue;
      if (String(key).endsWith("At") || key === "updatedAt") {
        fields[key] = firestoreHelpers.firestoreTimestamp(new Date(value));
      } else {
        fields[key] = firestoreHelpers.firestoreString(value);
      }
    }
    // Preserve party ids on update.
    fields.originatingOfficeId = firestoreHelpers.firestoreString(origin);
    fields.targetOfficeId = firestoreHelpers.firestoreString(target);
    await setFirestoreDocument({
      projectId,
      segments: ["cooperationRequests", cooperationId],
      accessToken,
      fields
    });
  }

  const nextStatus = applied.patch?.status || request.status;
  const opportunityIds = Array.isArray(request.opportunityIds) && request.opportunityIds.length
    ? request.opportunityIds.map(String)
    : (request.opportunityId ? [String(request.opportunityId)] : []);

  let projectionsWritten = 0;
  let projectionsRemoved = 0;

  if (nextStatus === "ACCEPTED") {
    for (const opportunityId of opportunityIds) {
      const sourceDoc = await getFirestoreDocument({
        projectId,
        segments: ["offices", origin, "opportunities", opportunityId],
        accessToken,
        allowMissing: true
      });
      const source = sourceDoc
        ? { id: opportunityId, ...firestoreFieldsToJs(sourceDoc.fields || {}) }
        : { id: opportunityId, officeId: origin, originatingOfficeId: origin };
      // Ownership must remain on origin — never rewrite origin ownership here.
      const projection = buildSharedProjection({
        opportunityId,
        source,
        request: { ...request, id: cooperationId, status: nextStatus }
      });
      await setFirestoreDocument({
        projectId,
        segments: ["offices", target, "sharedOpportunities", opportunityId],
        accessToken,
        fields: {
          id: firestoreHelpers.firestoreString(projection.id),
          sourceOpportunityId: firestoreHelpers.firestoreString(projection.sourceOpportunityId),
          originatingOfficeId: firestoreHelpers.firestoreString(projection.originatingOfficeId),
          currentOwningOfficeId: firestoreHelpers.firestoreString(projection.currentOwningOfficeId || origin),
          opportunityKind: firestoreHelpers.firestoreString(projection.opportunityKind),
          purpose: firestoreHelpers.firestoreString(projection.purpose),
          propertyType: firestoreHelpers.firestoreString(projection.propertyType),
          city: firestoreHelpers.firestoreString(projection.city),
          district: firestoreHelpers.firestoreString(projection.district),
          priceOrBudget: projection.priceOrBudget == null
            ? null
            : firestoreHelpers.firestoreInteger(Number(projection.priceOrBudget) || 0),
          area: projection.area == null ? null : firestoreHelpers.firestoreInteger(Number(projection.area) || 0),
          rooms: projection.rooms == null ? null : firestoreHelpers.firestoreInteger(Number(projection.rooms) || 0),
          cooperationStatus: firestoreHelpers.firestoreString("ACTIVE"),
          sharedViaRequestId: firestoreHelpers.firestoreString(cooperationId),
          contactName: firestoreHelpers.firestoreString(""),
          contactPhone: firestoreHelpers.firestoreString(""),
          phone: firestoreHelpers.firestoreString(""),
          readOnly: firestoreHelpers.firestoreBoolean(true),
          permissionsJson: firestoreHelpers.firestoreString(JSON.stringify(projection.permissions)),
          updatedAt: firestoreHelpers.firestoreTimestamp(new Date())
        }
      });
      projectionsWritten += 1;
      await patchOpportunityCooperation({
        projectId,
        officeId: origin,
        opportunityId,
        shareStatus: "ACCEPTED",
        cooperationId,
        accessToken,
        setFirestoreDocument,
        firestoreHelpers
      });
    }
    await writeAgreementLibraryEntriesOnAccept({
      projectId,
      accessToken,
      agreementId: cooperationId,
      originatingOfficeId: origin,
      targetOfficeId: target,
      getFirestoreDocument,
      setFirestoreDocument,
      firestoreFieldsToJs,
      firestoreHelpers
    });
    for (const opportunityId of opportunityIds) {
      await ensureCooperationRoom({
        projectId,
        cooperationId,
        originatingOfficeId: origin,
        targetOfficeId: target,
        opportunityId,
        accessToken,
        getFirestoreDocument,
        setFirestoreDocument,
        firestoreFieldsToJs,
        firestoreHelpers
      });
    }
  }

  if (["REJECTED", "REVOKED", "ENDED"].includes(String(nextStatus).toUpperCase())) {
    for (const opportunityId of opportunityIds) {
      await patchOpportunityCooperation({
        projectId,
        officeId: origin,
        opportunityId,
        shareStatus: nextStatus,
        cooperationId,
        accessToken,
        setFirestoreDocument,
        firestoreHelpers
      });
    }
  }

  if (["REVOKED", "ENDED"].includes(String(nextStatus).toUpperCase())) {
    const plan = buildRevocationCleanupPlan({ ...request, id: cooperationId });
    projectionsRemoved = await deleteSharedProjections({
      projectId,
      targetOfficeId: plan.targetOfficeId,
      opportunityIds: plan.opportunityIds,
      accessToken,
      deleteFirestoreDocument,
      setFirestoreDocument,
      firestoreHelpers
    });
  }

  const auditAction = {
    ACCEPTED: COOPERATION_AUDIT_ACTIONS.REQUEST_ACCEPTED,
    REJECTED: COOPERATION_AUDIT_ACTIONS.REQUEST_REJECTED,
    REVOKED: COOPERATION_AUDIT_ACTIONS.REQUEST_REVOKED,
    ENDED: COOPERATION_AUDIT_ACTIONS.REQUEST_REVOKED
  }[String(nextStatus).toUpperCase()] || COOPERATION_AUDIT_ACTIONS.REQUEST_ACCEPTED;

  const auditBase = {
    action: auditAction,
    actorUid,
    cooperationId,
    originatingOfficeId: origin,
    targetOfficeId: target,
    opportunityIds,
    details: {
      nextStatus,
      reason: String(reason || "").slice(0, 200),
      projectionsWritten,
      projectionsRemoved,
      actorOfficeId
    }
  };

  const originAudit = await buildCooperationAuditEntry({ ...auditBase, officeId: origin });
  const targetAudit = await buildCooperationAuditEntry({ ...auditBase, officeId: target });
  await writeAudit({
    projectId, officeId: origin, entry: originAudit, accessToken, setFirestoreDocument, firestoreHelpers
  });
  await writeAudit({
    projectId, officeId: target, entry: targetAudit, accessToken, setFirestoreDocument, firestoreHelpers
  });

  if (typeof upsertCooperationOperations === "function") {
    await upsertCooperationOperations({
      projectId,
      cooperation: { ...request, id: cooperationId, status: nextStatus },
      accessToken,
      deps
    }).catch(() => null);
  }

  return {
    ok: true,
    cooperationId,
    status: nextStatus,
    projectionsWritten,
    projectionsRemoved,
    opportunityIds,
    boundaries: phase6BoundaryGuarantees()
  };
}

export async function revokeBankSharingScope({
  projectId,
  actorOfficeId,
  actorUid,
  sharingScopeId,
  reason = "",
  accessToken,
  deps
}) {
  const {
    getFirestoreDocument,
    setFirestoreDocument,
    firestoreFieldsToJs,
    firestoreHelpers
  } = deps;

  const doc = await getFirestoreDocument({
    projectId,
    segments: ["bankSharingScopes", sharingScopeId],
    accessToken,
    allowMissing: true
  });
  if (!doc) return { ok: false, error: "scope_not_found", status: 404 };
  const scope = { id: sharingScopeId, ...firestoreFieldsToJs(doc.fields || {}) };
  const origin = String(scope.originatingOfficeId || "");
  const target = String(scope.targetOfficeId || "");
  if (actorOfficeId !== origin) {
    return { ok: false, error: "origin_only", status: 403 };
  }

  const now = new Date();
  await setFirestoreDocument({
    projectId,
    segments: ["bankSharingScopes", sharingScopeId],
    accessToken,
    fields: {
      originatingOfficeId: firestoreHelpers.firestoreString(origin),
      targetOfficeId: firestoreHelpers.firestoreString(target),
      status: firestoreHelpers.firestoreString("REVOKED"),
      enabled: firestoreHelpers.firestoreBoolean(false),
      revokedAt: firestoreHelpers.firestoreTimestamp(now),
      updatedAt: firestoreHelpers.firestoreTimestamp(now),
      revokedBy: firestoreHelpers.firestoreString(actorUid || ""),
      revocationReason: firestoreHelpers.firestoreString(String(reason || "").slice(0, 200))
    }
  });

  const audit = await buildCooperationAuditEntry({
    action: COOPERATION_AUDIT_ACTIONS.SCOPE_REVOKED,
    officeId: origin,
    actorUid,
    cooperationId: sharingScopeId,
    originatingOfficeId: origin,
    targetOfficeId: target,
    opportunityIds: Array.isArray(scope.opportunityIds) ? scope.opportunityIds : [],
    details: { reason: String(reason || "").slice(0, 200) }
  });
  await writeAudit({
    projectId, officeId: origin, entry: audit, accessToken, setFirestoreDocument, firestoreHelpers
  });
  const targetAudit = await buildCooperationAuditEntry({
    action: COOPERATION_AUDIT_ACTIONS.SCOPE_REVOKED,
    officeId: target,
    actorUid,
    cooperationId: sharingScopeId,
    originatingOfficeId: origin,
    targetOfficeId: target,
    opportunityIds: Array.isArray(scope.opportunityIds) ? scope.opportunityIds : [],
    details: { reason: String(reason || "").slice(0, 200) }
  });
  await writeAudit({
    projectId, officeId: target, entry: targetAudit, accessToken, setFirestoreDocument, firestoreHelpers
  });

  return {
    ok: true,
    sharingScopeId,
    status: "REVOKED",
    boundaries: phase6BoundaryGuarantees()
  };
}

export async function createExplicitCooperationRequest({
  projectId,
  originatingOfficeId,
  originatingBrokerId,
  targetOfficeId,
  opportunityIds,
  scopeType = "single",
  message = "",
  accessToken,
  deps
}) {
  const origin = String(originatingOfficeId || "").trim().toLowerCase();
  const target = String(targetOfficeId || "").trim().toLowerCase();
  if (!origin || !target) return { ok: false, error: "office_ids_required", status: 400 };
  if (origin === target) return { ok: false, error: "same_office", status: 400 };

  const ids = [...new Set((opportunityIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (scopeType === "single" && ids.length !== 1) {
    return { ok: false, error: "single_opportunity_required", status: 400 };
  }
  if (scopeType === "selected" && ids.length < 1) {
    return { ok: false, error: "selection_required", status: 400 };
  }

  const mode = await readCooperationMode({
    projectId,
    officeId: origin,
    accessToken,
    getFirestoreDocument: deps.getFirestoreDocument,
    firestoreFieldsToJs: deps.firestoreFieldsToJs
  });
  if (!cooperationModeAllowsExplicitRequest(mode)) {
    return {
      ok: false,
      error: "cooperation_disabled",
      status: 403,
      message: "التعاون معطّل في إعدادات هذا المكتب"
    };
  }

  const targetEligibility = await readTargetOfficeEligibility({
    projectId,
    targetOfficeId: target,
    accessToken,
    deps
  });
  if (!targetEligibility.eligible) {
    return {
      ok: false,
      error: "target_not_eligible",
      status: 403,
      message: "المكتب المستلم غير متاح لاستقبال الفرص حاليًا"
    };
  }

  let primaryOpportunity = null;
  for (const oppId of ids) {
    const oppDoc = await deps.getFirestoreDocument({
      projectId,
      segments: ["offices", origin, "opportunities", oppId],
      accessToken,
      allowMissing: true
    });
    if (!oppDoc) {
      return { ok: false, error: "opportunity_not_found", status: 404, message: "الفرصة غير موجودة" };
    }
    const opp = deps.firestoreFieldsToJs(oppDoc.fields || {});
    if (String(opp.officeId || "").trim().toLowerCase() !== origin) {
      return {
        ok: false,
        error: "opportunity_forbidden",
        status: 403,
        message: "لا يمكن مشاركة فرص لا تتبع هذا المكتب"
      };
    }
    if (!primaryOpportunity) primaryOpportunity = opp;
  }

  const opportunityKey = scopeType === "single" ? ids[0] : ids.slice().sort().join(",");
  let idNonce = "";
  const previewId = await buildCooperationRequestId({
    originatingOfficeId: origin,
    targetOfficeId: target,
    opportunityId: opportunityKey,
    scopeType
  });
  const previewDoc = await deps.getFirestoreDocument({
    projectId,
    segments: ["cooperationRequests", previewId],
    accessToken,
    allowMissing: true
  });
  if (previewDoc) {
    const preview = deps.firestoreFieldsToJs(previewDoc.fields || {});
    const previewStatus = String(preview.status || "").toUpperCase();
    if (previewStatus === "PENDING" || previewStatus === "ACCEPTED") {
      return {
        ok: true,
        duplicate: true,
        requestId: previewId,
        message: "يوجد طلب تعاون نشط أو معلّق مسبقًا"
      };
    }
    if (["REJECTED", "REVOKED", "ENDED"].includes(previewStatus)) {
      idNonce = String(Date.now());
    }
  }

  const requestId = await buildCooperationRequestId({
    originatingOfficeId: origin,
    targetOfficeId: target,
    opportunityId: opportunityKey,
    scopeType,
    idNonce
  });

  const existingDoc = await deps.getFirestoreDocument({
    projectId,
    segments: ["cooperationRequests", requestId],
    accessToken,
    allowMissing: true
  });
  if (existingDoc) {
    const existing = deps.firestoreFieldsToJs(existingDoc.fields || {});
    const status = String(existing.status || "").toUpperCase();
    if (status === "PENDING" || status === "ACCEPTED") {
      return {
        ok: true,
        duplicate: true,
        requestId,
        message: "يوجد طلب تعاون نشط أو معلّق مسبقًا"
      };
    }
  }

  const now = new Date();
  const permissions = defaultCooperationRequestPermissions();
  const fh = deps.firestoreHelpers || firestoreHelpersBundle(deps);
  const min = minimumSharedFields(primaryOpportunity || {});
  const sharedSummary = {
    opportunityKind: min.opportunityKind,
    propertyType: min.propertyType,
    purpose: min.purpose,
    city: min.city,
    district: min.district,
    priceOrBudget: min.priceOrBudget,
    area: min.area,
    rooms: min.rooms,
    description: String(primaryOpportunity?.publicDescription || primaryOpportunity?.description || "").slice(0, 500)
  };
  const originatingOfficeName = await readPublicOfficeName({
    projectId, officeId: origin, accessToken,
    getFirestoreDocument: deps.getFirestoreDocument,
    firestoreFieldsToJs: deps.firestoreFieldsToJs
  });
  const targetOfficeName = await readPublicOfficeName({
    projectId, officeId: target, accessToken,
    getFirestoreDocument: deps.getFirestoreDocument,
    firestoreFieldsToJs: deps.firestoreFieldsToJs
  });
  const safeMessage = String(message || "").slice(0, 500);
  await deps.setFirestoreDocument({
    projectId,
    segments: ["cooperationRequests", requestId],
    accessToken,
    fields: {
      id: fh.firestoreString(requestId),
      originatingOfficeId: fh.firestoreString(origin),
      originatingOfficeName: fh.firestoreString(originatingOfficeName),
      originatingBrokerId: fh.firestoreString(originatingBrokerId),
      targetOfficeId: fh.firestoreString(target),
      targetOfficeName: fh.firestoreString(targetOfficeName),
      targetBrokerId: fh.firestoreString(""),
      opportunityId: fh.firestoreString(scopeType === "single" ? ids[0] : ""),
      opportunityIds: { arrayValue: { values: ids.map((id) => ({ stringValue: id })) } },
      scopeType: fh.firestoreString(scopeType),
      opportunityKind: fh.firestoreString(sharedSummary.opportunityKind),
      propertyType: fh.firestoreString(sharedSummary.propertyType),
      purpose: fh.firestoreString(sharedSummary.purpose),
      city: fh.firestoreString(sharedSummary.city),
      district: fh.firestoreString(sharedSummary.district),
      priceOrBudget: sharedSummary.priceOrBudget == null
        ? { nullValue: null }
        : fh.firestoreString(String(sharedSummary.priceOrBudget)),
      area: sharedSummary.area == null
        ? { nullValue: null }
        : fh.firestoreString(String(sharedSummary.area)),
      rooms: sharedSummary.rooms == null
        ? { nullValue: null }
        : fh.firestoreString(String(sharedSummary.rooms)),
      sharedDescription: fh.firestoreString(sharedSummary.description || ""),
      shareMessage: fh.firestoreString(safeMessage),
      sharedSummaryJson: fh.firestoreString(JSON.stringify(sharedSummary)),
      requestedAt: fh.firestoreString(now.toISOString()),
      status: fh.firestoreString("PENDING"),
      permissions: {
        mapValue: {
          fields: {
            readOnly: { booleanValue: true },
            minimumData: { booleanValue: true },
            contactVisible: { booleanValue: false },
            ownershipModifiable: { booleanValue: false },
            canDelete: { booleanValue: false },
            canArchive: { booleanValue: false },
            unrestrictedAttachmentDownload: { booleanValue: false },
            canReshare: { booleanValue: false }
          }
        }
      },
      createdBy: fh.firestoreString(originatingBrokerId),
      createdAt: fh.firestoreTimestamp(now),
      updatedAt: fh.firestoreTimestamp(now),
      schemaVersion: fh.firestoreInteger(1)
    }
  });

  for (const oppId of ids) {
    await patchOpportunityCooperation({
      projectId,
      officeId: origin,
      opportunityId: oppId,
      shareStatus: "PENDING",
      cooperationId: requestId,
      accessToken,
      setFirestoreDocument: deps.setFirestoreDocument,
      firestoreHelpers: fh
    });
  }

  return {
    ok: true,
    requestId,
    duplicate: false,
    message: "تم إرسال طلب التعاون",
    boundaries: phase6BoundaryGuarantees()
  };
}

async function readPublicOfficeName({
  projectId, officeId, accessToken, getFirestoreDocument, firestoreFieldsToJs
}) {
  const doc = await getFirestoreDocument({
    projectId,
    segments: ["publicOffices", officeId],
    accessToken,
    allowMissing: true
  });
  if (!doc) return officeId;
  const data = firestoreFieldsToJs(doc.fields || {});
  return String(data.officeName || data.brokerName || officeId).trim() || officeId;
}

async function writeAgreementLibraryEntriesOnAccept({
  projectId,
  accessToken,
  agreementId,
  originatingOfficeId,
  targetOfficeId,
  commissionRate = null,
  getFirestoreDocument,
  setFirestoreDocument,
  firestoreFieldsToJs,
  firestoreHelpers: fh
}) {
  const origin = String(originatingOfficeId || "").trim();
  const target = String(targetOfficeId || "").trim();
  if (!origin || !target || !agreementId) return;
  const [originName, targetName] = await Promise.all([
    readPublicOfficeName({ projectId, officeId: origin, accessToken, getFirestoreDocument, firestoreFieldsToJs }),
    readPublicOfficeName({ projectId, officeId: target, accessToken, getFirestoreDocument, firestoreFieldsToJs })
  ]);
  const now = new Date();
  const baseFields = {
    kind: fh.firestoreString("agreement"),
    agreementId: fh.firestoreString(agreementId),
    fileName: fh.firestoreString("اتفاقية-تعاون.pdf"),
    contentType: fh.firestoreString("application/pdf"),
    mediaPath: fh.firestoreString(""),
    agreementStatus: fh.firestoreString("ACTIVE"),
    commissionRate: commissionRate == null ? null : fh.firestoreInteger(Number(commissionRate) || 0),
    createdAt: fh.firestoreTimestamp(now),
    updatedAt: fh.firestoreTimestamp(now),
    schemaVersion: fh.firestoreInteger(1)
  };
  const originItemId = `lib_agreement_${agreementId}_origin`.slice(0, 180);
  const targetItemId = `lib_agreement_${agreementId}_target`.slice(0, 180);
  await setFirestoreDocument({
    projectId,
    segments: ["offices", origin, "library", originItemId],
    accessToken,
    fields: {
      ...baseFields,
      id: fh.firestoreString(originItemId),
      officeId: fh.firestoreString(origin),
      counterpartOfficeId: fh.firestoreString(target),
      counterpartOfficeName: fh.firestoreString(targetName),
      note: fh.firestoreString(`اتفاقية تعاون مع ${targetName}`)
    }
  });
  await setFirestoreDocument({
    projectId,
    segments: ["offices", target, "library", targetItemId],
    accessToken,
    fields: {
      ...baseFields,
      id: fh.firestoreString(targetItemId),
      officeId: fh.firestoreString(target),
      counterpartOfficeId: fh.firestoreString(origin),
      counterpartOfficeName: fh.firestoreString(originName),
      note: fh.firestoreString(`اتفاقية تعاون مع ${originName}`)
    }
  });
}

export {
  cooperationModeAllowsExplicitRequest,
  cooperationModeAllowsAccept,
  readCooperationMode,
  phase6BoundaryGuarantees,
  firestoreHelpersBundle
};
