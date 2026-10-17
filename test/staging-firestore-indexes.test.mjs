import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeSingleFieldIndexes, toFirestoreFieldIndexes } from '../scripts/firestore-single-field-indexes.mjs';

test('Staging index repair adds only missing collection-group index and is idempotent', () => {
  const config = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8'));
  const override = config.fieldOverrides.find((item) => item.collectionGroup === 'matches' && item.fieldPath === 'appointmentAt');
  const existing = [
    { queryScope: 'COLLECTION', fields: [{ fieldPath: 'appointmentAt', order: 'ASCENDING' }] },
    { queryScope: 'COLLECTION', fields: [{ fieldPath: 'appointmentAt', order: 'DESCENDING' }] }
  ];

  const required = toFirestoreFieldIndexes(override);
  const updated = mergeSingleFieldIndexes(existing, required, override.fieldPath);
  assert.equal(updated.length, 3);
  assert.ok(updated.some((index) => index.queryScope === 'COLLECTION_GROUP' && index.fields[0].order === 'ASCENDING'));
  assert.deepEqual(mergeSingleFieldIndexes(updated, required, override.fieldPath), updated);
});

test('Staging Wrangler metadata matches the connected Meta app and phone number', () => {
  const wrangler = readFileSync(new URL('../worker/wrangler.toml', import.meta.url), 'utf8');
  const staging = wrangler.split('[env.staging.vars]')[1]?.split('\n[')[0] || '';
  assert.match(staging, /META_APP_ID\s*=\s*"976041872203912"/);
  assert.match(staging, /META_PHONE_NUMBER_ID\s*=\s*"356393440882303"/);
  assert.match(staging, /META_ONBOARDING_MODE\s*=\s*"coexistence"/);
});

test('Staging deploy leaves user-managed Meta secrets intact', () => {
  const deploy = readFileSync(new URL('../scripts/deploy-staging.sh', import.meta.url), 'utf8');
  assert.doesNotMatch(deploy, /wrangler secret put META_(?:APP_SECRET|WEBHOOK_VERIFY_TOKEN|ACCESS_TOKEN)/);
});

test('single-field index merge removes duplicate modes across API scopes', () => {
  const config = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8'));
  const override = config.fieldOverrides.find((item) => item.collectionGroup === 'matches' && item.fieldPath === 'appointmentAt');
  const existing = [
    { queryScope: 'COLLECTION', apiScope: 'DATASTORE_MODE_API', fields: [{ fieldPath: 'appointmentAt', order: 'ASCENDING' }] },
    { queryScope: 'COLLECTION', apiScope: 'ANY_API', fields: [{ fieldPath: 'appointmentAt', order: 'ASCENDING' }] },
    { queryScope: 'COLLECTION', fields: [{ fieldPath: 'appointmentAt', order: 'DESCENDING' }] }
  ];
  const updated = mergeSingleFieldIndexes(existing, toFirestoreFieldIndexes(override), override.fieldPath);
  const modeKey = (index) => JSON.stringify({ queryScope: index.queryScope, fields: index.fields });
  assert.equal(new Set(updated.map(modeKey)).size, updated.length, 'each query scope and field mode must appear once');
  const collectionAscending = updated.find((index) => index.queryScope === 'COLLECTION' && index.fields[0].order === 'ASCENDING');
  assert.equal(collectionAscending.apiScope || 'ANY_API', 'ANY_API');
});
