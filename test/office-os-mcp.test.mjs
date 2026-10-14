// خادم MCP للقراءة فقط: بروتوكول، مصادقة، عزل المكاتب، وعدم تسريب الهواتف. عبر الـ Worker الحقيقي على Firestore وهمي.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TOOLS } from "../worker/src/office-os/mcp-server.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B, BROKER_A2 } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const h = await startOfficeOsHarness();
test.after(() => h.server.close());
h.env.MCP_SERVER = "enabled";
h.env.SCOUT_INGEST = "enabled";

async function os(route, body = {}, uid = OWNER_A, office = OFFICE_A) {
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${idTokenFor(uid)}` }, body: JSON.stringify({ officeId: office, ...body }) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
async function mcp(token, message, { viaPath = false, method = "POST" } = {}) {
  const headers = { "content-type": "application/json" };
  if (token && !viaPath) headers.authorization = `Bearer ${token}`;
  const response = await h.worker.fetch(new Request(`https://worker.test/mcp${viaPath && token ? `/${token}` : ""}`, { method, headers, body: method === "POST" ? JSON.stringify(message) : undefined }), h.env, { waitUntil() {} });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const call = (token, name, args = {}, id = 7) => mcp(token, { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

await os("/os/scout/settings", { settings: { enabled: true } });
await os("/os/scout/settings", { settings: { enabled: true } }, OWNER_B, OFFICE_B);
const keyA = (await os("/os/mcp/key/create", { label: "ChatGPT" })).body;
const keyB = (await os("/os/mcp/key/create", { label: "ChatGPT" }, OWNER_B, OFFICE_B)).body;

// A find with a phone number in its text, arriving the real way (the office's ingest key → the same scout pipeline).
const ingestKey = (await os("/os/scout/ingest/key/create", { label: "Claude" })).body;
const sent = await h.worker.fetch(new Request("https://worker.test/os/scout/ingest", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${ingestKey.token}` }, body: JSON.stringify({ batchId: "mcp-seed-0001", items: [{ url: "https://listings.example.sa/ad/9001", title: "شقة للبيع في العزيزية", text: "شقة للبيع في حي العزيزية بالمدينة المنورة 3 غرف السعر 500 الف ريال للتواصل 0551234567", tx: "sale", propertyType: "شقة", city: "المدينة المنورة", district: "العزيزية", price: 500000, area: 140 }] }) }), h.env, { waitUntil() {} });
assert.equal(sent.status, 200);
const findId = () => h.store.list(`offices/${OFFICE_A}/scoutOpportunities`)[0]?.id;

test("المفتاح يُنشأ لمدير المكتب فقط ويظهر مرة واحدة", async () => {
  assert.equal(keyA.shownOnce, true);
  assert.match(keyA.token, /^iqk\./);
  const broker = await os("/os/mcp/key/create", {}, BROKER_A2);
  assert.equal(broker.status, 403);
});

test("بروتوكول MCP: initialize وtools/list والإشعارات وping", async () => {
  const init = await mcp(keyA.token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  assert.ok(init.body.result.capabilities.tools);
  const note = await mcp(keyA.token, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(note.status, 202);
  const list = await mcp(keyA.token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual(list.body.result.tools.map((t) => t.name).sort(), TOOLS.map((t) => t.name).sort());
  for (const tool of list.body.result.tools) assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} قراءة فقط`);
  assert.equal((await mcp(keyA.token, { jsonrpc: "2.0", id: 3, method: "ping" })).body.result && true, true);
  assert.equal((await mcp(keyA.token, { jsonrpc: "2.0", id: 4, method: "nope" })).body.error.code, -32601);
});

test("الرفض: بلا مفتاح، مفتاح مزيّف، مفتاح الاستقبال، GET، وكل ذلك دون تسريب سبب", async () => {
  const msg = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  assert.equal((await mcp(null, msg)).status, 401);
  assert.equal((await mcp(keyA.token.slice(0, -3) + "xyz", msg)).status, 401);
  assert.equal((await mcp(ingestKey.token, msg)).status, 401, "مفتاح الاستقبال لا يفتح MCP");
  assert.equal((await mcp(null, null, { method: "GET" })).status, 405);
});

test("المفتاح عبر المسار يعمل كالترويسة", async () => {
  assert.equal((await mcp(keyA.token, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { viaPath: true })).status, 200);
});

test("الأدوات تقرأ بيانات المكتب فقط ولا تُرجع هاتفًا", async () => {
  const finds = await call(keyA.token, "list_finds");
  assert.equal(finds.body.result.isError, false);
  assert.ok(finds.body.result.structuredContent.count >= 1, "الفرصة المستقبَلة تظهر");
  const all = JSON.stringify(finds.body);
  assert.equal(all.includes("0551234567"), false);
  const detail = await call(keyA.token, "get_find", { id: findId() });
  assert.equal(JSON.stringify(detail.body).includes("0551234567"), false, "لا هاتف في التفاصيل");
  assert.equal(detail.body.result.isError, false);
  const overview = await call(keyA.token, "office_overview");
  assert.equal(overview.body.result.isError, false);
  assert.equal((await call(keyA.token, "scout_status")).body.result.isError, false);
  assert.equal((await call(keyA.token, "search_records", { kind: "OFFER" })).body.result.isError, false);
});

test("عزل المكاتب: مفتاح مكتب ب لا يرى فرصة مكتب أ", async () => {
  const other = await call(keyB.token, "get_find", { id: findId() });
  assert.equal(other.body.result.isError, true);
  assert.equal(JSON.stringify(await call(keyB.token, "list_finds")).includes(findId()), false);
  const forged = await call(keyB.token, "get_find", { id: findId(), officeId: OFFICE_A });
  assert.equal(forged.body.result.isError, true, "officeId في الطلب لا يغيّر المكتب");
});

test("أداة مجهولة وإلغاء المفتاح يوقفان الوصول فورًا، والاستدعاء يُسجَّل بلا نص", async () => {
  assert.equal((await call(keyA.token, "send_whatsapp")).body.error.code, -32602);
  const audit = h.store.list(`offices/${OFFICE_A}/auditLogs`).filter((a) => a.action === "MCP_TOOL_CALL");
  assert.ok(audit.length >= 4);
  assert.equal(JSON.stringify(audit).includes("0551234567"), false);
  await os("/os/scout/ingest/key/revoke", { keyId: keyA.key.keyId });
  assert.equal((await call(keyA.token, "list_finds")).status, 401);
});

test("مغلق في Production: لا MCP_SERVER في بيئة الإنتاج", () => {
  const toml = fs.readFileSync(path.join(ROOT, "worker/wrangler.toml"), "utf8");
  const [production, rest] = toml.split("[env.staging]");
  assert.equal(/MCP_SERVER/.test(production), false);
  assert.match(rest.split("[env.preview]")[0], /^MCP_SERVER = "enabled"$/m);
});
