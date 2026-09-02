import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOpportunityCardView } from "../public/js/opportunity-card-domain.js";

test("buildOpportunityCardView masks phone and omits fake match score", () => {
  const card = buildOpportunityCardView({
    id: "opp_1",
    opportunityKind: "REQUEST",
    purpose: "PURCHASE",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العوالي",
    budget: 400000,
    area: 120,
    contactName: "محمد",
    advertiserPhoneNormalized: "+966552019909",
    source: "whatsapp"
  });
  assert.equal(card.kindBadge, "طلب عميل");
  assert.match(card.contactLine, /محمد/);
  assert.match(card.contactLine, /055/);
  assert.match(card.contactLine, /•••/);
  assert.equal(card.bestMatchScore, null);
  assert.equal(card.bestMatchScoreText, "");
});

test("buildOpportunityCardView shows real match score only when computed", () => {
  const card = buildOpportunityCardView(
    { id: "opp_2", propertyType: "فيلا", bestMatchScore: 84, bestMatchComputed: true },
    { bestMatchComputed: true, bestMatchScore: 84 }
  );
  assert.equal(card.bestMatchScore, 84);
  assert.equal(card.bestMatchScoreText, "84%");
});

test("opportunity card distinguishes owner rent from client lease request", () => {
  const owner = buildOpportunityCardView({ opportunityKind: "OFFER", purpose: "RENT", propertyType: "شقة" });
  const client = buildOpportunityCardView({ opportunityKind: "REQUEST", purpose: "LEASE_REQUEST", propertyType: "شقة" });
  assert.equal(owner.description, "شقة للإيجار");
  assert.equal(client.description, "شقة للاستئجار");
});
