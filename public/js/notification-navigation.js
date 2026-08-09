/**
 * Deep-link routing for push/in-app notifications (classic scripts + service worker).
 */
(function () {
  "use strict";

  function safeId(value) {
    return String(value || "").trim();
  }

  function buildNotificationTargetFromData(data = {}) {
    const type = safeId(data.type || data.notificationType).toLowerCase();
    const recordId = safeId(data.recordId || data.matchId || data.dealId);
    const entityType = safeId(data.entityType).toLowerCase();
    const entityId = safeId(data.entityId || recordId);
    const officeId = safeId(data.officeId);
    const targetPath = safeId(data.targetPath || data.actionUrl);

    if (targetPath.startsWith("/")) {
      return { kind: "url", path: targetPath, officeId };
    }

    if (entityType === "opportunity" || entityId.startsWith("opp_")) {
      return { kind: "opportunity", id: entityId, officeId };
    }
    if (entityType === "cooperation" || type.includes("cooperation") || recordId.startsWith("coop_")) {
      return { kind: "cooperation", id: recordId, officeId };
    }
    if (entityType === "message" || type === "message" || type === "conversation") {
      return { kind: "message", id: recordId, officeId };
    }
    if (type === "deal" || data.dealId) {
      return { kind: "deal", id: safeId(data.dealId) || recordId, officeId };
    }
    if (recordId.startsWith("opp_")) {
      return { kind: "opportunity", id: recordId, officeId };
    }
    if (recordId.startsWith("coop_")) {
      return { kind: "cooperation", id: recordId, officeId };
    }
    if (type === "match" && recordId && !recordId.startsWith("op_")) {
      return { kind: "match", id: recordId, officeId };
    }
    if (recordId.startsWith("op_") || type === "operation" || type === "missing_data" || type === "followup") {
      return { kind: "operation", id: recordId, officeId };
    }
    if (type === "broker_application") {
      return { kind: "admin", id: recordId, officeId };
    }
    if (recordId) {
      return { kind: "operation", id: recordId, officeId };
    }
    return { kind: "center", officeId };
  }

  function parseNotificationSearchParams(params) {
    if (!params) return null;
    const officeId = safeId(params.get("officeId") || params.get("office"));
    const openOpportunity = safeId(params.get("openOpportunity"));
    const openCooperation = safeId(params.get("openCooperation"));
    const openMessage = safeId(params.get("openMessage"));
    const openDeal = safeId(params.get("openDeal"));
    const openMatch = safeId(params.get("openMatch"));
    const openOperation = safeId(params.get("openOperation"));

    if (openOpportunity) return { kind: "opportunity", id: openOpportunity, officeId };
    if (openCooperation) return { kind: "cooperation", id: openCooperation, officeId };
    if (openMessage) return { kind: "message", id: openMessage, officeId };
    if (openDeal) return { kind: "deal", id: openDeal, officeId };
    if (openMatch) {
      if (openMatch.startsWith("opp_")) return { kind: "opportunity", id: openMatch, officeId };
      return { kind: "match", id: openMatch, officeId };
    }
    if (openOperation) {
      if (openOperation.startsWith("opp_")) return { kind: "opportunity", id: openOperation, officeId };
      if (openOperation.startsWith("coop_")) return { kind: "cooperation", id: openOperation, officeId };
      return { kind: "operation", id: openOperation, officeId };
    }
    if (params.get("openNotifications") === "1") return { kind: "center", officeId };
    if (params.get("adminApplications") === "1") {
      return { kind: "admin", id: safeId(params.get("openBrokerApplication")), officeId };
    }
    return null;
  }

  function buildNotificationRelativeUrl(data = {}) {
    const target = buildNotificationTargetFromData(data);
    const params = new URLSearchParams();
    if (target.officeId === "platform") params.set("office", "platform");
    else if (target.officeId) params.set("officeId", target.officeId);

    switch (target.kind) {
      case "url":
        return target.path || "/";
      case "opportunity":
        if (target.id) params.set("openOpportunity", target.id);
        else params.set("openNotifications", "1");
        break;
      case "cooperation":
        if (target.id) params.set("openCooperation", target.id);
        else params.set("openNotifications", "1");
        break;
      case "message":
        if (target.id) params.set("openMessage", target.id);
        else params.set("openNotifications", "1");
        break;
      case "deal":
        if (target.id) params.set("openDeal", target.id);
        break;
      case "match":
        if (target.id) params.set("openMatch", target.id);
        break;
      case "operation":
        if (target.id) params.set("openOperation", target.id);
        break;
      case "admin":
        params.set("adminApplications", "1");
        if (target.id) params.set("openBrokerApplication", target.id);
        break;
      case "center":
      default:
        params.set("openNotifications", "1");
        break;
    }
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  }

  window.IAQAR = window.IAQAR || {};
  window.IAQAR.buildNotificationTargetFromData = buildNotificationTargetFromData;
  window.IAQAR.parseNotificationSearchParams = parseNotificationSearchParams;
  window.IAQAR.buildNotificationRelativeUrl = buildNotificationRelativeUrl;
})();
