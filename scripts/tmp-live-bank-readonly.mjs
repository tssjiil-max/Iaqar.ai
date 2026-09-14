import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const STAGING = 'https://iaqar-ai-staging--staging-9c4b0k7h.web.app';
const OUT = process.env.LIVE_DIAG_OUT || '/tmp/live-bank-diagnostic';
mkdirSync(OUT, { recursive: true });

function readExistingQaLogin() {
  const src = readFileSync('scripts/staging-bank-card-click-verify.mjs', 'utf8');
  const phone = src.match(/const PHONE = process\.env\.STAGING_PHONE \|\| "([^"]+)";/)?.[1] || '';
  const password = src.match(/const PASSWORD = process\.env\.STAGING_PASSWORD \|\| "([^"]+)";/)?.[1] || '';
  if (!phone || !password) throw new Error('QA_LOGIN_NOT_FOUND');
  return { phone, password };
}

async function login(page) {
  const { phone, password } = readExistingQaLogin();
  await page.goto(STAGING, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);
  const loginBtn = page.locator('button[data-go="login"]');
  if (await loginBtn.count()) await loginBtn.click();
  await page.waitForTimeout(400);
  await page.locator('#loginForm input[name="phone"]').fill(phone);
  await page.locator('#loginForm input[name="password"]').fill(password);
  await page.locator('#loginForm button[type="submit"]').click();
  await page.waitForTimeout(5000);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-SA', timezoneId: 'Asia/Riyadh' });
const page = await context.newPage();
await login(page);

const report = await page.evaluate(async () => {
  const rt = window.IAQAR?.office;
  if (!rt?.db) throw new Error('OFFICE_RUNTIME_DB_UNAVAILABLE');
  const officeId = String(rt.officeId || '');
  const db = rt.db;
  const load = async (name, limit = 500) => {
    const snap = await db.collection('offices').doc(officeId).collection(name).limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  };
  const ms = (v) => {
    if (!v) return 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (v.seconds != null) return Number(v.seconds) * 1000;
    const n = Date.parse(v); return Number.isFinite(n) ? n : 0;
  };
  const [opportunities, matches, operations] = await Promise.all([
    load('opportunities', 1000), load('matches', 500), load('operations', 1000)
  ]);
  const idsForMatch = (m) => ({
    offerOpportunityId: String(m.offerOpportunityId || m.ownerOfferId || m.offerId || m.metadata?.offerOpportunityId || m.metadata?.ownerOfferId || m.metadata?.offerId || ''),
    requestOpportunityId: String(m.requestOpportunityId || m.clientRequestId || m.requestId || m.metadata?.requestOpportunityId || m.metadata?.clientRequestId || m.metadata?.requestId || '')
  });
  const idsForOp = (o) => ({
    offerOpportunityId: String(o.offerOpportunityId || o.ownerOfferId || o.offerId || o.metadata?.offerOpportunityId || o.metadata?.ownerOfferId || o.metadata?.offerId || ''),
    requestOpportunityId: String(o.requestOpportunityId || o.clientRequestId || o.requestId || o.metadata?.requestOpportunityId || o.metadata?.clientRequestId || o.metadata?.requestId || '')
  });
  const recentMatches = matches.sort((a,b)=>Math.max(ms(b.updatedAt),ms(b.createdAt))-Math.max(ms(a.updatedAt),ms(a.createdAt))).slice(0,20).map((m) => {
    const pair = idsForMatch(m);
    const linkedOps = operations.filter((o) => String(o.matchId || o.metadata?.matchId || '') === String(m.id));
    return {
      matchId: m.id,
      status: String(m.status || ''),
      integrityStatus: String(m.integrityStatus || ''),
      operationIdOnMatch: String(m.operationId || ''),
      ...pair,
      offerExists: opportunities.some((x)=>x.id===pair.offerOpportunityId),
      requestExists: opportunities.some((x)=>x.id===pair.requestOpportunityId),
      createdAt: ms(m.createdAt), updatedAt: ms(m.updatedAt),
      operations: linkedOps.map((o)=>({ operationId:o.id, type:String(o.type||o.operationType||''), status:String(o.status||''), livingStage:String(o.livingStage||o.stage||''), assignedBrokerId:String(o.assignedBrokerId||o.brokerId||o.ownerId||''), ...idsForOp(o), updatedAt:ms(o.updatedAt), createdAt:ms(o.createdAt) }))
    };
  });
  const recentMatchReviewOps = operations.filter((o)=>String(o.type||o.operationType||'').toUpperCase()==='MATCH_REVIEW').sort((a,b)=>Math.max(ms(b.updatedAt),ms(b.createdAt))-Math.max(ms(a.updatedAt),ms(a.createdAt))).slice(0,30).map((o)=>({ operationId:o.id, matchId:String(o.matchId||o.metadata?.matchId||''), type:String(o.type||o.operationType||''), status:String(o.status||''), livingStage:String(o.livingStage||o.stage||''), assignedBrokerId:String(o.assignedBrokerId||o.brokerId||o.ownerId||''), ...idsForOp(o), updatedAt:ms(o.updatedAt), createdAt:ms(o.createdAt) }));
  return { officeId, opportunityCount: opportunities.length, matchCount: matches.length, operationCount: operations.length, recentMatches, recentMatchReviewOps };
});

const safe = JSON.stringify(report, null, 2);
writeFileSync(`${OUT}/report.json`, safe);
console.log('LIVE_BANK_DIAGNOSTIC_START');
console.log(safe);
console.log('LIVE_BANK_DIAGNOSTIC_END');
await browser.close();
