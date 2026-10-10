import test from "node:test";
import assert from "node:assert/strict";
import { amountFrom, analyzeText, districtsFrom, intakeOriginFrom, kindFrom, normalizeAnalysis, similarRecords, splitDistrictInput, splitListings } from "../public/os/domain/smart-fill-domain.js";
import { acceptModelValues } from "../worker/src/office-os/smart-fill-service.js";

const one = (text) => analyzeText(text).listings[0];

test("offer ad: every written fact, nothing more", () => {
  const l = one("للبيع فيلا في حي النرجس بالرياض مساحة ٤٥٠ م٢ ، ٥ غرف ، واجهة شمالية، السعر 2.3 مليون للتواصل 0551234567");
  assert.deepEqual([l.kind, l.purpose, l.propertyType, l.city, l.districts.join(), l.area, l.rooms, l.price, l.phone], ["OFFER", "SALE", "فيلا", "الرياض", "النرجس", 450, 5, 2300000, "0551234567"]);
  assert.ok(l.features.includes("واجهة شمالية"));
  assert.deepEqual(l.missing, []);
});

test("purchase request — the spec example", () => {
  const l = one("مطلوب عمارة في شوران أو الهجرة أو الرانوناء، الميزانية مليونين، شراء، مستعجل.");
  assert.deepEqual([l.kind, l.purpose, l.propertyType, l.price, l.urgent], ["REQUEST", "PURCHASE", "عمارة", 2000000, true]);
  assert.deepEqual(l.districts, ["شوران", "الهجرة", "الرانوناء"]);
  assert.equal(l.city, "", "city is not guessed from the districts");
  assert.deepEqual(l.missing, ["city"]);
});

test("lease request with yearly rent", () => {
  const l = one("مطلوب شقة للإيجار في جدة حي الصفا 3 غرف الميزانية 40 ألف سنوي");
  assert.deepEqual([l.kind, l.purpose, l.city, l.districts.join(), l.rooms, l.price], ["REQUEST", "LEASE_REQUEST", "جدة", "الصفا", 3, 40000]);
});

test("amounts: Arabic and Latin digits, words, millions", () => {
  assert.equal(amountFrom("الميزانية مليونين"), 2_000_000);
  assert.equal(amountFrom("السعر 1.5 مليون"), 1_500_000);
  assert.equal(amountFrom("بسعر مليون ونص"), 1_500_000);
  assert.equal(amountFrom("حدود ١٫٥ مليون"), 1_500_000);
  assert.equal(amountFrom("السعر ٨٥٠٬٠٠٠ ريال"), 850_000);
  assert.equal(amountFrom("السعر 850,000"), 850_000);
  assert.equal(amountFrom("الميزانية 3 ملايين"), 3_000_000);
  assert.equal(amountFrom("500 ألف"), 500_000);
  assert.equal(amountFrom("نص مليون"), 500_000);
  assert.equal(amountFrom("مساحة 600 متر للتواصل 0551234567"), 0, "area and phone are never a price");
});

test("several districts, written in different ways", () => {
  assert.deepEqual(districtsFrom("في حي الملقا، النرجس والياسمين"), ["الملقا", "النرجس", "الياسمين"]);
  assert.deepEqual(districtsFrom("شقة في العزيزية بالمدينة"), ["العزيزية"]);
  assert.deepEqual(districtsFrom("في حدود مليون"), []);
  assert.deepEqual(splitDistrictInput("الملقا، النرجس / الياسمين"), { district: "الملقا", others: ["النرجس", "الياسمين"] });
});

test("several ads in one paste are split", () => {
  const blocks = splitListings("1- للبيع شقة في الملقا بالرياض 900 ألف\n2- مطلوب فيلا في النرجس الرياض الميزانية 3 ملايين\n3- للإيجار محل في العليا 120 ألف سنوي");
  assert.equal(blocks.length, 3);
  const r = analyzeText(blocks.join("\n"), { multi: true });
  assert.deepEqual(r.listings.map((l) => l.kind), ["OFFER", "REQUEST", "OFFER"]);
  assert.equal(analyzeText(blocks.join("\n")).several, true, "public page: told to send one at a time");
});

test("incomplete text → asks, never fills", () => {
  const l = one("أبغى شقة في الرياض");
  assert.equal(l.kind, "REQUEST");
  assert.ok(l.missing.includes("price") && l.missing.includes("district") && l.missing.includes("purpose"));
  assert.ok(l.questions.length >= 1);
  assert.equal(l.price, 0);
});

test("non real-estate text and too-short text", () => {
  assert.equal(analyzeText("السلام عليكم كيف الحال").notRealEstate, true);
  assert.equal(analyzeText("هلا").ok, false);
});

test("ambiguous offer/request → empty, asked", () => {
  assert.equal(kindFrom("شقة الملقا 900 ألف"), "");
  assert.ok(one("شقة في الملقا 900 ألف").missing.includes("kind"));
});

test("the one schema rejects anything outside it", () => {
  const r = normalizeAnalysis({ ok: true, listings: [{ kind: "HACK", purpose: "SALE", propertyType: "<script>", price: "-5", phone: "123", districts: ["a", "<b>حي</b>"] }] });
  const l = r.listings[0];
  assert.deepEqual([l.kind, l.purpose, l.propertyType, l.price, l.phone], ["", "", "", 0, ""]);
  assert.ok(!JSON.stringify(l).includes("<"));
});

test("a model may only fill gaps with values the text supports", () => {
  const base = one("مطلوب فيلا في النرجس بالرياض الميزانية 3 ملايين");
  const out = acceptModelValues({ ...base, purpose: "", city: "", districts: [] }, { purpose: "PURCHASE", city: "جدة", districts: ["النرجس", "العليا"], price: 9_000_000 }, base.original);
  assert.equal(out.purpose, "PURCHASE");
  assert.equal(out.city, "", "a city that is not written is refused");
  assert.deepEqual(out.districts, ["النرجس"], "an invented district is refused");
  assert.equal(out.price, 3_000_000, "the rules' price is kept");
});

test("duplicates are looked for in this office's records only", () => {
  const listing = one("للبيع شقة في الملقا بالرياض 900 ألف");
  const mine = [{ id: "a", opportunityKind: "OFFER", propertyType: "شقة", district: "الملقا", price: 910000 }, { id: "b", opportunityKind: "REQUEST", propertyType: "شقة", district: "الملقا", price: 900000 }];
  assert.deepEqual(similarRecords(listing, mine).map((r) => r.id), ["a"]);
});

test("intake origin: known values only; an external broker is a claim", () => {
  assert.equal(intakeOriginFrom(null), null);
  const o = intakeOriginFrom({ channel: "WHATSAPP", role: "EXTERNAL_BROKER", method: "SMART_FILL", text: "نص" }, { now: new Date("2026-10-10T00:00:00Z") });
  assert.deepEqual(o, { channel: "WHATSAPP", role: "EXTERNAL_BROKER", method: "SMART_FILL", originalText: "نص", at: "2026-10-10T00:00:00.000Z" });
  assert.equal(intakeOriginFrom({ channel: "EVIL", role: "ADMIN" }), null);
});
