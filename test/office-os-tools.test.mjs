import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CALC_DEFAULTS, GUIDE_STEPS, MESSAGE_TEMPLATES, OFFICE_TOOLS, OFFICIAL_SERVICES, TEMPLATE_GROUPS,
  calculateDeal, fillTemplate, formatMoney, isOfficialServiceUrl, marketSnapshot, officeToolById, officeToolByLabel, templatesFor
} from "../public/os/domain/office-tools-domain.js";

const read = (file) => fs.readFileSync(new URL(`../public/os/${file}`, import.meta.url), "utf8");

test("the six office tools keep the approved labels and each one has a working route", () => {
  assert.deepEqual(OFFICE_TOOLS.map((t) => t.label), ["ملفاتي", "النماذج", "الدليل", "الخدمات", "الحاسبة", "السوق"]);
  assert.equal(officeToolByLabel("ملفاتي").route, "library", "«ملفاتي» opens the existing office library");
  const app = read("app.js");
  const views = read("views/office-tools.js");
  for (const tool of OFFICE_TOOLS.filter((t) => t.id !== "files")) {
    assert.match(tool.route, /^tools\/[a-z]+$/);
    const id = tool.route.split("/")[1];
    assert.equal(officeToolById(id)?.label, tool.label);
    assert.match(views, new RegExp(`\\b${id}: render`), `a screen is registered for ${tool.label}`);
  }
  assert.match(app, /renderOfficeTool\(el, \{ tool: id \}\)/);
  assert.equal(officeToolByLabel("غير موجود"), null);
});

test("calculator: sale — commission, VAT on the commission, transaction tax and the buyer total", () => {
  const calc = calculateDeal({ kind: "sale", amount: "1,000,000" });
  assert.equal(calc.ok, true);
  assert.equal(calc.commission, 25000);
  assert.equal(calc.commissionVat, 3750);
  assert.equal(calc.commissionTotal, 28750);
  assert.equal(calc.transferTax, 50000);
  assert.equal(calc.buyerTotal, 1078750);
  assert.deepEqual(calc.rows.map((r) => r.id), ["amount", "commission", "commissionVat", "commissionTotal", "transferTax", "buyerTotal"]);
});

test("calculator: rent has no transaction tax, and rates can be changed", () => {
  const rent = calculateDeal({ kind: "rent", amount: 60000 });
  assert.equal(rent.commission, 1500);
  assert.equal(rent.commissionVat, 225);
  assert.equal(rent.transferTax, 0);
  assert.equal(rent.buyerTotal, 61725);
  assert.ok(!rent.rows.some((r) => r.id === "transferTax"));
  const custom = calculateDeal({ kind: "sale", amount: 800000, commissionPercent: "1.5", vatPercent: "15", transferTaxPercent: "0" });
  assert.equal(custom.commission, 12000);
  assert.equal(custom.transferTax, 0);
  assert.equal(custom.buyerTotal, 813800);
});

test("calculator: Arabic digits are read; empty, zero and absurd amounts are refused; bad rates fall back", () => {
  assert.equal(calculateDeal({ kind: "sale", amount: "٥٠٠٠٠٠" }).commission, 12500);
  assert.equal(calculateDeal({ kind: "sale", amount: "" }).ok, false);
  assert.equal(calculateDeal({ kind: "sale", amount: 0 }).ok, false);
  assert.equal(calculateDeal({ kind: "rent", amount: "" }).errors.amount, "اكتب الإيجار السنوي");
  assert.equal(calculateDeal({ kind: "sale", amount: 1e13 }).ok, false);
  const bad = calculateDeal({ kind: "sale", amount: 100000, commissionPercent: "500", vatPercent: "" });
  assert.equal(bad.rates.commissionPercent, CALC_DEFAULTS.commissionPercent);
  assert.equal(bad.rates.vatPercent, CALC_DEFAULTS.vatPercent);
  assert.equal(calculateDeal({ kind: "sale", amount: 100000, commissionPercent: "0" }).commission, 0, "an explicit zero is respected");
  assert.equal(formatMoney(28750), "28,750 ريال");
  assert.equal(formatMoney(1234.5), "1,234.50 ريال");
});

const rec = (id, extra) => ({ id, officeId: "o1", lifecycleStatus: "ACTIVE", city: "الرياض", ...extra });

