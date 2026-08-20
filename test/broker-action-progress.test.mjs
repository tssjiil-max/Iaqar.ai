import test from "node:test";
import assert from "node:assert/strict";
import {
  BROKER_ACTION,
  mergeBrokerActionProgress,
  resolveCompletedBrokerActionKeys,
  contactOutcomeActionKey,
  followUpOutcomeActionKey,
  followUpWhatsAppActionKey,
  partyActionKey,
  hubShareOptionActionKey,
  workspacePrimaryActionKey,
  isBrokerActionDone,
  brokerActionDoneClass,
  hasRecentBrokerAction,
  latestBrokerActionAtMs
} from "../public/js/broker-action-progress-domain.js";

test("mergeBrokerActionProgress stores action keys with timestamps", () => {
  const merged = mergeBrokerActionProgress({}, BROKER_ACTION.contactWhatsApp, "2026-08-18T12:00:00.000Z");
  assert.equal(merged[BROKER_ACTION.contactWhatsApp], "2026-08-18T12:00:00.000Z");
});

test("resolveCompletedBrokerActionKeys derives contact and follow-up progress", () => {
  const keys = resolveCompletedBrokerActionKeys({
    lastWhatsAppOpenedAt: "2026-08-18T12:00:00.000Z",
    lastContactOutcome: "INTERESTED",
    followUp: {
      at: "2026-08-19T10:00:00.000Z",
      status: "completed",
      confirmationOutcome: "confirmed",
      whatsappRolesOpened: ["owner"]
    }
  });
  assert.ok(keys.has(BROKER_ACTION.contactWhatsApp));
  assert.ok(keys.has(contactOutcomeActionKey("INTERESTED")));
  assert.ok(keys.has(BROKER_ACTION.followUpScheduled));
  assert.ok(keys.has(BROKER_ACTION.followUpComplete));
  assert.ok(keys.has(followUpOutcomeActionKey("confirmed")));
  assert.ok(keys.has(followUpWhatsAppActionKey("owner")));
});

test("action key helpers map UI ids consistently", () => {
  assert.equal(partyActionKey("party_whatsapp"), BROKER_ACTION.partyWhatsApp);
  assert.equal(partyActionKey("party_request_media"), "party:party_request_media");
  assert.equal(hubShareOptionActionKey("copy_listing_text"), BROKER_ACTION.hubCopyListing);
  assert.equal(workspacePrimaryActionKey("search_matches"), BROKER_ACTION.workspaceSearchMatches);
});

test("mergeBrokerActionProgress replaces prior contact outcome keys", () => {
  const first = mergeBrokerActionProgress({}, contactOutcomeActionKey("REFUSED"), "2026-08-18T12:00:00.000Z");
  const second = mergeBrokerActionProgress(
    { brokerActionProgress: first },
    contactOutcomeActionKey("FOLLOW_UP"),
    "2026-08-18T13:00:00.000Z"
  );
  assert.equal(second[contactOutcomeActionKey("REFUSED")], undefined);
  assert.equal(second[contactOutcomeActionKey("FOLLOW_UP")], "2026-08-18T13:00:00.000Z");
});

test("resolveCompletedBrokerActionKeys keeps only current contact outcome checkmark", () => {
  const keys = resolveCompletedBrokerActionKeys({
    brokerActionProgress: {
      [contactOutcomeActionKey("REFUSED")]: "2026-08-18T12:00:00.000Z",
      [contactOutcomeActionKey("FOLLOW_UP")]: "2026-08-18T13:00:00.000Z"
    },
    lastContactOutcome: "FOLLOW_UP"
  });
  assert.equal(keys.has(contactOutcomeActionKey("REFUSED")), false);
  assert.equal(keys.has(contactOutcomeActionKey("FOLLOW_UP")), true);
});

test("brokerActionDoneClass marks completed actions", () => {
  const record = {
    brokerActionProgress: {
      [followUpOutcomeActionKey("no_response")]: "2026-08-18T12:00:00.000Z"
    }
  };
  assert.equal(isBrokerActionDone(record, followUpOutcomeActionKey("no_response")), true);
  assert.equal(brokerActionDoneClass(record, followUpOutcomeActionKey("no_response")), " is-action-done");
});

test("hasRecentBrokerAction is true only within 12 hours of an action", () => {
  const now = Date.parse("2026-08-20T12:00:00.000Z");
  const recent = {
    brokerActionProgress: {
      [BROKER_ACTION.contactWhatsApp]: "2026-08-20T06:00:00.000Z"
    }
  };
  const stale = {
    brokerActionProgress: {
      [BROKER_ACTION.contactWhatsApp]: "2026-08-19T11:00:00.000Z"
    }
  };
  const viewedOnly = { id: "opp_1", city: "المدينة المنورة" };
  assert.equal(hasRecentBrokerAction(recent, now), true);
  assert.equal(hasRecentBrokerAction(stale, now), false);
  assert.equal(hasRecentBrokerAction(viewedOnly, now), false);
  assert.equal(latestBrokerActionAtMs(recent), Date.parse("2026-08-20T06:00:00.000Z"));
});

test("hasRecentBrokerAction uses WhatsApp/call stamps without progress map", () => {
  const now = Date.parse("2026-08-20T12:00:00.000Z");
  assert.equal(hasRecentBrokerAction({ lastWhatsAppOpenedAt: "2026-08-20T08:00:00.000Z" }, now), true);
  assert.equal(hasRecentBrokerAction({ lastCallOpenedAt: "2026-08-20T01:00:00.000Z" }, now), true);
  assert.equal(hasRecentBrokerAction({ lastCallOpenedAt: "2026-08-19T11:59:00.000Z" }, now), false);
});
