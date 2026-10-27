// Real access-gate UI + real Firebase browser SDK + repository rules, local demo emulator only.
// Run via run-intake-amount-emulator.mjs with FIRESTORE_EMULATOR_JAR set.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const project = "demo-iaqar-financial-verification";
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080", "Refuse non-local or missing emulator");
assert.equal(process.env.GCLOUD_PROJECT, project, "Refuse non-demo project");
const root = path.resolve(import.meta.dirname, "../..");
const out = process.env.INTAKE_EVIDENCE_DIR || "/tmp/iaqar-financial-evidence/browser";
await fs.mkdir(out, { recursive: true });
const api = `http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents`;
const collection = `${api}/offices/platform/publicIntake`;
async function documents() {
  const response = await fetch(`${collection}?pageSize=1000`, { headers: { Authorization: "Bearer owner" } });
  assert.equal(response.status, 200);
  return (await response.json()).documents || [];
}
// This clears only the hard-coded demo emulator, never any hosted project.
const reset = await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${project}/databases/(default)/documents`, { method: "DELETE" });
assert.equal(reset.status, 200);
const shell = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body>
<script src="/sdk/firebase-app-compat.js"></script>
<script src="/sdk/firebase-auth-compat.js"></script>
<script src="/sdk/firebase-firestore-compat.js"></script>
<script>
firebase.initializeApp({projectId:"${project}",apiKey:"demo-key",authDomain:"localhost"});
firebase.firestore().useEmulator("127.0.0.1",8080);
firebase.auth().useEmulator("http://127.0.0.1:9099",{disableWarnings:true});
window.IAQAR={resolveWorkerBase:()=>location.origin};
</script>
<script type="module">
await import('/js/public-client-intake-domain.js');
await import('/js/public-intake-quick-choice-domain.js');
await import('/js/access-gate.js');
</script></body></html>`;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(shell); return;
  }
  if (req.method === "POST" && url.pathname === "/pipeline/public-intake") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, matches: 0 })); return;
  }
  const base = url.pathname.startsWith("/sdk/") ? path.join(root, "node_modules/firebase") : path.join(root, "public");
  const relative = url.pathname.replace(/^\/(?:sdk\/)?/, "");
  const file = path.resolve(base, relative);
  if (!file.startsWith(base + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    const bytes = await fs.readFile(file);
    res.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "application/octet-stream" });
    res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const results = [];
try {
  browser = await chromium.launch();
  for (const kind of ["purchase", "rent"]) {
    for (const valid of [true, false]) {
      const label = `${kind}-${valid ? "valid" : "invalid"}`;
      const context = await browser.newContext({ locale: "ar-SA", viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const page = await context.newPage();
      const errors = [], blocked = [], requests = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => requests.push({ method: request.method(), url: request.url() }));
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.hostname === "127.0.0.1" && [new URL(origin).port, "8080", "9099"].includes(url.port)) return route.continue();
        blocked.push(url.origin); return route.abort("blockedbyclient");
      });
      try {
        await page.goto(origin);
        await page.locator('[data-go="client"]').first().click();
        await page.getByTestId(`intake-chip-purpose-${kind}`).click();
        await page.getByTestId("intake-chip-property-apartment").click();
        await page.locator('[name="city"]').fill("الرياض");
        await page.locator('[name="district"]').fill("حي اختباري");
        await page.locator('[name="name"]').fill("عميل اختباري");
        await page.locator('[name="phone"]').fill("0500000000");
        const raw = valid ? "٦٠٠٬٠٠٠٫٥٠" : "600ريال000";
        await page.locator('[name="priceOrBudget"]').fill(raw);
        assert.equal(await page.locator('[name="priceOrBudget"]').inputValue(), raw);
        const before = await documents();
        await page.locator('#intakeForm button[type="submit"]').click();
        if (valid) {
          await page.waitForFunction(() => document.querySelector("#accessStatus")?.classList.contains("ok"), null, { timeout: 10000 });
        } else {
          await page.waitForFunction(() => document.querySelector("#accessStatus")?.textContent.includes("اكتب المبلغ"));
        }
        const after = await documents();
        assert.equal(after.length, before.length + (valid ? 1 : 0), "Invalid amounts must not create a document");
        let saved = null;
        if (valid) {
          const added = after.find(doc => !before.some(old => old.name === doc.name));
          assert.ok(added);
          // A separate GET proves persisted data, rather than the browser SDK's local cache.
          const readback = await fetch(`http://127.0.0.1:8080/v1/${added.name}`, { headers: { Authorization: "Bearer owner" } });
          assert.equal(readback.status, 200);
          saved = await readback.json();
          for (const field of ["priceOrBudget", "amount", kind === "purchase" ? "budget" : "annualRent"]) {
            assert.equal(Number(saved.fields[field].doubleValue ?? saved.fields[field].integerValue), 600000.50, field);
          }
          assert.equal(saved.fields.requestKind.stringValue, kind);
          assert.equal(saved.fields.transactionType.stringValue, kind);
          await fs.writeFile(path.join(out, `${label}-document.json`), JSON.stringify(saved, null, 2));
        } else {
          assert.equal(requests.filter(item => item.method === "POST" && item.url.includes("Firestore/Write")).length, 0, "Rejected amount must not initiate a Firestore write");
        }
        assert.deepEqual(errors, [], "No browser exceptions");
        assert.deepEqual(blocked, [], "No attempted external connections");
        await page.screenshot({ path: path.join(out, `${label}.png`), fullPage: true });
        results.push({ label, passed: true, input: raw, before: before.length, after: after.length, savedAmount: valid ? 600000.5 : null, errors, blocked });
        console.log(`PASS ${label}: ${raw}; documents ${before.length} -> ${after.length}`);
      } catch (error) {
        await page.screenshot({ path: path.join(out, `${label}-failure.png`), fullPage: true });
        results.push({ label, passed: false, error: error.message, status: await page.locator("#accessStatus").textContent().catch(() => null), errors, blocked });
        console.error(`FAIL ${label}: ${error.message}`);
      } finally { await context.close(); }
    }
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await fs.writeFile(path.join(out, "results.json"), JSON.stringify({ project, results }, null, 2));
}
assert.equal(results.length, 4);
assert.equal(results.filter(result => !result.passed).length, 0, "All four financial browser journeys must pass");
