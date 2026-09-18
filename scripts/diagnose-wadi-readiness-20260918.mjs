#!/usr/bin/env node
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { parseFirebaseServiceAccountJson } from './staging-credentials.mjs';
import { evaluateOpportunityCoreReadiness } from '../public/js/opportunity-readiness-domain.js';

const PROJECT_ID = 'iaqar-ai-staging';
const OFFICE_ID = 'staging-wadi-20260829';
const parsed = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT_ID);
if (!parsed.serviceAccount) throw new Error('STAGING_READ_ACCESS_UNAVAILABLE');

const app = admin.initializeApp({ credential: admin.cert(parsed.serviceAccount), projectId: PROJECT_ID });
const db = getFirestore(app);
const iso = (v) => {
  if (!v) return '';
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (v.seconds != null) return new Date(Number(v.seconds) * 1000).toISOString();
  const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toISOString();
};
const snap = await db.collection('offices').doc(OFFICE_ID).collection('opportunities').get();
const rows = snap.docs.map((doc) => {
  const data = doc.data() || {};
  const readiness = evaluateOpportunityCoreReadiness(data);
  return {
    opportunityId: doc.id,
    opportunityKind: String(data.opportunityKind || data.kind || ''),
    advertiserRole: String(data.advertiserRole || data.ownerRole || ''),
    sourceType: String(data.sourceType || ''),
    sourceChannel: String(data.sourceChannel || ''),
    internalStatus: String(data.internalStatus || ''),
    lifecycleStatus: String(data.lifecycleStatus || data.status || ''),
    persistedMatchingReadiness: String(data.matchingReadiness || ''),
    computedMatchingReadiness: readiness.matchingReadiness,
    dataCompleteness: readiness.dataCompleteness,
    missingFields: readiness.completionMissingFields,
    contactPhonePresent: Boolean(String(data.advertiserPhoneNormalized || data.contactPhone || data.phone || data.advertiserPhoneRaw || '').trim()),
    areaPresent: Number(data.area || 0) > 0,
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt)
  };
});
console.log('WADI_READINESS_SOURCE_DIAGNOSTIC');
console.log(JSON.stringify({ projectId: PROJECT_ID, officeId: OFFICE_ID, readOnly: true, rows }, null, 2));
await app.delete();
