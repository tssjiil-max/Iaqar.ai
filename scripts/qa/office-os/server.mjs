// Office OS local harness — the real Worker (worker/src/index.js, incl. /os routes)
// behind the in-memory Firestore REST double, serving the real new UI (public/) with a
// Firebase compat stub. Isolated test data only; nothing leaves the machine.
//
//   node scripts/qa/office-os/server.mjs            → prints the local URL
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.env.REPO_ROOT || path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const { installMemoryFirestore, PROJECT } = await import(path.join(ROOT, "scripts/qa/match-negotiation-e2e/server.mjs"));

export const OFFICE_A = "office-alpha";
export const OFFICE_B = "office-beta";
export const OWNER_A = "uid-owner-a";
export const BROKER_A2 = "uid-broker-a2";
export const OWNER_B = "uid-owner-b";
export const USERS = {
  [OWNER_A]: { phone: "0501111111", email: "owner-a@test.local", officeId: OFFICE_A, password: "pass-a" },
  [BROKER_A2]: { phone: "0502222222", email: "broker-a2@test.local", officeId: OFFICE_A, password: "pass-a2" },
  [OWNER_B]: { phone: "0503333333", email: "owner-b@test.local", officeId: OFFICE_B, password: "pass-b" }
};

function b64url(buf) { return Buffer.from(buf).toString("base64url"); }
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "e2e-kid", alg: "RS256", use: "sig" };

export function idTokenFor(uid) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", kid: "e2e-kid", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: uid, iat: now, exp: now + 3600 }));
  return `${header}.${claims}.${b64url(crypto.sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), privateKey))}`;
}

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

