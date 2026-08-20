import test from "node:test";
import assert from "node:assert/strict";
import {
  scanBrokerAlerts,
  scanViewingConfirmationAlerts
} from "../public/js/broker-alerts-domain.js";

test("scanViewingConfirmationAlerts finds unconfirmed viewing soon", () => {
  const now = new Date("2026-08-18T10:00:00.000Z");
  const items = [{
    id: "m1",
    recordId: "m1",
    recordType: "match",
    status: "viewing",
    viewingAt: new Date("2026-08-18T12:00:00.000Z").toISOString(),
    brokerUx: { clientViewingConfirmed: false, ownerViewingConfirmed: false }
  }];
  const alerts = scanViewingConfirmationAlerts(items, now);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].alertKind, "viewing_unconfirmed");
});

test("scanBrokerAlerts deduplicates by kind and record", () => {
  const now = new Date("2026-08-18T10:00:00.000Z");
  const items = [{
    id: "d1",
    recordId: "d1",
    recordType: "deal",
    status: "open",
    workflowStage: "negotiation",
    healthKey: "at_risk",
    nextFollowUpAt: new Date("2026-08-17T10:00:00.000Z").toISOString()
  }];
  const alerts = scanBrokerAlerts(items, now);
  assert.ok(alerts.length >= 1);
  const kinds = new Set(alerts.map((alert) => alert.alertKind));
  assert.ok(kinds.has("deal_at_risk"));
});
