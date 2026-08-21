import test from "node:test";
import assert from "node:assert/strict";
import {
  addSelectedOffice,
  removeSelectedOffice,
  uniqueSelectedOfficeIds,
  filterOfficesForCooperationSearch,
  cooperationSendSuccessMessage,
  assertSafeCooperationSharePayload,
  currentCooperationShareStatusLabel
} from "../public/js/office-cooperation-ui-domain.js";
import {
  buildOfficeCooperationPanelHtml,
  buildOfficeSearchResultHtml,
  buildSelectedOfficeChipsHtml
} from "../public/js/suitable-offices-ui.js";
import { readRepositoryFile } from "./helpers/shell.mjs";

test("multi-select keeps offices unique", () => {
  let selected = [];
  selected = addSelectedOffice(selected, { officeId: "A", officeName: "مكتب أ" });
  selected = addSelectedOffice(selected, { officeId: "B", officeName: "مكتب ب" });
  selected = addSelectedOffice(selected, { officeId: "A", officeName: "مكتب أ" });
  assert.equal(selected.length, 2);
  assert.deepEqual(uniqueSelectedOfficeIds(selected), ["a", "b"]);
});

test("search excludes own office and already selected offices", () => {
  const offices = [
    { officeId: "self", officeName: "مكتبي", city: "مكة" },
    { officeId: "picked", officeName: "مكتب مختار", city: "مكة" },
    { officeId: "free", officeName: "مكتب العقيق", primaryNeighborhoodLabel: "العقيق", city: "مكة" }
  ];
  const rows = filterOfficesForCooperationSearch({
    offices,
    query: "العقيق",
    ownOfficeId: "self",
    selectedOfficeIds: ["picked"]
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].officeId, "free");
});

test("chip remove drops only one office", () => {
  const selected = [
    { officeId: "a", officeName: "مكتب أ" },
    { officeId: "b", officeName: "مكتب ب" }
  ];
  const next = removeSelectedOffice(selected, "a");
  assert.equal(next.length, 1);
  assert.equal(next[0].officeId, "b");
});

test("cooperation panel has single send button and privacy note", () => {
  const html = buildOfficeCooperationPanelHtml();
  assert.match(html, /id="bankCoopOfficesSearch"/);
  assert.match(html, /id="bankCoopSendBtn"/);
  assert.match(html, /إرسال الفرصة/);
  assert.match(html, /لن تتم مشاركة بيانات المالك أو العميل أو أرقام التواصل/);
  assert.doesNotMatch(html, /اختيار المكتب/);
  assert.doesNotMatch(html, /confirm\(/);
});

test("search result is clickable without pick button label", () => {
  const html = buildOfficeSearchResultHtml({
    officeId: "x",
    officeName: "مكتب عروة",
    primaryNeighborhoodLabel: "عروة",
    city: "مكة",
    verified: true
  });
  assert.match(html, /data-pick-office-id="x"/);
  assert.match(html, /موثق/);
  assert.doesNotMatch(html, /اختيار المكتب/);
});

test("chips render compact removable labels", () => {
  const html = buildSelectedOfficeChipsHtml([
    { officeId: "a", officeName: "مكتب أ" },
    { officeId: "b", officeName: "مكتب ب" }
  ]);
  assert.match(html, /data-remove-office-id="a"/);
  assert.match(html, /data-remove-office-id="b"/);
});

test("safe payload rejects contact fields", () => {
  const blocked = assertSafeCooperationSharePayload({
    propertyType: "شقة",
    ownerPhone: "0500000000"
  });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.blocked.includes("ownerPhone"));
  const safe = assertSafeCooperationSharePayload({
    propertyType: "شقة",
    city: "مكة",
    district: "العزيزية"
  });
  assert.equal(safe.ok, true);
});

test("success messages are Arabic and count-aware", () => {
  assert.equal(cooperationSendSuccessMessage(1), "تم إرسال الفرصة إلى المكتب.");
  assert.equal(cooperationSendSuccessMessage(3), "تم إرسال الفرصة إلى 3 مكاتب.");
  assert.equal(currentCooperationShareStatusLabel("PENDING"), "تم الإرسال");
});

test("bank controller removes confirm from share send path", () => {
  const bank = readRepositoryFile("public", "js", "opportunity-bank.js");
  assert.doesNotMatch(bank, /confirm\(`تأكيد إرسال الفرصة/);
  assert.match(bank, /sendCooperationToSelectedOffices/);
  assert.match(bank, /cooperationMessage/);
  assert.match(bank, /تعذر إرسال الفرصة\. حاول مرة أخرى/);
  assert.match(bank, /finally/);
  assert.doesNotMatch(bank, /const message = payload\.duplicate/);
});
