/**
 * Coordination decision bundles — semantic keys only in storage.
 * Question sets (client-v1 / owner-v1) supply UI labels; resolver compares meaning.
 */

import {
  availableIaqarSlots,
  formatPartySlotLabel,
  slotsOverlap,
  APPOINTMENT_TIME_ZONE
} from "./iaqar-appointment-domain.js";
import { LIVING_TASK_STAGE } from "./match-group-domain.js";

export const COORDINATION_OUTCOME = Object.freeze({
  AWAITING_OTHER_PARTY: "AWAITING_OTHER_PARTY",
  AWAITING_BOTH_PARTIES: "AWAITING_BOTH_PARTIES",
  CLIENT_NOT_INTERESTED: "CLIENT_NOT_INTERESTED",
  PROPERTY_NOT_AVAILABLE: "PROPERTY_NOT_AVAILABLE",
  CLIENT_NEEDS_INFO: "CLIENT_NEEDS_INFO",
  VIEWING_READY: "VIEWING_READY",
  SCHEDULE_CONFLICT: "SCHEDULE_CONFLICT",
  NEEDS_BROKER: "NEEDS_BROKER",
  OWNER_VIEWING_BLOCKED: "OWNER_VIEWING_BLOCKED"
});

export const CLIENT_INTEREST = Object.freeze({
  INTERESTED: "interested",
  NOT_SUITABLE: "not_suitable"
});

export const CLIENT_NEXT_ACTION = Object.freeze({
  VIEWING: "viewing",
  MORE_INFO: "more_info",
  NONE: "none"
});

export const OWNER_AVAILABILITY = Object.freeze({
  AVAILABLE: "available",
  NOT_AVAILABLE: "not_available"
});

export const OWNER_VIEWING_ALLOWED = Object.freeze({
  YES: "yes",
  NO: "no",
  NEEDS_COORDINATION: "needs_coordination"
});

export const CLIENT_INFO_NEEDS = Object.freeze({
  PRICE: "price",
  LOCATION: "location",
  PHOTOS: "photos",
  SPECS: "specs",
  OTHER: "other"
});

/** Relative viewing window ids — resolved to ISO start times in Asia/Riyadh */
export const VIEWING_WINDOW_IDS = Object.freeze([
  "today_evening",
  "tomorrow_morning",
  "tomorrow_evening",
  "day2_morning",
  "day2_evening"
]);

export const QUESTION_SET_VERSIONS = Object.freeze({
  CLIENT_V1: "client-v1",
  OWNER_V1: "owner-v1"
});

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function riyadhParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: APPOINTMENT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hour12: false
  });
  const parts = fmt.formatToParts(now);
  const pick = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour")
  };
}

function riyadhDateAt({ year, month, day, hour = 0, minute = 0 }) {
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const offsetLabel = probe.toLocaleString("en-US", {
    timeZone: APPOINTMENT_TIME_ZONE,
    timeZoneName: "shortOffset"
  });
  const match = offsetLabel.match(/GMT([+-]\d+)/);
  const offsetHours = match ? Number(match[1]) : 3;
  return new Date(Date.UTC(year, month - 1, day, hour - offsetHours, minute, 0)).toISOString();
}

export function resolveViewingWindowStart(windowId = "", now = new Date()) {
  const id = text(windowId);
  const { year, month, day } = riyadhParts(now);
  if (id === "today_evening") return riyadhDateAt({ year, month, day, hour: 18 });
  if (id === "tomorrow_morning") {
    const d = new Date(Date.UTC(year, month - 1, day + 1));
    return riyadhDateAt({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: 10 });
  }
  if (id === "tomorrow_evening") {
    const d = new Date(Date.UTC(year, month - 1, day + 1));
    return riyadhDateAt({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: 18 });
  }
  if (id === "day2_morning") {
    const d = new Date(Date.UTC(year, month - 1, day + 2));
    return riyadhDateAt({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: 10 });
  }
  if (id === "day2_evening") {
    const d = new Date(Date.UTC(year, month - 1, day + 2));
    return riyadhDateAt({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: 18 });
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(id)) return id;
  return "";
}

