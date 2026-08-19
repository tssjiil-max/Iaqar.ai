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
  brokerActionDoneClass
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

test("brokerActionDoneClass marks completed actions", () => {
  const record = {
    brokerActionProgress: {
      [followUpOutcomeActionKey("no_response")]: "2026-08-18T12:00:00.000Z"
    }
  };
  assert.equal(isBrokerActionDone(record, followUpOutcomeActionKey("no_response")), true);
  assert.equal(brokerActionDoneClass(record, followUpOutcomeActionKey("no_response")), " is-action-done");
});
