import test from "node:test";
import assert from "node:assert/strict";
import { loadShell } from "./helpers/shell.mjs";

function assertNoDropdowns(root, fieldNames = []) {
  for (const name of fieldNames) {
    const select = root.querySelector(`select[name="${name}"]`);
    assert.equal(select, null, `select[name="${name}"] must not exist`);
    const input = root.querySelector(`input[name="${name}"]`);
    assert.ok(input, `input[name="${name}"] must exist`);
    assert.equal(input.tagName, "INPUT");
    assert.equal(root.querySelector(`datalist[id="${name}"]`), null);
  }
  assert.equal(root.querySelector(".search-select-list"), null);
  assert.equal(root.querySelector(".arabic-suggest-list"), null);
}

test("add opportunity review renders plain text location fields", async () => {
  const user = { uid: "broker-a", getIdToken: async () => "token" };
  const context = await loadShell({
    bootSettingsModule: false,
    firebase: { auth: () => ({ currentUser: user }), firestore: () => null },
    officeRuntime: { officeId: "office-a", city: "المدينة المنورة" }
  });
  try {
    const review = await import("../public/js/opportunity-review.js");
    review.openOpportunityReview({
      fields: { propertyType: "فيلا", city: "المدينة المنورة", district: "عروة", purpose: "SALE", opportunityKind: "OFFER" },
      sourceText: "عرض للبيع فيلا في المدينة المنورة حي عروة",
      reviewDefaults: (await import("../public/js/import-advert-review-domain.js")).buildImportSimplifiedReviewDefaults(
        { propertyType: "فيلا", city: "المدينة المنورة", district: "عروة", purpose: "SALE", opportunityKind: "OFFER" },
        "عرض للبيع فيلا في المدينة المنورة حي عروة"
      )
    }, () => {}, { importSimplifiedReview: true });
    const body = context.document.getElementById("opportunityReviewBody");
    assertNoDropdowns(body, ["rawPropertyTypeText", "rawCityText", "rawNeighborhoodText"]);
    const property = body.querySelector('[name="rawPropertyTypeText"]');
    property.value = "استراحة مخصصة";
    property.dispatchEvent(new context.window.Event("input", { bubbles: true }));
    assert.equal(property.value, "استراحة مخصصة");
  } finally {
    context.close();
  }
});

test("client intake markup uses transaction intent choices without suggest lists", async () => {
  const gateSource = (await import("node:fs")).readFileSync(new URL("../public/js/access-gate.js", import.meta.url), "utf8");
  assert.doesNotMatch(gateSource, /wireArabicSuggestInput\(propertyInput/);
  assert.doesNotMatch(gateSource, /<select[^>]*name="requestKind"/);
  assert.match(gateSource, /name="transactionIntent"/);
  assert.match(gateSource, /intent-choice/);
  assert.match(gateSource, /name="propertyType"/);
  assert.match(gateSource, /name="district"/);
});

test("import simplified review markup has no hybrid search fields", async () => {
  const reviewSource = (await import("node:fs")).readFileSync(new URL("../public/js/opportunity-review.js", import.meta.url), "utf8");
  const start = reviewSource.indexOf("function renderImportSimplifiedReviewForm");
  const end = reviewSource.indexOf("function renderReviewForm", start);
  const section = reviewSource.slice(start, end);
  assert.doesNotMatch(section, /searchField\(/);
  assert.doesNotMatch(section, /<select/);
  assert.match(section, /plainTextField\(\s*"rawPropertyTypeText"/);
});