export function viewingWindowOptions(now = new Date()) {
  return VIEWING_WINDOW_IDS.map((id) => {
    const startAt = resolveViewingWindowStart(id, now);
    const labels = formatPartySlotLabel(startAt);
    return {
      id,
      startAt,
      label: labels.buttonLabel || id,
      dayLabel: labels.dayLabel,
      timeLabel: labels.timeLabel
    };
  }).filter((row) => row.startAt);
}

export const CLIENT_QUESTION_SET_V1 = Object.freeze({
  version: QUESTION_SET_VERSIONS.CLIENT_V1,
  party: "client",
  steps: Object.freeze([
    Object.freeze({
      field: "interest",
      type: "choice",
      required: true,
      options: Object.freeze([
        Object.freeze({ value: CLIENT_INTEREST.INTERESTED, label: "مهتم" }),
        Object.freeze({ value: CLIENT_INTEREST.NOT_SUITABLE, label: "غير مناسب" })
      ])
    }),
    Object.freeze({
      field: "nextAction",
      type: "choice",
      required: true,
      when: { interest: CLIENT_INTEREST.INTERESTED },
      options: Object.freeze([
        Object.freeze({ value: CLIENT_NEXT_ACTION.VIEWING, label: "أرغب بمعاينة العقار" }),
        Object.freeze({ value: CLIENT_NEXT_ACTION.MORE_INFO, label: "أحتاج معلومات إضافية" }),
        Object.freeze({ value: CLIENT_NEXT_ACTION.NONE, label: "المعلومات الحالية كافية" })
      ])
    }),
    Object.freeze({
      field: "viewingWindows",
      type: "multi",
      required: true,
      when: { interest: CLIENT_INTEREST.INTERESTED, nextAction: CLIENT_NEXT_ACTION.VIEWING },
      optionsFrom: "viewingWindows"
    }),
    Object.freeze({
      field: "infoNeeds",
      type: "multi",
      required: true,
      when: { interest: CLIENT_INTEREST.INTERESTED, nextAction: CLIENT_NEXT_ACTION.MORE_INFO },
      options: Object.freeze([
        Object.freeze({ value: CLIENT_INFO_NEEDS.PRICE, label: "السعر" }),
        Object.freeze({ value: CLIENT_INFO_NEEDS.LOCATION, label: "الموقع" }),
        Object.freeze({ value: CLIENT_INFO_NEEDS.PHOTOS, label: "الصور" }),
        Object.freeze({ value: CLIENT_INFO_NEEDS.SPECS, label: "المواصفات" }),
        Object.freeze({ value: CLIENT_INFO_NEEDS.OTHER, label: "تفاصيل أخرى" })
      ])
    })
  ])
});

export const OWNER_QUESTION_SET_V1 = Object.freeze({
  version: QUESTION_SET_VERSIONS.OWNER_V1,
  party: "owner",
  steps: Object.freeze([
    Object.freeze({
      field: "propertyAvailability",
      type: "choice",
      required: true,
      options: Object.freeze([
        Object.freeze({ value: OWNER_AVAILABILITY.AVAILABLE, label: "العقار متاح" }),
        Object.freeze({ value: OWNER_AVAILABILITY.NOT_AVAILABLE, label: "غير متاح حالياً" })
      ])
    }),
    Object.freeze({
      field: "viewingAllowed",
      type: "choice",
      required: true,
      when: { propertyAvailability: OWNER_AVAILABILITY.AVAILABLE },
      options: Object.freeze([
        Object.freeze({ value: OWNER_VIEWING_ALLOWED.YES, label: "المعاينة متاحة" }),
        Object.freeze({ value: OWNER_VIEWING_ALLOWED.NEEDS_COORDINATION, label: "المعاينة تحتاج تنسيق مسبق" }),
        Object.freeze({ value: OWNER_VIEWING_ALLOWED.NO, label: "المعاينة غير متاحة" })
      ])
    }),
    Object.freeze({
      field: "viewingWindows",
      type: "multi",
      required: true,
      when: {
        propertyAvailability: OWNER_AVAILABILITY.AVAILABLE,
        viewingAllowed: OWNER_VIEWING_ALLOWED.YES
      },
      optionsFrom: "viewingWindows"
    }),
    Object.freeze({
      field: "coordinationRequired",
      type: "boolean",
      required: false,
      when: {
        propertyAvailability: OWNER_AVAILABILITY.AVAILABLE,
        viewingAllowed: OWNER_VIEWING_ALLOWED.NEEDS_COORDINATION
      },
      label: "أحتاج تنسيقًا مسبقًا مع الوسيط قبل المعاينة"
    })
  ])
});

