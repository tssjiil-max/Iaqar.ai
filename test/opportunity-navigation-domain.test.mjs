import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOpportunityDeepLinkHash,
  isBankCardActionControl,
  normalizeOpportunityDocumentId,
  parseOpportunityIdFromHash,
  parseOpportunityIdFromLocation,
  parseOpportunityIdFromPathname,
  stripOpportunityDeepLinkHref
} from "../public/js/opportunity-navigation-domain.js";
import { JSDOM } from "jsdom";

test("normalizeOpportunityDocumentId keeps Firestore ids and rejects path fallbacks", () => {
  assert.equal(normalizeOpportunityDocumentId("  ABC123  "), "ABC123");
  assert.equal(normalizeOpportunityDocumentId("opp_phase2_a"), "opp_phase2_a");
  assert.equal(normalizeOpportunityDocumentId(""), "");
  assert.equal(normalizeOpportunityDocumentId("../other"), "");
  assert.equal(normalizeOpportunityDocumentId("offices/x/opportunities/y"), "");
});

test("deep link hash encodes the document id and parses it back", () => {
  assert.equal(buildOpportunityDeepLinkHash("ABC123"), "#/opportunities/ABC123");
  assert.equal(parseOpportunityIdFromHash("#/opportunities/ABC123"), "ABC123");
  assert.equal(parseOpportunityIdFromHash("#/opportunities/opp%5Fready"), "opp_ready");
  assert.equal(parseOpportunityIdFromHash("#/bank"), "");
  assert.equal(parseOpportunityIdFromPathname("/opportunities/ABC123"), "ABC123");
  assert.equal(
    parseOpportunityIdFromLocation({ hash: "#/opportunities/READY1", pathname: "/" }),
    "READY1"
  );
  assert.equal(stripOpportunityDeepLinkHref({ pathname: "/", search: "" }), "/");
});

test("bank card action control ignores only real nested actions", () => {
  const dom = new JSDOM(`
    <article class="bank-row bank-row-card" data-opportunity-id="opp_1">
      <h3 class="bank-row-title">شقة للبيع</h3>
      <span class="listing-field-mark">الحي</span>
      <button type="button" class="bank-action">حفظ</button>
      <a href="https://example.test/wa">واتساب</a>
      <a>plain</a>
    </article>
  `);
  const root = dom.window.document.querySelector("article");
  assert.equal(isBankCardActionControl(root.querySelector("h3")), false);
  assert.equal(isBankCardActionControl(root.querySelector(".listing-field-mark")), false);
  assert.equal(isBankCardActionControl(root.querySelector("a:not([href])")), false);
  assert.equal(isBankCardActionControl(root.querySelector("button")), true);
  assert.equal(isBankCardActionControl(root.querySelector("a[href]")), true);
  dom.window.close();
});
