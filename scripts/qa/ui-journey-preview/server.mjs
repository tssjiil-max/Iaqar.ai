// Local UI preview: real public/ app + real Worker on an in-memory Firestore double.
// All data is local fixture data. No network calls leave the machine.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.env.REPO_ROOT || path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const harness = await import(path.join(ROOT, "scripts/qa/match-negotiation-e2e/server.mjs"));
const { installMemoryFirestore, toFields, PROJECT, OFFICE, UID, REQUEST_ID, OFFER_ID } = harness;

function b64url(buf) { return Buffer.from(buf).toString("base64url"); }
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "e2e-kid", alg: "RS256", use: "sig" };

export async function startPreview({ port = 0 } = {}) {
  const store = installMemoryFirestore({ jwk });
  const sa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const env = { FIREBASE_PROJECT_ID: PROJECT, FIREBASE_CLIENT_EMAIL: "e2e@demo-iaqar.iam.gserviceaccount.com", FIREBASE_PRIVATE_KEY: sa.privateKey, FIREBASE_PRIVATE_KEY_ID: "0123456789abcdef0123456789abcdef01234567", DEPLOYMENT_ENV: "staging" };
  const idToken = () => {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: "RS256", kid: "e2e-kid", typ: "JWT" }));
    const claims = b64url(JSON.stringify({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: UID, iat: now, exp: now + 3600 }));
    return `${header}.${claims}.${b64url(crypto.sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), privateKey))}`;
  };
  const officeDoc = { officeName: "مكتب المعاينة المحلية", brokerName: "وسيط تجريبي", licenseNumber: "1100000000", city: "المدينة المنورة",
    ownerUid: UID, active: true, publicSlug: "preview-office", specialties: ["بيع", "إيجار"], neighborhoods: ["العزيزية", "قباء"],
    platformOpportunityOnboardingAckAt: "2026-09-01T00:00:00Z" };
  store.seed(`offices/${OFFICE}`, officeDoc);
  store.seed(`publicOffices/${OFFICE}`, { ...officeDoc, officeId: OFFICE });
  store.seed(`offices/${OFFICE}/members/${UID}`, { uid: UID, role: "owner", active: true, approved: true });
  const listing = { officeId: OFFICE, city: "المدينة المنورة", district: "العزيزية", propertyType: "شقة", lifecycleStatus: "ACTIVE", version: 1 };
  store.seed(`offices/${OFFICE}/opportunities/${REQUEST_ID}`, { ...listing, opportunityKind: "REQUEST", purpose: "PURCHASE", advertiserRole: "CLIENT",
    budget: 900000, priceOrBudget: 900000, contactPhone: "0550000001", contactName: "عميل تجريبي", referenceCode: "REQ-PRV-1",
    brokerId: UID, createdAt: "2026-09-28T08:00:00.000Z", updatedAt: "2026-09-28T08:00:00.000Z" });
  store.seed(`offices/${OFFICE}/opportunities/${OFFER_ID}`, { ...listing, opportunityKind: "OFFER", purpose: "SALE", advertiserRole: "OWNER",
    salePrice: 880000, priceOrBudget: 880000, area: 180, contactPhone: "0550000002", contactName: "مالك تجريبي", referenceCode: "OFF-PRV-1",
    brokerId: UID, createdAt: "2026-09-28T07:00:00.000Z", updatedAt: "2026-09-28T07:00:00.000Z" });

  const workerModule = await import(path.join(ROOT, "worker/src/index.js"));
  const worker = workerModule.default;
  await workerModule.findAndSaveMatchesForOpportunity({ projectId: PROJECT, officeId: OFFICE, opportunityId: REQUEST_ID, accessToken: "e2e-access", notify: false, env });
  const match = store.list(`offices/${OFFICE}/matches`).find((m) => m.isCurrent !== false);
  const matchOperation = store.list(`offices/${OFFICE}/operations`).find((op) => String(op.type).toUpperCase() === "MATCH_REVIEW");

  const deal = { recordType: "deal", recordId: "deal_preview_1", dealId: "deal_preview_1", id: "deal_preview_1", status: "negotiation", stage: "negotiation",
    propertyType: "شقة", district: "العزيزية", matchId: "", officeId: OFFICE,
    createdAt: "2026-09-28T10:00:00.000Z" };
  store.seed(`offices/${OFFICE}/deals/${deal.id}`, deal);
  const stub = fs.readFileSync(new URL("./firebase-stub.js", import.meta.url), "utf8");
  const fontCss = ["400", "500", "700", "800"].map((w) => `@font-face{font-family:"Tajawal";font-weight:${w};src:url(/fonts/tajawal/tajawal-${w}.woff2) format("woff2")}`).join("\n");
  const types = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json" };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://local");
      const send = (status, type, body) => { res.writeHead(status, { "content-type": type }); res.end(body); };
      if (url.pathname === "/__preview/firebase.js") return send(200, "text/javascript", stub);
      if (url.pathname === "/__preview/fonts.css") return send(200, "text/css", fontCss);
      if (url.pathname === "/__/firebase/init.js") return send(200, "text/javascript", "/* preview */");
      if (url.pathname === "/token") return send(200, "text/plain", idToken());
      if (url.pathname === "/store/list") return send(200, "application/json", JSON.stringify(store.list(url.searchParams.get("path"))));
      if (url.pathname === "/store/get") return send(200, "application/json", JSON.stringify(store.get(url.searchParams.get("path"))));
      if (url.pathname === "/__preview/write" || url.pathname === "/__preview/delete") {
        const chunks = []; for await (const c of req) chunks.push(c);
        if (url.pathname.endsWith("delete")) { store.remove(url.searchParams.get("path")); return send(200, "application/json", "{}"); }
        const { path: p, data, merge } = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (merge) store.patch(p, data); else store.seed(p, data);
        server.clientWrites.push(p);
        return send(200, "application/json", "{}");
      }
      if (url.pathname.startsWith("/worker/")) {
        const chunks = []; for await (const c of req) chunks.push(c);
        const request = new Request(`https://worker.test${url.pathname.slice("/worker".length)}${url.search}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
        const response = await worker.fetch(request, env, { waitUntil() {} });
        const body = Buffer.from(await response.arrayBuffer());
        server.workerCalls.push({ path: url.pathname, status: response.status });
        res.writeHead(response.status, { "content-type": response.headers.get("content-type") || "application/json", "access-control-allow-origin": "*" });
        return res.end(body);
      }
      let rel = decodeURIComponent(url.pathname);
      if (rel === "/" || /^\/(m|o)\//.test(rel) || rel === "/add") rel = "/index.html";
      const file = path.join(ROOT, "public", rel);
      if (!file.startsWith(path.join(ROOT, "public")) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(404, "text/plain", "");
      let body = fs.readFileSync(file);
      if (rel === "/index.html") {
        body = body.toString("utf8")
          .replace("https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js", "/__preview/firebase.js")
          .replace(/document\.write\('<script src="https:\/\/www\.gstatic\.com[^']*'\);/g, "")
          .replace("https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;600;700;800&display=swap", "/__preview/fonts.css")
          .replace("<head>", `<head><script>window.IAQAR=Object.assign(window.IAQAR||{},{workerBase:location.origin+"/worker"});window.__PREVIEW_SIGNED_IN__=${JSON.stringify(!/[?&]signedOut=1/.test(req.url))};</script>`);
      }
      send(200, `${types[path.extname(file)] || "application/octet-stream"}; charset=utf-8`, body);
    } catch (error) { res.writeHead(500); res.end(String(error?.stack || error)); }
  });
  server.workerCalls = []; server.clientWrites = [];
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { server, store, env, worker, match, deal, matchOperation, port: server.address().port, OFFICE };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const p = await startPreview({ port: Number(process.env.PORT || 8787) });
  console.log(`preview on http://127.0.0.1:${p.port}  match=${p.match?.id} op=${p.matchOperation?.id}`);
}