export function questionSetForParty(party = "client", version = "") {
  const side = party === "owner" ? "owner" : "client";
  const ver = text(version);
  if (side === "owner") {
    return ver === QUESTION_SET_VERSIONS.OWNER_V1 ? OWNER_QUESTION_SET_V1 : OWNER_QUESTION_SET_V1;
  }
  return ver === QUESTION_SET_VERSIONS.CLIENT_V1 ? CLIENT_QUESTION_SET_V1 : CLIENT_QUESTION_SET_V1;
}

function stepVisible(step = {}, values = {}) {
  const when = step.when;
  if (!when || typeof when !== "object") return true;
  return Object.entries(when).every(([key, expected]) => text(values[key]) === text(expected));
}

export function buildCoordinationFormView(party = "client", {
  questionSetVersion = "",
  submitted = false,
  bundleSummary = "",
  now = new Date()
} = {}) {
  const side = party === "owner" ? "owner" : "client";
  const set = questionSetForParty(side, questionSetVersion);
  const windowOpts = viewingWindowOptions(now).map((row) => ({
    value: row.id,
    label: row.label
  }));
  const steps = set.steps
    .filter((step) => stepVisible(step, {}))
    .map((step) => {
      const options = step.optionsFrom === "viewingWindows"
        ? windowOpts
        : (step.options || []).map((opt) => ({ value: opt.value, label: opt.label }));
      return {
        field: step.field,
        type: step.type,
        required: Boolean(step.required),
        label: text(step.label),
        options,
        when: step.when || null
      };
    });
  return {
    mode: "coordination_bundle",
    party: side,
    questionSetVersion: set.version,
    submitted: Boolean(submitted),
    bundleSummary: text(bundleSummary),
    steps
  };
}

function normalizeWindowIds(ids = []) {
  return [...new Set((Array.isArray(ids) ? ids : []).map((id) => text(id)).filter(Boolean))];
}

export function normalizeClientBundle(raw = {}) {
  const interest = text(raw.interest);
  const nextAction = text(raw.nextAction);
  const viewingWindows = normalizeWindowIds(raw.viewingWindows);
  const infoNeeds = normalizeWindowIds(raw.infoNeeds);
  const bundle = {
    version: QUESTION_SET_VERSIONS.CLIENT_V1,
    interest,
    nextAction: "",
    viewingWindows: [],
    infoNeeds: [],
    submittedAt: text(raw.submittedAt)
  };
  if (interest === CLIENT_INTEREST.NOT_SUITABLE) return bundle;
  if (interest !== CLIENT_INTEREST.INTERESTED) return null;
  bundle.nextAction = nextAction;
  if (nextAction === CLIENT_NEXT_ACTION.VIEWING) {
    if (!viewingWindows.length) return null;
    bundle.viewingWindows = viewingWindows;
    return bundle;
  }
  if (nextAction === CLIENT_NEXT_ACTION.MORE_INFO) {
    if (!infoNeeds.length) return null;
    bundle.infoNeeds = infoNeeds;
    return bundle;
  }
  if (nextAction === CLIENT_NEXT_ACTION.NONE) return bundle;
  return null;
}

