import test from "node:test";
import assert from "node:assert/strict";
import { cardActions, communityViews, directActionFor } from "../public/os/domain/community-domain.js";

const ME = "office-a";
const row = (over) => ({
  id: "coop-1", originatingOfficeId: "office-b", originatingOfficeName: "مكتب الأفق", targetOfficeId: ME, targetOfficeName: "مكتبي",
  status: "PENDING", currentStage: "WAITING_PARTNER", originListing: { propertyType: "شقة", purpose: "sale", district: "الوبرة", priceOrBudget: 900000 },
  updatedAt: "2026-10-01T10:00:00.000Z", ...over
});

test("an incoming request needs my answer and offers accept / not suitable", () => {
  const tabs = communityViews([row()], ME);
  assert.equal(tabs.needs.length, 1);
  const a = cardActions(tabs.needs[0]);
  assert.equal(a.primary.action, "ACCEPT");
  assert.equal(a.secondary[0].action, "REJECT");
  assert.equal(a.needsLegacy, false);
});

test("my own outgoing request is waiting, not actionable", () => {
  const tabs = communityViews([row({ originatingOfficeId: ME, originatingOfficeName: "مكتبي", targetOfficeId: "office-b", targetOfficeName: "مكتب الأفق" })], ME);
  assert.equal(tabs.waiting.length, 1);
  assert.equal(tabs.needs.length, 0);
});

test("finished cooperation lands in the done tab; duplicates are merged", () => {
  const tabs = communityViews([row({ status: "ACCEPTED", currentStage: "COMPLETED" }), row({ status: "ACCEPTED", currentStage: "COMPLETED" })], ME);
  assert.equal(tabs.done.length, 1);
});

test("actions that need extra input are not run here", () => {
  assert.equal(directActionFor({ id: "confirm_appointment", label: "تأكيد الموعد" }), null);
  assert.equal(directActionFor({ id: "send_to_owner", label: "إرسال للمالك" }), null);
  const tabs = communityViews([row({ status: "ACCEPTED", currentStage: "APPOINTMENT" })], ME);
  assert.equal(cardActions(tabs.needs[0]).needsLegacy, true);
});
