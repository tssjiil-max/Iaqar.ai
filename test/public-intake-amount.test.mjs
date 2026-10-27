// The price / budget field of the public intake form must never turn what a visitor typed into a different amount.
// Before: Number(value.replace(/\D/g, "")) — «600000.00» became 60000000 and «1.5» became 15, saved without a warning.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseIntakeAmount, buildClientIntakeDocument } from "../public/js/public-client-intake-domain.js";

test("whole amounts, with or without thousands separators", () => {
  assert.equal(parseIntakeAmount("600000"), 600000);
  assert.equal(parseIntakeAmount("600,000"), 600000);
  assert.equal(parseIntakeAmount("1,250,000"), 1250000);
  assert.equal(parseIntakeAmount("600 000"), 600000);
  assert.equal(parseIntakeAmount(" 450000 "), 450000);
  assert.equal(parseIntakeAmount(750000), 750000);
});

test("whitespace normalization preserves every zero and rejects literal escape characters", () => {
  for (const [raw, expected] of [
    ["600000", 600000], ["100020.50", 100020.5],
    ["600\u00a0000.50", 600000.5], ["600\t000.50", 600000.5], ["٦٠٠٬٠٠٠٫٥٠", 600000.5]
  ]) {
    assert.equal(parseIntakeAmount(raw), expected, raw);
  }
  for (const raw of ["600s000", "600u000", "600a000", "600\\000"]) {
    assert.equal(parseIntakeAmount(raw), null, raw);
  }
});

test("decimal fractions keep their value (the bug: 600000.00 became 60000000)", () => {
  assert.equal(parseIntakeAmount("600000.00"), 600000);
  assert.equal(parseIntakeAmount("600000.5"), 600000.5);
  assert.equal(parseIntakeAmount("600,000.50"), 600000.5);
  assert.equal(parseIntakeAmount("1.5"), 1.5);
  assert.equal(parseIntakeAmount("0.25"), 0.25);
});

test("Arabic-Indic and Persian digits and Arabic separators are read, not dropped", () => {
  assert.equal(parseIntakeAmount("٦٠٠٠٠٠"), 600000);
  assert.equal(parseIntakeAmount("٦٠٠٬٠٠٠"), 600000);
  assert.equal(parseIntakeAmount("٦٠٠٬٠٠٠٫٥٠"), 600000.5);
  assert.equal(parseIntakeAmount("۶۰۰۰۰۰"), 600000);
  assert.equal(parseIntakeAmount("٦٠٠،٠٠٠"), 600000);
});

test("a currency word next to the number is allowed", () => {
  assert.equal(parseIntakeAmount("600000 ريال"), 600000);
  assert.equal(parseIntakeAmount("600,000 ر.س"), 600000);
  assert.equal(parseIntakeAmount("SAR 600000"), 600000);
});

test("anything ambiguous or not a positive amount is rejected instead of guessed", () => {
  for (const bad of ["", "   ", "abc", "0", "0.00", "-5", "1.234", "600000..00", "60,00", "1,2,3", "600 ألف", "1.5 مليون", "1e6", "٦٠٠٠٠٠٫٥٠٥", "12.5.1", "٠", null, undefined, NaN, Infinity, "9".repeat(20)]) {
    assert.equal(parseIntakeAmount(bad), null, `«${String(bad)}» must be rejected`);
  }
});

test("the form handler uses the parser and no longer strips every non-digit from the amount", () => {
  const gate = fs.readFileSync(new URL("../public/js/access-gate.js", import.meta.url), "utf8");
  assert.doesNotMatch(gate, /priceOrBudget"\) \|\| ""\)\.replace\(\/\\D\/g/);
  assert.match(gate, /parseIntakeAmount/);
  const domain = fs.readFileSync(new URL("../public/js/public-client-intake-domain.js", import.meta.url), "utf8");
  assert.match(domain, /window\.IAQARPublicClientIntake = \{[\s\S]*parseIntakeAmount/);
});


test("currency appears only once at the start or end, never inside digits", () => {
  for (const [raw, expected] of [
    ["ريال 600000", 600000],
    ["٦٠٠٬٠٠٠ ريال", 600000],
    ["SR 600000", 600000],
    ["600000 SAR", 600000],
    ["600,000 ر.س", 600000]
  ]) assert.equal(parseIntakeAmount(raw), expected, raw);
  for (const raw of [
    "600ريال000", "600SAR000", "600SR000", "ريال 600 ريال",
    "SAR 600000 SAR", "ريال SAR 600000", "600000 ريال SR",
    "600000ريال600", "600000 SR ريال", "SARريال600000"
  ]) assert.equal(parseIntakeAmount(raw), null, raw);
});

test("parsed amount survives client document construction for purchase and rent", () => {
  const amount = parseIntakeAmount("٦٠٠٬٠٠٠٫٥٠");
  assert.equal(amount, 600000.5);
  for (const requestKind of ["purchase", "rent"]) {
    const document = buildClientIntakeDocument({
      name: "عميل اختباري",
      phone: "0500000000",
      propertyType: "شقة",
      requestKind,
      city: "الرياض",
      district: "الملقا",
      priceOrBudget: amount
    }, { targetOffice: "synthetic-office" });
    assert.equal(document.priceOrBudget, 600000.5);
    assert.equal(document.amount, 600000.5);
    assert.equal(requestKind === "purchase" ? document.budget : document.annualRent, 600000.5);
  }
});
