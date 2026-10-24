/**
 * B-02 — phone login without disclosure (D-021), through the real Worker.
 *
 *   /auth/phone-login-resolve  retired: it returned the account's real email and officeId to anyone.
 *   /auth/phone-login          the only way in: phone + password → custom token. Every failure is the same
 *                              401 body, padded to the same minimum time. Every attempt is counted atomically,
 *                              before the password check, per phone (across IPs) and per IP (across phones,
 *                              unknown numbers included), so a parallel burst cannot outrun the limit. The
 *                              password check only counts when Google's ID token is for THIS project and THIS
 *                              account.
 *   /auth/forgot-password      the same generic answer for every number; never a (masked) email.
 *
 * This is an interim control approved by the owner: it does not prove possession of the phone number.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startOfficeOsHarness, USERS, OFFICE_A, OWNER_A, idTokenFor, foreignProjectIdTokenFor } from '../scripts/qa/office-os/server.mjs';

const h = await startOfficeOsHarness();
test.after(() => h.server.close());
h.env.LOGIN_FAILURE_FLOOR_MS = '0';

const sha = (v) => createHash('sha256').update(v).digest('hex');
let seq = 0;
/** A fresh account with its own phone, so rate-limit buckets never leak between tests. */
function newAccount({ active = true, password = 'correct-horse-9' } = {}) {
  seq += 1;
  const uid = `uid-b02-${seq}`;
  const local = `05${String(70000000 + seq).padStart(8, '0')}`;
  const canonical = `+966${local.slice(1)}`;
  const email = `b02-${seq}@test.local`;
  USERS[uid] = { phone: local, email, officeId: OFFICE_A, password };
  h.store.seed(`loginDirectory/${sha(canonical)}`, { uid, officeId: OFFICE_A, email, phone: canonical, active });
  h.store.seed(`offices/${OFFICE_A}/members/${uid}`, { uid, role: 'broker', active: true });
  return { uid, local, canonical, email, password };
}
const unknownPhone = () => { seq += 1; return `05${String(60000000 + seq).padStart(8, '0')}`; };
const ip = () => { seq += 1; return `198.51.100.${seq % 250}`; };

