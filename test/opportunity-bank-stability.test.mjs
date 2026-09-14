import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/js/opportunity-bank.js", import.meta.url), "utf8");

test("bank rows have one canonical Firestore source and operations never inject opportunity rows", () => {
  assert.doesNotMatch(source, /indexOpportunityRecordsFromFeed/);
  assert.doesNotMatch(source, /mergeOpportunityFeedRecords/);
  assert.match(source, /collection\("offices"\)\.doc\(officeId\(\)\)\s*\.collection\("opportunities"\)/);
});

test("action filters are data filters that reset and rescan pagination", () => {
  assert.match(source, /function hasActiveOpportunityActionFilter\(\)/);
  assert.match(source, /function hasActiveListFilter\(\)/);
  assert.match(source, /const scanForListFilter = hasActiveListFilter\(\);/);
  assert.match(source, /recordMatchesCurrentFilters\(record, actions\)/);
  const actionFilterHandler = source.slice(
    source.indexOf('$("bankActionFilters")?.addEventListener'),
    source.indexOf('$("bankIncomingList")?.addEventListener')
  );
  assert.match(actionFilterHandler, /scheduleBankQueryRefresh\(\)/);
  assert.doesNotMatch(actionFilterHandler, /\brenderList\(\);/);
});

test("filtered pagination scans until it fills the visible page or reaches Firestore exhaustion", () => {
  const loadStart = source.indexOf("async function loadBankPage");
  const loadEnd = source.indexOf("\nfunction startListener()", loadStart);
  const loadSource = source.slice(loadStart, loadEnd);
  assert.match(loadSource, /while \(matchedThisPass < BANK_PAGE_SIZE && !state\.scanExhausted\)/);
  assert.doesNotMatch(loadSource, /maxScans/);
  assert.match(loadSource, /state\.hasMore = !state\.scanExhausted/);
});

test("reset clears old rows before awaiting facet hydration", () => {
  const loadStart = source.indexOf("async function loadBankPage");
  const loadEnd = source.indexOf("\nfunction startListener()", loadStart);
  const loadSource = source.slice(loadStart, loadEnd);
  const clearAt = loadSource.indexOf("state.records.clear()");
  const facetAt = loadSource.indexOf("await refreshBankFacetMeta(runtime)");
  assert.ok(clearAt >= 0 && facetAt >= 0 && clearAt < facetAt);
});

test("operations event is office-scoped and refreshes active action-filter projection", () => {
  const eventStart = source.indexOf('window.addEventListener("iaqar:operations-data"');
  const eventEnd = source.indexOf('window.addEventListener("iaqar:bank-refresh"', eventStart);
  const eventSource = source.slice(eventStart, eventEnd);
  assert.match(eventSource, /eventOfficeId/);
  assert.match(eventSource, /eventOfficeId !== currentOfficeId/);
  assert.match(eventSource, /itemOfficeId === currentOfficeId/);
  assert.match(eventSource, /hasActiveOpportunityActionFilter\(\)/);
  assert.match(eventSource, /scheduleBankQueryRefresh\(\)/);
});