test("market: only the office's active records count; averages are per type and purpose", () => {
  const records = [
    rec("a", { opportunityKind: "OFFER", purpose: "SALE", propertyType: "فيلا", district: "النرجس", salePrice: 2000000 }),
    rec("b", { opportunityKind: "OFFER", purpose: "SALE", propertyType: "فيلا", district: "حي الملقا", salePrice: 3000000 }),
    rec("c", { opportunityKind: "REQUEST", purpose: "PURCHASE", propertyType: "فيلا", district: "النرجس", budget: 2400000 }),
    rec("d", { opportunityKind: "OFFER", purpose: "RENT", propertyType: "شقة", district: "العليا", annualRent: 60000 }),
    rec("e", { opportunityKind: "OFFER", purpose: "SALE", propertyType: "فيلا", district: "النرجس", salePrice: 9000000, lifecycleStatus: "ARCHIVED" }),
    rec("f", { opportunityKind: "OFFER", purpose: "SALE", propertyType: "فيلا", district: "النرجس", salePrice: 9000000, deletedAt: "2026-01-01" })
  ];
  const snap = marketSnapshot(records);
  assert.deepEqual([snap.total, snap.offers, snap.requests], [4, 3, 1], "archived and deleted records are ignored");
  const villa = snap.byType.find((row) => row.key === "sale|فيلا");
  assert.deepEqual([villa.offers, villa.requests, villa.avgOffer, villa.avgBudget], [2, 1, 2500000, 2400000]);
  const flat = snap.byType.find((row) => row.key === "rent|شقة");
  assert.deepEqual([flat.offers, flat.requests, flat.avgOffer, flat.avgBudget], [1, 0, 60000, 0]);
  assert.equal(snap.byDistrict[0].district, "النرجس", "«حي» prefix is normalised and the busiest district is first");
  assert.deepEqual(snap.gaps, [], "the request has an offer of the same type in the same district");
});

test("market: a request with no offer of the same type in its district is listed as a gap", () => {
  const snap = marketSnapshot([
    rec("a", { opportunityKind: "OFFER", purpose: "SALE", propertyType: "فيلا", district: "النرجس", salePrice: 2000000 }),
    rec("b", { opportunityKind: "REQUEST", purpose: "PURCHASE", propertyType: "شقة", district: "النرجس", budget: 700000 }),
    rec("c", { opportunityKind: "REQUEST", purpose: "PURCHASE", propertyType: "شقة", district: "النرجس", budget: 900000 }),
    rec("d", { opportunityKind: "REQUEST", purpose: "LEASE_REQUEST", propertyType: "فيلا", district: "النرجس", budget: 120000 })
  ]);
  assert.equal(snap.gaps.length, 2);
  assert.deepEqual([snap.gaps[0].propertyType, snap.gaps[0].requests, snap.gaps[0].avgBudget, snap.gaps[0].txLabel], ["شقة", 2, 800000, "شراء"]);
  assert.equal(snap.gaps[1].txLabel, "إيجار", "a sale offer does not cover a rent request");
  assert.deepEqual(marketSnapshot([]), { total: 0, offers: 0, requests: 0, byType: [], byDistrict: [], gaps: [] });
});

test("templates: placeholders are filled from the office profile and never shown raw", () => {
  const context = { officeName: "مكتب سلطان العقاري", brokerName: "سلطان", licenseNumber: "1200012345", officeLink: "https://x.test/m/sultan" };
  const all = templatesFor(context);
  assert.equal(all.length, MESSAGE_TEMPLATES.length);
  for (const item of all) {
    assert.ok(TEMPLATE_GROUPS.some((g) => g.id === item.group), `known group for ${item.id}`);
    assert.doesNotMatch(item.text, /\{\w+\}/, `no raw placeholder in ${item.id}`);
    assert.ok(item.text.length > 20);
  }
  assert.match(all.find((t) => t.id === "office-intro").text, /مكتب سلطان العقاري[\s\S]*1200012345[\s\S]*https:\/\/x\.test\/m\/sultan/);
  assert.equal(fillTemplate("مرحبًا {brokerName}\n\n\n\n{missing}\nشكرًا", { brokerName: "سلطان" }), "مرحبًا سلطان\n\nشكرًا");
  assert.equal(new Set(MESSAGE_TEMPLATES.map((t) => t.id)).size, MESSAGE_TEMPLATES.length, "template ids are unique");
});

test("templates are drafts: the screen shares or copies, it never calls the Worker to send", () => {
  const view = read("views/office-tools.js");
  assert.doesNotMatch(view, /\bapi\(/, "tool screens make no Worker write");
  assert.match(view, /navigator\.share|wa\.me\/\?text=/, "sharing goes through the device share sheet or WhatsApp with no preset recipient");
});

test("guide steps open real routes; services are official https links opened outside the app", () => {
  const app = read("app.js");
  for (const step of GUIDE_STEPS) {
    const section = step.route.split(/[/?]/)[0];
    assert.match(app, new RegExp(`section === "${section}"|return \\{ name: "${section}"`), `route exists for guide step ${step.id}`);
  }
  assert.ok(GUIDE_STEPS.some((s) => s.managerOnly), "manager-only steps are marked");
  for (const service of OFFICIAL_SERVICES) {
    assert.match(service.url, /^https:\/\/[a-z0-9.-]+\.(sa|gov\.sa)$/, `${service.name} uses an official .sa address`);
    assert.equal(isOfficialServiceUrl(service.url), true);
  }
  assert.equal(isOfficialServiceUrl("https://evil.example"), false);
  assert.match(read("views/office-tools.js"), /rel: "noopener noreferrer"/);
});
