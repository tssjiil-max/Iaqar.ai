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
const snap = await db.collection('offices').doc(OFFICE_ID).collection('opportunities').get();
const rows = snap.docs.map((doc) => {
  const data = doc.data() || {};
  const readiness = evaluateOpportunityCoreReadiness(data);
  return {
    opportunityId: doc.id,
    opportunityKind: String(data.opportunityKind || data.kind || ''),
    persistedMatchingReadiness: String(data.matchingReadiness || ''),
    computedMatchingReadiness: readiness.matchingReadiness,
    completionStatus: readiness.completionStatus,
    dataCompleteness: readiness.dataCompleteness,
    missingFields: readiness.completionMissingFields,
    matchingMissingFields: readiness.matchingReadinessMissing,
    advertiserRolePresent: Boolean(String(data.advertiserRole || data.ownerRole || '').trim()),
    contactPhonePresent: Boolean(String(data.advertiserPhoneNormalized || data.contactPhone || data.phone || data.advertiserPhoneRaw || '').trim()),
    areaPresent: Number(data.area || 0) > 0
  };
});
console.log('WADI_READINESS_DIAGNOSTIC');
console.log(JSON.stringify({ projectId: PROJECT_ID, officeId: OFFICE_ID, readOnly: true, rows }, null, 2));
await app.delete();