export function normalizeOwnerBundle(raw = {}) {
  const propertyAvailability = text(raw.propertyAvailability);
  const bundle = {
    version: QUESTION_SET_VERSIONS.OWNER_V1,
    propertyAvailability,
    viewingAllowed: "",
    viewingWindows: [],
    coordinationRequired: false,
    submittedAt: text(raw.submittedAt)
  };
  if (propertyAvailability === OWNER_AVAILABILITY.NOT_AVAILABLE) return bundle;
  if (propertyAvailability !== OWNER_AVAILABILITY.AVAILABLE) return null;
  const viewingAllowed = text(raw.viewingAllowed);
  bundle.viewingAllowed = viewingAllowed;
  if (viewingAllowed === OWNER_VIEWING_ALLOWED.NO) return bundle;
  if (viewingAllowed === OWNER_VIEWING_ALLOWED.NEEDS_COORDINATION) {
    bundle.coordinationRequired = Boolean(raw.coordinationRequired);
    return bundle;
  }
  if (viewingAllowed === OWNER_VIEWING_ALLOWED.YES) {
    const windows = normalizeWindowIds(raw.viewingWindows);
    if (!windows.length) return null;
    bundle.viewingWindows = windows;
    return bundle;
  }
  return null;
}

function windowsOverlap(clientWindows = [], ownerWindows = [], now = new Date()) {
  const clientStarts = clientWindows.map((id) => resolveViewingWindowStart(id, now)).filter(Boolean);
  const ownerStarts = ownerWindows.map((id) => resolveViewingWindowStart(id, now)).filter(Boolean);
  for (const left of clientStarts) {
    for (const right of ownerStarts) {
      if (slotsOverlap(left, right)) return true;
    }
  }
  return false;
}

export function clientBundleSummary(bundle = {}) {
  if (!bundle || !bundle.interest) return "";
  if (bundle.interest === CLIENT_INTEREST.NOT_SUITABLE) return "غير مناسب";
  if (bundle.nextAction === CLIENT_NEXT_ACTION.VIEWING) {
    const count = (bundle.viewingWindows || []).length;
    return count ? `مهتم · معاينة · ${count} وقت` : "مهتم · معاينة";
  }
  if (bundle.nextAction === CLIENT_NEXT_ACTION.MORE_INFO) {
    return "مهتم · يحتاج معلومات";
  }
  if (bundle.nextAction === CLIENT_NEXT_ACTION.NONE) return "مهتم · المعلومات كافية";
  return "مهتم";
}

export function ownerBundleSummary(bundle = {}) {
  if (!bundle || !bundle.propertyAvailability) return "";
  if (bundle.propertyAvailability === OWNER_AVAILABILITY.NOT_AVAILABLE) return "غير متاح";
  if (bundle.viewingAllowed === OWNER_VIEWING_ALLOWED.NO) return "متاح · بدون معاينة";
  if (bundle.viewingAllowed === OWNER_VIEWING_ALLOWED.NEEDS_COORDINATION) {
    return bundle.coordinationRequired ? "متاح · تنسيق مسبق" : "متاح · تنسيق مسبق";
  }
  if (bundle.viewingAllowed === OWNER_VIEWING_ALLOWED.YES) {
    const count = (bundle.viewingWindows || []).length;
    return count ? `متاح · معاينة · ${count} وقت` : "متاح · معاينة";
  }
  return "متاح";
}