async function post(path, body, { from = '203.0.113.7' } = {}) {
  const started = Date.now();
  const response = await h.worker.fetch(new Request(`https://worker.test${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': from }, body: JSON.stringify(body)
  }), h.env, { waitUntil() {} });
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text || '{}'), ms: Date.now() - started };
}
const login = (phone, password, opts) => post('/auth/phone-login', { phone, password, apiKey: 'harness-api-key' }, opts);
const shape = (r) => ({ status: r.status, keys: Object.keys(r.body).filter((k) => k !== 'requestId').sort(), body: { ...r.body, requestId: undefined } });
const leaks = (r, account) => [account.email, OFFICE_A, account.uid, 'directory_missing', 'directory_inactive'].filter((s) => r.text.includes(s));

// ── Retired resolve route ─────────────────────────────────────────────────────────────────────────
test('resolve route is retired: no email, office or existence signal for a registered or unknown number', async () => {
  const account = newAccount();
  const known = await post('/auth/phone-login-resolve', { phone: account.local });
  const unknown = await post('/auth/phone-login-resolve', { phone: unknownPhone() });
  assert.equal(known.status, 410);
  assert.deepEqual(shape(known), shape(unknown));
  assert.deepEqual(leaks(known, account), []);
});

// ── Login ─────────────────────────────────────────────────────────────────────────────────────────
test('the right phone and password sign in with a custom token for that account', async () => {
  const account = newAccount();
  const r = await login(account.local, account.password, { from: ip() });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.officeId, OFFICE_A);
  const payload = JSON.parse(Buffer.from(r.body.customToken.split('.')[1], 'base64url').toString());
  assert.equal(payload.uid, account.uid);
});

test('every failure looks the same: wrong password, unknown number, inactive account, bad input', async () => {
  const account = newAccount();
  const inactive = newAccount({ active: false });
  const cases = [
    await login(account.local, 'wrong-password-1', { from: ip() }),
    await login(unknownPhone(), 'whatever-123', { from: ip() }),
    await login(inactive.local, inactive.password, { from: ip() }),
    await login('12345', 'whatever-123', { from: ip() }),
    await login(account.local, '', { from: ip() })
  ];
  for (const r of cases) {
    assert.equal(r.status, 401, r.text);
    assert.deepEqual(shape(r), shape(cases[0]));
    assert.equal(r.body.reason, undefined);
    assert.deepEqual(leaks(r, account), []);
    assert.deepEqual(leaks(r, inactive), []);
  }
});

test('a correctly signed token for ANOTHER Firebase project never opens the account', async () => {
  const account = newAccount();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('accounts:signInWithPassword')) {
      return Response.json({ localId: account.uid, email: account.email, idToken: foreignProjectIdTokenFor(account.uid) });
    }
    return realFetch(input, init);
  };
  try {
    const r = await login(account.local, 'attacker-password', { from: ip() });
    assert.equal(r.status, 401, r.text);
    assert.equal(r.body.customToken, undefined);
  } finally { globalThis.fetch = realFetch; }
});

test('a token for this project but another account never opens the account', async () => {
  const account = newAccount();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('accounts:signInWithPassword')) return Response.json({ localId: account.uid, idToken: idTokenFor('uid-someone-else') });
    return realFetch(input, init);
  };
  try {
    const r = await login(account.local, 'whatever-123', { from: ip() });
    assert.equal(r.status, 401);
    assert.equal(r.body.customToken, undefined);
  } finally { globalThis.fetch = realFetch; }
});

test('the server\'s own web API key wins over one sent in the request body', async () => {
  const account = newAccount();
  h.env.FIREBASE_WEB_API_KEY = 'server-web-key';
  try {
    const before = h.identityCalls.length;
    await post('/auth/phone-login', { phone: account.local, password: account.password, apiKey: 'attacker-key' }, { from: ip() });
    const call = h.identityCalls.slice(before).find((c) => c.path.endsWith('accounts:signInWithPassword'));
    assert.equal(call.apiKey, 'server-web-key');
  } finally { delete h.env.FIREBASE_WEB_API_KEY; }
});

// ── Guessing limits ───────────────────────────────────────────────────────────────────────────────
test('per number: 10 wrong passwords from 10 different IPs lock that number, even for the right password', async () => {
  const account = newAccount();
  for (let i = 0; i < 10; i += 1) assert.equal((await login(account.local, `wrong-${i}-pass`, { from: ip() })).status, 401);
  const before = h.identityCalls.length;
  const locked = await login(account.local, account.password, { from: ip() });
  assert.equal(locked.status, 401);
  assert.equal(h.identityCalls.length, before, 'no password check is even attempted while locked');
});

test('per IP: 30 attempts on different (unknown) numbers lock that IP for every number', async () => {
  const from = ip();
  for (let i = 0; i < 30; i += 1) assert.equal((await login(unknownPhone(), 'guess-1234', { from })).status, 401);
  const account = newAccount();
  const blocked = await login(account.local, account.password, { from });
  assert.equal(blocked.status, 401);
  assert.equal((await login(account.local, account.password, { from: ip() })).status, 200, 'the same account still works from elsewhere');
});

test('a locked attempt is indistinguishable from a wrong password', async () => {
  const account = newAccount();
  const wrong = await login(account.local, 'wrong-a-pass', { from: ip() });
  for (let i = 0; i < 10; i += 1) await login(account.local, `wrong-${i}-pass`, { from: ip() });
  const locked = await login(account.local, account.password, { from: ip() });
  assert.deepEqual(shape(locked), shape(wrong));
});

test('a few typos before the right password still sign in', async () => {
  const account = newAccount();
  for (let i = 0; i < 3; i += 1) await login(account.local, `typo-${i}-pass`, { from: ip() });
  assert.equal((await login(account.local, account.password, { from: ip() })).status, 200);
});

test('a parallel burst cannot outrun the per-number limit: 40 at once → at most 10 password checks', async () => {
  const account = newAccount();
  const before = h.identityCalls.length;
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) => login(account.local, `burst-${i}-pass`, { from: ip() })));
  const checks = h.identityCalls.slice(before).filter((c) => c.path.endsWith('accounts:signInWithPassword')).length;
  assert.ok(checks <= 10, `${checks} password checks`);
  for (const r of results) assert.equal(r.status, 401);
  assert.equal((await login(account.local, account.password, { from: ip() })).status, 401, 'still locked for this window');
});

test('timing: unknown numbers and wrong passwords both wait for the same minimum time', async () => {
  h.env.LOGIN_FAILURE_FLOOR_MS = '250';
  try {
    const account = newAccount();
    const unknown = await login(unknownPhone(), 'guess-1234', { from: ip() });
    const wrong = await login(account.local, 'wrong-pass-1', { from: ip() });
    assert.ok(unknown.ms >= 240, `unknown ${unknown.ms}ms`);
    assert.ok(wrong.ms >= 240, `wrong ${wrong.ms}ms`);
  } finally { h.env.LOGIN_FAILURE_FLOOR_MS = '0'; }
});

test('the password never reaches the logs', async () => {
  const account = newAccount();
  const secret = 'Pw-must-not-be-logged-77';
  const lines = [];
  const originals = { warn: console.warn, error: console.error, log: console.log, info: console.info };
  for (const k of Object.keys(originals)) console[k] = (...a) => lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  try {
    await login(account.local, secret, { from: ip() });
    await login(unknownPhone(), secret, { from: ip() });
  } finally { Object.assign(console, originals); }
  assert.ok(!lines.join('\n').includes(secret));
});

// ── Password reset ────────────────────────────────────────────────────────────────────────────────
test('password reset: the same answer for a registered and an unknown number, and never an email', async () => {
  const account = newAccount();
  const before = h.identityCalls.length;
  const known = await post('/auth/forgot-password', { phone: account.local, apiKey: 'harness-api-key' }, { from: ip() });
  const unknown = await post('/auth/forgot-password', { phone: unknownPhone(), apiKey: 'harness-api-key' }, { from: ip() });
  assert.equal(known.status, 200);
  assert.deepEqual(shape(known), shape(unknown));
  assert.equal(known.body.maskedEmail, undefined);
  assert.deepEqual(leaks(known, account), []);
  const sent = h.identityCalls.slice(before).filter((c) => c.path.endsWith('accounts:sendOobCode'));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].email, account.email);
});

test('password reset: one IP stops triggering emails after 10 requests, still with the same answer', async () => {
  const from = ip();
  const accounts = Array.from({ length: 12 }, () => newAccount());
  const before = h.identityCalls.length;
  const answers = [];
  for (const a of accounts) answers.push(await post('/auth/forgot-password', { phone: a.local, apiKey: 'harness-api-key' }, { from }));
  const sent = h.identityCalls.slice(before).filter((c) => c.path.endsWith('accounts:sendOobCode'));
  assert.equal(sent.length, 10);
  for (const r of answers) assert.deepEqual(shape(r), shape(answers[0]));
});

test('the existing harness owner still signs in (regression)', async () => {
  const r = await login(USERS[OWNER_A].phone, USERS[OWNER_A].password, { from: ip() });
  assert.equal(r.status, 200, r.text);
});
