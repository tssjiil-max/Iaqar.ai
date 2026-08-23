import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { buildV2Hash, isSameV2Route, parseV2Hash } from "../public/v2/app/router.js";
import { createV2Shell } from "../public/v2/app/shell.js";
import { isFrontendV2AppPath } from "../public/v2/services/feature-flag.js";

test("hash router maps stable V2 routes and defaults home to opportunities", () => {
  assert.deepEqual(parseV2Hash(""), { name: "opportunities" });
  assert.deepEqual(parseV2Hash("#/"), { name: "opportunities" });
  assert.deepEqual(parseV2Hash("#/opportunities"), { name: "opportunities" });
  assert.deepEqual(parseV2Hash("#/opportunities/opp_1258"), { name: "opportunity", id: "opp_1258" });
  assert.deepEqual(parseV2Hash("#/tasks"), { name: "tasks" });
  assert.deepEqual(parseV2Hash("#/matches"), { name: "matches" });
  assert.deepEqual(parseV2Hash("#/community"), { name: "community" });
  assert.deepEqual(parseV2Hash("#/agreements"), { name: "agreements" });
  assert.deepEqual(parseV2Hash("#/unknown"), { name: "opportunities" });
});

test("opportunity id is sanitized and rejected when unsafe", () => {
  assert.deepEqual(parseV2Hash("#/opportunities/../secret"), { name: "opportunities" });
  assert.deepEqual(parseV2Hash("#/opportunities/offices%2Fx"), { name: "opportunities" });
  assert.equal(buildV2Hash({ name: "opportunity", id: "opp_1" }), "#/opportunities/opp_1");
  assert.equal(isSameV2Route({ name: "opportunity", id: "a" }, { name: "opportunity", id: "a" }), true);
});

test("V2 shell renders RTL app chrome without legacy classes", () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  globalThis.document = dom.window.document;
  const root = dom.window.document.getElementById("root");
  const shell = createV2Shell(root);
  shell.render({ name: "opportunity", id: "opp_1258" });
  const html = root.innerHTML;
  assert.match(html, /dir="rtl"/);
  assert.match(html, /تفاصيل الفرصة/);
  assert.match(html, /المعرّف: opp_1258/);
  assert.match(html, /data-v2-nav="opportunities"/);
  assert.equal(html.includes("opp-details"), false);
  assert.equal(html.includes("opportunity-bank"), false);
  assert.equal(html.includes("progress-ring"), false);
  delete globalThis.document;
});

test("V2 lives on its own path", () => {
  assert.equal(isFrontendV2AppPath("/v2"), true);
  assert.equal(isFrontendV2AppPath("/v2/"), true);
  assert.equal(isFrontendV2AppPath("/"), false);
  assert.equal(isFrontendV2AppPath("/index.html"), false);
});
