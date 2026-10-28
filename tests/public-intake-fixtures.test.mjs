import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../public/js/access-gate.js", import.meta.url), "utf8");
const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/public-intake-cases.json", import.meta.url), "utf8"));

function validFixture(f) {
  return ["client", "owner"].includes(f.kind)
    && ["sale", "rent"].includes(f.transactionType)
    && Number.isFinite(f.area) && f.area > 0 && f.area <= 100000000
    && Number.isSafeInteger(f.amount) && f.amount > 0 && f.amount <= 1000000000000
    && Number.isInteger(f.rooms) && f.rooms >= 0 && f.rooms <= 100
    && (["شقة", "فيلا", "دور", "دوبلكس", "قصر", "بيت شعبي"].includes(f.propertyType) || f.rooms === 0);
}

test("realistic fixtures are synthetically tagged and classified", () => {
  assert.equal(fixtures.cases.length, 8);
  for (const entry of fixtures.cases) {
    assert.match(entry.details, /اختبار فقط/);
    assert.equal(validFixture(entry), entry.expected === "valid", entry.id);
  }
});

test("public form stores structured numeric values and transaction", () => {
  assert.match(source, /area: areaText \? Number\(areaText\) : 0/);
  assert.match(source, /amount: amountText \? Number\(amountText\) : 0/);
  assert.match(source, /transactionType:.*"rent".*"sale"/);
  assert.match(source, /rooms:.*Number\(fields\.get\("rooms"\)\)/);
});

test("firestore validates optional typed fields while retaining legacy intake", () => {
  for (const field of ["area", "amount", "rooms", "transactionType"]) {
    assert.ok(rules.includes("'"+field+"' in request.resource.data"), field);
  }
  assert.match(rules, /request\.resource\.data\.officeId == officeId/);
});
