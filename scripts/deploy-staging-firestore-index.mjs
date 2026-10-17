#!/usr/bin/env node
// Adds the Staging viewing-reminder single-field index without replacing other Firestore indexes.
import { readFileSync } from 'node:fs';
import { createServiceAccountJwt, FIREBASE_TOKEN_URL, parseFirebaseServiceAccountJson } from './staging-credentials.mjs';
import { mergeSingleFieldIndexes, toFirestoreFieldIndexes } from './firestore-single-field-indexes.mjs';

const PROJECT = 'iaqar-ai-staging';
const DATABASE = '(default)';
const FIELD_PATH = 'appointmentAt';
const COLLECTION = 'matches';
const fail = (code) => {
  console.error(`Staging Firestore index repair failed: ${String(code).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 100)}`);
  process.exit(1);
};

if (process.env.IAQAR_DEPLOY_TARGET !== 'staging') fail('staging_target_required');

const config = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8'));
const override = (config.fieldOverrides || []).find((item) => item.collectionGroup === COLLECTION && item.fieldPath === FIELD_PATH);
if (!override) fail('staging_field_override_missing');

const { serviceAccount, invalidFields } = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT);
if (invalidFields.length) fail('staging_service_account_invalid');

async function accessToken() {
  const assertion = createServiceAccountJwt(serviceAccount);
  const response = await fetch(FIREBASE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  if (!response.ok) throw new Error(`oauth_${response.status}`);
  const body = await response.json();
  if (!body.access_token) throw new Error('oauth_token_missing');
  return body.access_token;
}

async function request(token, path, options = {}) {
  const response = await fetch(`https://firestore.googleapis.com/v1/${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers
    }
  });
  if (!response.ok) {
    const error = new Error(`firestore_admin_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

const fieldName = `projects/${PROJECT}/databases/${DATABASE}/collectionGroups/${COLLECTION}/fields/${FIELD_PATH}`;
const defaultFieldName = `projects/${PROJECT}/databases/${DATABASE}/collectionGroups/__default__/fields/*`;

async function getField(token, name) {
  try { return await request(token, name); }
  catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function waitForOperation(token, operation) {
  if (!operation?.name) throw new Error('firestore_operation_missing');
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    if (operation.done) {
      if (operation.error) throw new Error(`firestore_operation_${operation.error.code || 'failed'}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    operation = await request(token, operation.name);
  }
  throw new Error('firestore_operation_timeout');
}

try {
  const token = await accessToken();
  const field = await getField(token, fieldName);
  if (field?.indexConfig?.reverting) throw new Error('field_index_reverting');

  const inherited = !field || field.indexConfig?.usesAncestorConfig === true;
  const ancestorName = field?.indexConfig?.ancestorField || defaultFieldName;
  const base = inherited ? await getField(token, ancestorName) : field;
  const existing = base?.indexConfig?.indexes;
  if (!Array.isArray(existing)) throw new Error('existing_index_config_unavailable');

  const required = toFirestoreFieldIndexes(override);
  const merged = mergeSingleFieldIndexes(existing, required, FIELD_PATH);
  if (merged.length === existing.length) {
    console.log('Staging matches.appointmentAt collection-group index is already configured.');
  } else {
    const operation = await request(token, `${fieldName}?updateMask=indexConfig`, {
      method: 'PATCH',
      body: JSON.stringify({ name: fieldName, indexConfig: { indexes: merged } })
    });
    await waitForOperation(token, operation);
    console.log('Added Staging matches.appointmentAt collection-group index; existing field indexes were preserved.');
  }
} catch (error) {
  fail(error?.message || error?.code || 'unknown_error');
}
