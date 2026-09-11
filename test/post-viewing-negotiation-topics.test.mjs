import test from "node:test";
import assert from "node:assert/strict";
import { postViewingNegotiationTopics } from "../public/js/negotiation-management-domain.js";

test("rental apartment keeps the approved four compact negotiation topics", () => {
  assert.deepEqual(
    postViewingNegotiationTopics({ propertyType: "شقة", purpose: "إيجار" }).map((item) => item.label),
    ["السعر", "التجهيزات", "شرط آخر", "معاينة أخرى"]
  );
});

test("land reuses the same engine with land-appropriate terms", () => {
  assert.deepEqual(
    postViewingNegotiationTopics({ propertyType: "أرض", purpose: "بيع" }).map((item) => item.label),
    ["السعر", "شروط الصفقة", "شرط آخر", "معاينة أخرى"]
  );
});

test("unknown property types stay compact and do not grow a separate questionnaire", () => {
  const topics = postViewingNegotiationTopics({ propertyType: "أخرى", purpose: "بيع" });
  assert.equal(topics.length, 4);
  assert.deepEqual(topics.map((item) => item.label), ["السعر", "الشروط", "شرط آخر", "معاينة أخرى"]);
});

test("returned topic arrays are isolated copies", () => {
  const first = postViewingNegotiationTopics({ propertyType: "فيلا", purpose: "بيع" });
  first[0].label = "changed";
  const second = postViewingNegotiationTopics({ propertyType: "فيلا", purpose: "بيع" });
  assert.equal(second[0].label, "السعر");
});
