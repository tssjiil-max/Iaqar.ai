import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNegotiationPanelView,
  buildViewingConfirmationView,
  mergeBrokerUx,
  parseBrokerUxPatch,
  negotiationOpsLine
} from "../public/js/broker-match-ux-domain.js";

test("mergeBrokerUx preserves defaults and applies patch", () => {
  const merged = mergeBrokerUx({}, { ownerPrice: 900000, negotiationStatus: "agreed" });
  assert.equal(merged.ownerPrice, 900000);
  assert.equal(merged.negotiationStatus, "agreed");
  assert.equal(merged.clientViewingConfirmed, false);
});

test("buildViewingConfirmationView flags alert within three hours", () => {
  const now = new Date("2026-08-18T10:00:00.000Z");
  const viewingAt = new Date("2026-08-18T12:00:00.000Z").toISOString();
  const view = buildViewingConfirmationView({
    viewingAt,
    brokerUx: { clientViewingConfirmed: false, ownerViewingConfirmed: true }
  }, now);
  assert.equal(view.needsAlert, true);
  assert.match(view.summaryLine, /عميل ⏳/);
});

test("parseBrokerUxPatch normalizes numeric fields", () => {
  const patch = parseBrokerUxPatch({
    ownerPrice: "850,000",
    clientPrice: "800000",
    lastOffer: "820000",
    negotiationStatus: "in_progress",
    negotiationNote: "  ملاحظة  "
  });
  assert.equal(patch.ownerPrice, 850000);
  assert.equal(patch.clientPrice, 800000);
  assert.equal(patch.negotiationNote, "ملاحظة");
});

test("negotiationOpsLine summarizes prices and status", () => {
  const line = negotiationOpsLine({
    brokerUx: {
      ownerPrice: 900000,
      clientPrice: 850000,
      lastOffer: 875000,
      negotiationStatus: "in_progress"
    }
  });
  assert.match(line, /جاري التفاوض/);
  assert.match(line, /آخر عرض/);
});

test("buildNegotiationPanelView exposes Arabic status label", () => {
  const panel = buildNegotiationPanelView({ brokerUx: { negotiationStatus: "failed" } });
  assert.equal(panel.statusLabel, "فشل");
});