export function resolveCoordinationOutcome({
  clientBundle = null,
  ownerBundle = null,
  now = new Date()
} = {}) {
  if (!clientBundle && !ownerBundle) {
    return {
      outcome: COORDINATION_OUTCOME.AWAITING_BOTH_PARTIES,
      brokerLine: "بانتظار رد العميل والمالك",
      conflictField: ""
    };
  }
  if (!clientBundle || !ownerBundle) {
    return {
      outcome: COORDINATION_OUTCOME.AWAITING_OTHER_PARTY,
      brokerLine: clientBundle ? "بانتظار رد المالك" : "بانتظار رد العميل",
      conflictField: ""
    };
  }
  if (clientBundle.interest === CLIENT_INTEREST.NOT_SUITABLE) {
    return {
      outcome: COORDINATION_OUTCOME.CLIENT_NOT_INTERESTED,
      brokerLine: "العميل غير مهتم",
      conflictField: ""
    };
  }
  if (ownerBundle.propertyAvailability === OWNER_AVAILABILITY.NOT_AVAILABLE) {
    return {
      outcome: COORDINATION_OUTCOME.PROPERTY_NOT_AVAILABLE,
      brokerLine: "العقار غير متاح",
      conflictField: ""
    };
  }
  if (clientBundle.nextAction === CLIENT_NEXT_ACTION.MORE_INFO) {
    return {
      outcome: COORDINATION_OUTCOME.CLIENT_NEEDS_INFO,
      brokerLine: "العميل يحتاج معلومات إضافية",
      conflictField: "infoNeeds"
    };
  }
  if (clientBundle.nextAction === CLIENT_NEXT_ACTION.NONE) {
    return {
      outcome: COORDINATION_OUTCOME.AWAITING_OTHER_PARTY,
      brokerLine: "العميل مهتم — بانتظار المالك",
      conflictField: ""
    };
  }
  if (clientBundle.nextAction === CLIENT_NEXT_ACTION.VIEWING) {
    if (ownerBundle.viewingAllowed === OWNER_VIEWING_ALLOWED.NO) {
      return {
        outcome: COORDINATION_OUTCOME.OWNER_VIEWING_BLOCKED,
        brokerLine: "المالك لا يقبل معاينة",
        conflictField: "viewingAllowed"
      };
    }
    if (ownerBundle.viewingAllowed === OWNER_VIEWING_ALLOWED.NEEDS_COORDINATION) {
      return {
        outcome: COORDINATION_OUTCOME.NEEDS_BROKER,
        brokerLine: "المعاينة تحتاج تنسيق مسبق مع المالك",
        conflictField: "coordinationRequired"
      };
    }
    if (ownerBundle.viewingAllowed === OWNER_VIEWING_ALLOWED.YES) {
      if (windowsOverlap(clientBundle.viewingWindows, ownerBundle.viewingWindows, now)) {
        return {
          outcome: COORDINATION_OUTCOME.VIEWING_READY,
          brokerLine: "جاهز لتنسيق المعاينة",
          conflictField: ""
        };
      }
      return {
        outcome: COORDINATION_OUTCOME.SCHEDULE_CONFLICT,
        brokerLine: "تعارض في مواعيد المعاينة",
        conflictField: "viewingWindows"
      };
    }
  }
  return {
    outcome: COORDINATION_OUTCOME.NEEDS_BROKER,
    brokerLine: "يحتاج تدخل الوسيط",
    conflictField: ""
  };
}

export function livingStageForCoordinationOutcome(outcome = "") {
  const key = text(outcome);
  if (key === COORDINATION_OUTCOME.CLIENT_NOT_INTERESTED) {
    return { stage: LIVING_TASK_STAGE.CLIENT_REJECTED, ownerContactNeeded: false };
  }
  if (key === COORDINATION_OUTCOME.PROPERTY_NOT_AVAILABLE) {
    return { stage: LIVING_TASK_STAGE.PROPERTY_UNAVAILABLE, ownerContactNeeded: false };
  }
  if (key === COORDINATION_OUTCOME.CLIENT_NEEDS_INFO) {
    return { stage: LIVING_TASK_STAGE.CLIENT_NEEDS_DETAILS, ownerContactNeeded: false };
  }
  if (key === COORDINATION_OUTCOME.VIEWING_READY) {
    return { stage: LIVING_TASK_STAGE.APPOINTMENT_COORDINATION, ownerContactNeeded: false };
  }
  if (key === COORDINATION_OUTCOME.SCHEDULE_CONFLICT) {
    return { stage: LIVING_TASK_STAGE.APPOINTMENT_COORDINATION, ownerContactNeeded: false };
  }
  if (key === COORDINATION_OUTCOME.NEEDS_BROKER
    || key === COORDINATION_OUTCOME.OWNER_VIEWING_BLOCKED) {
    return { stage: LIVING_TASK_STAGE.WAITING_PROPERTY_CONFIRMATION, ownerContactNeeded: true };
  }
  if (key === COORDINATION_OUTCOME.AWAITING_BOTH_PARTIES) {
    return { stage: LIVING_TASK_STAGE.MATCH_FOUND, ownerContactNeeded: false };
  }
  if (key === COORDINATION_OUTCOME.AWAITING_OTHER_PARTY) {
    return { stage: LIVING_TASK_STAGE.MATCH_FOUND, ownerContactNeeded: false };
  }
  return { stage: LIVING_TASK_STAGE.MATCH_FOUND, ownerContactNeeded: false };
}

