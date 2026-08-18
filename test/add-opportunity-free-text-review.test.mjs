import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

function readRepo(...parts) {
  return readFileSync(path.join(root, "..", ...parts), "utf8");
}

test("add opportunity opens simplified plain-text review overlay", () => {
  const add = readRepo("public", "js", "add-opportunity.js");
  assert.ok(add.includes("importSimplifiedReview: true"));
  assert.ok(add.includes("buildImportSimplifiedReviewDefaults"));
  assert.ok(add.includes("openAddOpportunityReview"));
});

test("default review overlay keeps catalog hybrid fields out of add-opportunity path", () => {
  const review = readRepo("public", "js", "opportunity-review.js");
  assert.ok(review.includes("renderImportSimplifiedReviewForm"));
  assert.doesNotMatch(review, /searchField\("propertyTypeId".*renderImportSimplifiedReviewForm/s);
});
