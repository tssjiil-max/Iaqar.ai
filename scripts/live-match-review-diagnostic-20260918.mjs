#!/usr/bin/env node
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { parseFirebaseServiceAccountJson } from './staging-credentials.mjs';

const PROJECT_ID = 'iaqar-ai-staging';
const EXPECTED_OFFICE_IDS = ['thamer', 'staging-wadi-20260829'];
const parsed = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT_ID);
if (!parsed.serviceAccount) throw new Error('STAGING_READ_ACCESS_UNAVAILABLE');

const app = admin.initializeApp({ credential: admin.cert(parsed.serviceAccount), projectId: PROJECT_ID });
const db = getFirestore(app);

const iso = (v) => {
  if (!v) return '';
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (v.seconds != null) return new Date(Number(v.seconds) * 1000).toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
};
const docOfficeId = (doc) => doc.ref.parent.parent?.id || '';
const opType = (op = {}) => String(op.type || op.operationType || '').toUpperCase();
const opMatchId = (op = {}) => String(op.matchId || op.metadata?.matchId || '');
const matchStatusCurrent = (m = {}) => m.isCurrent !== false && String(m.status || '').toLowerCase() !== 'superseded';

async function collectionGroupDocs(name) {
  const snap = await db.collectionGroup(name).get();
  return snap.docs;
}

async function inspectExpectedOffice(officeId) {
  const office = db.collection('offices').doc(officeId);
  const [matchesSnap, opsSnap, oppsSnap] = await Promise.all([
    office.collection('matches').limit(500).get(),
    office.collection('operations').limit(1500).get(),
    office.collection('opportunities').limit(2500).get()
  ]);
  const matches = matchesSnap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
  const ops = opsSnap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
  const opportunities = oppsSnap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
  const currentMatches = matches.filter(matchStatusCurrent)
    .sort((a,b) => iso(b.updatedAt || b.createdAt).localeCompare(iso(a.updatedAt || a.createdAt)));
  const kinds = {};
  for (const opp of opportunities) {
    const key = String(opp.opportunityKind || opp.kind || opp.recordType || 'UNKNOWN').toUpperCase();
    kinds[key] = (kinds[key] || 0) + 1;
  }
  return {
    officeId,
    counts: {
      opportunities: opportunities.length,
      matches: matches.length,
      currentMatches: currentMatches.length,
      operations: ops.length,
      matchReviews: ops.filter(o => opType(o) === 'MATCH_REVIEW').length
    },
    opportunityKinds: kinds,
    latestOpportunityIds: opportunities
      .sort((a,b) => iso(b.updatedAt || b.createdAt).localeCompare(iso(a.updatedAt || a.createdAt)))
      .slice(0,10)
      .map(o => ({ id:o.id, kind:String(o.opportunityKind || o.kind || ''), status:String(o.lifecycleStatus || o.status || ''), updatedAt:iso(o.updatedAt || o.createdAt) })),
    latestCurrentMatches: currentMatches.slice(0,10).map(m => ({
      matchId:m.id, status:String(m.status || ''), score:Number(m.score || m.opportunityScore || 0),
      requestId:String(m.clientRequestId || m.requestId || ''), offerId:String(m.ownerOfferId || m.offerId || ''),
      operationId:String(m.operationId || ''), assignedBrokerId:String(m.assignedBrokerId || ''),
      updatedAt:iso(m.updatedAt || m.createdAt)
    }))
  };
}

const [allMatchDocs, allOperationDocs, allOpportunityDocs] = await Promise.all([
  collectionGroupDocs('matches'),
  collectionGroupDocs('operations'),
  collectionGroupDocs('opportunities')
]);

const allMatches = allMatchDocs.map(doc => ({ id:doc.id, officeId:docOfficeId(doc), ...(doc.data() || {}) }));
const allOperations = allOperationDocs.map(doc => ({ id:doc.id, officeId:docOfficeId(doc), ...(doc.data() || {}) }));
const allOpportunities = allOpportunityDocs.map(doc => ({ id:doc.id, officeId:docOfficeId(doc), ...(doc.data() || {}) }));

const matchReviews = allOperations.filter(op => opType(op) === 'MATCH_REVIEW');
const reviewsByMatch = new Map();
for (const op of matchReviews) {
  const id = opMatchId(op);
  if (!id) continue;
  const list = reviewsByMatch.get(id) || [];
  list.push(op);
  reviewsByMatch.set(id, list);
}

const latestMatches = allMatches
  .filter(matchStatusCurrent)
  .sort((a,b) => iso(b.updatedAt || b.createdAt).localeCompare(iso(a.updatedAt || a.createdAt)))
  .slice(0,20)
  .map(m => {
    const reviews = reviewsByMatch.get(m.id) || [];
    return {
      officeId:m.officeId, matchId:m.id, status:String(m.status || ''), score:Number(m.score || m.opportunityScore || 0),
      requestId:String(m.clientRequestId || m.requestId || ''), offerId:String(m.ownerOfferId || m.offerId || ''),
      assignedBrokerId:String(m.assignedBrokerId || ''), operationIdOnMatch:String(m.operationId || ''),
      updatedAt:iso(m.updatedAt || m.createdAt), matchReviewPresent:reviews.length > 0,
      linkedMatchReviews:reviews.map(op => ({ operationId:op.id, officeId:op.officeId, status:String(op.status || ''), assignedBrokerId:String(op.assignedBrokerId || op.brokerId || ''), updatedAt:iso(op.updatedAt || op.createdAt) }))
    };
  });

function countByOffice(items) {
  const counts = {};
  for (const item of items) counts[item.officeId || '(unknown)'] = (counts[item.officeId || '(unknown)'] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a,b) => b[1]-a[1]));
}

const expectedOffices = [];
for (const officeId of EXPECTED_OFFICE_IDS) {
  try { expectedOffices.push(await inspectExpectedOffice(officeId)); }
  catch (error) { expectedOffices.push({ officeId, error:String(error?.message || error) }); }
}

console.log('LIVE_MATCH_REVIEW_GLOBAL_DIAGNOSTIC');
console.log(JSON.stringify({
  projectId:PROJECT_ID,
  readOnly:true,
  totals:{ opportunities:allOpportunities.length, matches:allMatches.length, operations:allOperations.length, matchReviews:matchReviews.length },
  countsByOffice:{ opportunities:countByOffice(allOpportunities), matches:countByOffice(allMatches), operations:countByOffice(allOperations), matchReviews:countByOffice(matchReviews) },
  latestMatches,
  orphanCurrentMatchesWithoutMatchReview:latestMatches.filter(m => !m.matchReviewPresent),
  expectedOffices
}, null, 2));
await app.delete();