export async function startOfficeOsHarness({ port = 0 } = {}) {
  const store = installMemoryFirestore({ jwk });
  const sa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const env = {
    FIREBASE_PROJECT_ID: PROJECT,
    FIREBASE_CLIENT_EMAIL: "e2e@demo-iaqar.iam.gserviceaccount.com",
    FIREBASE_PRIVATE_KEY: sa.privateKey,
    FIREBASE_PRIVATE_KEY_ID: "0123456789abcdef0123456789abcdef01234567",
    DEPLOYMENT_ENV: "staging",
    // In-memory media bucket (what R2 is in production) so share-card uploads work without a 503.
    IAQAR_MEDIA: (() => { const objects = new Map(); return { put: async (key, bytes, meta = {}) => { objects.set(key, { bytes: Buffer.from(bytes), type: meta.httpMetadata?.contentType }); }, get: async (key) => (objects.has(key) ? { body: objects.get(key).bytes, writeHttpMetadata(h) { if (objects.get(key).type) h.set("content-type", objects.get(key).type); } } : null) }; })(),
    APP_ORIGIN: ""
  };
  const officeA = {
    officeId: OFFICE_A, officeName: "مكتب سلطان العقاري", brokerName: "سلطان الصاعدي", licenseNumber: "1200012345",
    city: "الرياض", phone: "0501111111", whatsapp: "0501111111", ownerUid: OWNER_A, active: true, publicSlug: "sultan",
    specialties: ["sale", "rent"], platformOpportunityOnboardingAckAt: "2026-09-01T00:00:00Z"
  };
  const officeB = {
    officeId: OFFICE_B, officeName: "مكتب الأفق للعقار", brokerName: "مالك الأفق", licenseNumber: "1200099999",
    city: "الرياض", phone: "0503333333", ownerUid: OWNER_B, active: true, publicSlug: "ofoq", specialties: ["sale"],
    platformOpportunityOnboardingAckAt: "2026-09-01T00:00:00Z"
  };
  store.seed(`offices/${OFFICE_A}`, officeA);
  store.seed(`publicOffices/${OFFICE_A}`, officeA);
  store.seed(`offices/${OFFICE_B}`, officeB);
  store.seed(`publicOffices/${OFFICE_B}`, officeB);
  store.seed(`offices/${OFFICE_A}/members/${OWNER_A}`, { uid: OWNER_A, role: "owner", active: true });
  store.seed(`offices/${OFFICE_A}/members/${BROKER_A2}`, { uid: BROKER_A2, role: "broker", active: true, displayName: "نواف الوسيط" });
  store.seed(`offices/${OFFICE_B}/members/${OWNER_B}`, { uid: OWNER_B, role: "owner", active: true });
  for (const [uid, user] of Object.entries(USERS)) {
    store.seed(`loginDirectory/${sha256(`+966${user.phone.slice(1)}`)}`, { uid, officeId: user.officeId, email: user.email, phone: `+966${user.phone.slice(1)}`, active: true });
    store.seed(`loginDirectory/${sha256(user.phone)}`, { uid, officeId: user.officeId, email: user.email, phone: user.phone, active: true });
    store.seed(`loginDirectory/${sha256(`966${user.phone.slice(1)}`)}`, { uid, officeId: user.officeId, email: user.email, phone: user.phone, active: true });
  }
  // Office B has its own records: they must never appear in Office A.
  store.seed(`offices/${OFFICE_B}/opportunities/opp_b_offer`, {
    officeId: OFFICE_B, opportunityKind: "OFFER", purpose: "SALE", transactionType: "sale", propertyType: "شقة", city: "الرياض",
    district: "الملقا", priceOrBudget: 1250000, salePrice: 1250000, advertiserRole: "OWNER", contactPhone: "0559999999",
    contactName: "مالك مكتب آخر", lifecycleStatus: "ACTIVE", brokerId: OWNER_B, version: 1, deduplicationFingerprint: "b", createdAt: "2026-09-29T08:00:00.000Z"
  });

  const workerModule = await import(path.join(ROOT, "worker/src/index.js"));
  const worker = workerModule.default;
  const stub = fs.readFileSync(new URL("./firebase-stub.js", import.meta.url), "utf8");
  const origin = { value: "" };
  const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };

  const injectShell = (html) => html
    .replace(/<script src="https:\/\/www\.gstatic\.com[^>]*><\/script>\s*/g, "")
    .replace('<script src="/__/firebase/init.js"></script>', `<script>${stub}</script>`)
    .replace('<script src="/js/runtime-config.js"></script>', '<script src="/js/runtime-config.js"></script>\n  <script>window.IAQAR.workerBase = location.origin + "/worker";</script>');

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://local");
      const send = (status, type, body) => { res.writeHead(status, { "content-type": type, "cache-control": "no-store" }); res.end(body); };
      if (url.pathname === "/harness/token") return send(200, "text/plain", idTokenFor(url.searchParams.get("uid") || ""));
      if (url.pathname === "/harness/signin") {
        const email = url.searchParams.get("email");
        const password = url.searchParams.get("password");
        const entry = Object.entries(USERS).find(([, u]) => u.email === email && u.password === password);
        return entry ? send(200, "application/json", JSON.stringify({ uid: entry[0] })) : send(401, "application/json", "{}");
      }
      if (url.pathname === "/harness/signup") {
        const email = url.searchParams.get("email");
        if (Object.values(USERS).some((u) => u.email === email)) return send(409, "application/json", "{}");
        const uid = `qa-signup-${Date.now()}-${Object.keys(USERS).length}`;
        USERS[uid] = { phone: "", email, officeId: "", password: url.searchParams.get("password") };
        return send(200, "application/json", JSON.stringify({ uid }));
      }
      if (url.pathname === "/harness/signup-delete") { delete USERS[url.searchParams.get("uid")]; return send(200, "application/json", "{}"); }
      if (url.pathname === "/store/list") return send(200, "application/json", JSON.stringify(store.list(url.searchParams.get("path"))));
      if (url.pathname === "/store/get") return send(200, "application/json", JSON.stringify(store.get(url.searchParams.get("path"))));
      if (url.pathname === "/harness/write" && req.method === "POST") {
        const chunks = []; for await (const c of req) chunks.push(c);
        const { path: docPath, data, merge, delete: del } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        // The stub is not a rules engine; allow only the client writes the real rules allow
        // (managers: their own office profile, its public mirror, name claims, office settings).
        const allowed = /^offices\/[^/]+\/publicIntake\/[^/]+$/.test(docPath)
          || /^offices\/[^/]+\/officeSettings\/(assignment|deals|cooperation|notifications)$/.test(docPath)
          || /^offices\/[^/]+\/brokerSettings\/[^/]+$/.test(docPath)
          || /^(offices|publicOffices)\/[^/]+$/.test(docPath)
          || /^officeNameClaims\/[^/]+$/.test(docPath);
        if (!allowed) return send(403, "application/json", JSON.stringify({ error: "permission-denied" }));
        if (del) store.remove(docPath); else if (merge) store.patch(docPath, data); else store.seed(docPath, data);
        return send(200, "application/json", "{}");
      }
      if (url.pathname.startsWith("/worker/")) {
        const chunks = []; for await (const c of req) chunks.push(c);
        const request = new Request(`https://worker.test${url.pathname.slice("/worker".length)}${url.search}`, {
          method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks)
        });
        env.APP_ORIGIN = origin.value;
        const response = await worker.fetch(request, env, { waitUntil() {} });
        const body = Buffer.from(await response.arrayBuffer());
        server.workerCalls.push({ path: url.pathname, status: response.status, body: body.toString("utf8").slice(0, 600) });
        res.writeHead(response.status, { "content-type": response.headers.get("content-type") || "application/json" });
        return res.end(body);
      }
      let file = decodeURIComponent(url.pathname);
      // Mirrors firebase.json rewrites: /o/**, /m/**, /add, /add/** → index.html
      if (file === "/" || /^\/(o|m)\//.test(file) || /^\/add(\/|$)/.test(file)) file = "/index.html";
      if (file === "/r") file = "/r.html";
      if (file === "/s") file = "/s.html";
      const full = path.join(ROOT, "public", file);
      if (!full.startsWith(path.join(ROOT, "public")) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return send(404, "text/plain", "not found");
      const ext = path.extname(full);
      let body = fs.readFileSync(full);
      if (file === "/index.html" || file === "/r.html" || file === "/s.html") body = injectShell(body.toString("utf8"));
      send(200, `${TYPES[ext] || "application/octet-stream"}; charset=utf-8`, body);
    } catch (error) {
      res.writeHead(500); res.end(String(error?.stack || error));
    }
  });
  server.workerCalls = [];
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  origin.value = `http://127.0.0.1:${server.address().port}`;
  return { server, store, env, worker, origin: origin.value, port: server.address().port };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const h = await startOfficeOsHarness({ port: Number(process.env.PORT || 4173) });
  console.log(`Office OS harness: ${h.origin}/  (owner 0501111111 / pass-a · broker 0502222222 / pass-a2 · other office 0503333333 / pass-b)`);
}