export function coordinationOutcomeLabel(outcome = "") {
  const map = {
    [COORDINATION_OUTCOME.AWAITING_BOTH_PARTIES]: "بانتظار رد الأطراف",
    [COORDINATION_OUTCOME.AWAITING_OTHER_PARTY]: "بانتظار رد أحد الأطراف",
    [COORDINATION_OUTCOME.CLIENT_NOT_INTERESTED]: "العميل غير مهتم",
    [COORDINATION_OUTCOME.PROPERTY_NOT_AVAILABLE]: "العقار غير متاح",
    [COORDINATION_OUTCOME.CLIENT_NEEDS_INFO]: "العميل يحتاج معلومات",
    [COORDINATION_OUTCOME.VIEWING_READY]: "جاهز لتنسيق المعاينة",
    [COORDINATION_OUTCOME.SCHEDULE_CONFLICT]: "تعارض في الموعد",
    [COORDINATION_OUTCOME.NEEDS_BROKER]: "يحتاج تدخل الوسيط",
    [COORDINATION_OUTCOME.OWNER_VIEWING_BLOCKED]: "المعاينة غير متاحة من المالك"
  };
  return map[outcome] || "";
}

/** Map legacy single-action replies into bundle semantics for mixed records */
export function bundleFromLegacyReply(party = "client", replyAction = "", followUpAction = "") {
  const primary = text(replyAction);
  const follow = text(followUpAction);
  const now = new Date().toISOString();
  if (party === "owner") {
    if (primary === "property_available") {
      return normalizeOwnerBundle({
        propertyAvailability: OWNER_AVAILABILITY.AVAILABLE,
        viewingAllowed: OWNER_VIEWING_ALLOWED.NEEDS_COORDINATION,
        coordinationRequired: true,
        submittedAt: now
      });
    }
    if (primary === "not_available") {
      return normalizeOwnerBundle({ propertyAvailability: OWNER_AVAILABILITY.NOT_AVAILABLE, submittedAt: now });
    }
    return null;
  }
  if (primary === "not_suitable") {
    return normalizeClientBundle({ interest: CLIENT_INTEREST.NOT_SUITABLE, submittedAt: now });
  }
  if (primary === "needs_details") {
    return normalizeClientBundle({
      interest: CLIENT_INTEREST.INTERESTED,
      nextAction: CLIENT_NEXT_ACTION.MORE_INFO,
      infoNeeds: [CLIENT_INFO_NEEDS.OTHER],
      submittedAt: now
    });
  }
  if (primary === "interested") {
    if (follow === "want_viewing") {
      return normalizeClientBundle({
        interest: CLIENT_INTEREST.INTERESTED,
        nextAction: CLIENT_NEXT_ACTION.VIEWING,
        viewingWindows: ["tomorrow_evening"],
        submittedAt: now
      });
    }
    return normalizeClientBundle({
      interest: CLIENT_INTEREST.INTERESTED,
      nextAction: CLIENT_NEXT_ACTION.NONE,
      submittedAt: now
    });
  }
  return null;
}

export function validateBundleForParty(party = "client", raw = {}) {
  return party === "owner" ? normalizeOwnerBundle(raw) : normalizeClientBundle(raw);
}
