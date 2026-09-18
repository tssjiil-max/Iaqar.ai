#!/usr/bin/env node
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { parseFirebaseServiceAccountJson } from './staging-credentials.mjs';

const PROJECT_ID = 'iaqar-ai-staging';
const OFFICE_IDS = ['thamer', 'staging-wadi-20260829'];
const parsed = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT_ID);
if (!parsed.serviceAccount) throw new Error('STAGING_READ_ACCESS_UNAVAILABLE');

const app = admin.initializeApp({ credential: admin.cert(parsed.serviceAccount), projectId: PROJECT_ID });
const db = getFirestore(app);

const iso = (v) => {
  if (!v) return '';
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (v.seconds != null) return new Date(Number(v.seconds) * 1000).toISOString();
  const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
};

function opType(op = {}) { return String(op.type || op.operationType || '').toUpperCase(); }
function opMatchId(op = {}) { return String(op.matchId || op.metadata?.matchId || ''); }

async function inspectOffice(officeId) {
  const office = db.collection('offices').doc(officeId);
  const [matchesSnap, opsSnap] = await Promise.all([
    office.collection('matches').orderBy('createdAt', 'desc').limit(50).get(),
    office.collection('operations').limit(1000).get()
  ]);
  const matches = matchesSnap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
  const ops = opsSnap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
  const currentMatches = matches.filter(m => m.isCurrent !== false && String(m.status || '').toLowerCase() !== 'superseded');
  const latest = currentMatches[0] || matches[0] || null;
  const linked = latest ? ops.filter(op => opMatchId(op) === latest.id) : [];
  const reviews = linked.filter(op => opType(op) === 'MATCH_REVIEW');
  const allActiveReviews = ops.filter(op => opType(op) === 'MATCH_REVIEW' && !['COMPLETED','EXPIRED','CANCELLED','CLOSED'].includes(String(op.status || '').toUpperCase()));
  return {
    officeId,
    counts: { matches: matches.length, operations: ops.length, activeMatchReviews: allActiveReviews.length },
    latestMatch: latest ? {
      matchId: latest.id,
      status: String(latest.status || ''),
      isCurrent: latest.isCurrent !== false,
      score: Number(latest.score || latest.opportunityScore || 0),
      createdAt: iso(latest.createdAt),
      updatedAt: iso(latest.updatedAt),
      assignedBrokerId: String(latest.assignedBrokerId || ''),
      operationIdOnMatch: String(latest.operationId || ''),
      requestId: String(latest.clientRequestId || latest.requestId || ''),
      offerId: String(latest.ownerOfferId || latest.offerId || ''),
      linkedOperations: linked.map(op => ({
        operationId: op.id,
        type: opType(op),
        status: String(op.status || ''),
        assignedBrokerId: String(op.assignedBrokerId || op.brokerId || ''),
        opportunityId: String(op.opportunityId || ''),
        matchId: opMatchId(op),
        createdAt: iso(op.createdAt),
        updatedAt: iso(op.updatedAt)
      })),
      matchReviewPresent: reviews.length > 0,
      matchReviewCount: reviews.length
    } : null,
    recentMatchReviews: allActiveReviews
      .sort((a,b) => String(iso(b.updatedAt || b.createdAt)).localeCompare(String(iso(a.updatedAt || a.createdAt))))
      .slice(0,10)
      .map(op => ({ operationId: op.id, matchId: opMatchId(op), status: String(op.status || ''), assignedBrokerId: String(op.assignedBrokerId || op.brokerId || ''), updatedAt: iso(op.updatedAt || op.createdAt) }))
  };
}

const results = [];
for (const officeId of OFFICE_IDS) {
  try { results.push(await inspectOffice(officeId)); }
  catch (error) { results.push({ officeId, error: String(error?.message || error) }); }
}
console.log('LIVE_MATCH_REVIEW_DIAGNOSTIC');
console.log(JSON.stringify({ projectId: PROJECT_ID, readOnly: true, results }, null, 2));
await app.delete();
