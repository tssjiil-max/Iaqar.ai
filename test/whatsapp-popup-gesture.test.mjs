import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { prepareWhatsapp, connectWhatsapp } from '../public/os/core/channels.js';
import { confirmDialog } from '../public/os/core/ui.js';
import { SIGNUP_TEXT } from '../public/os/domain/channel-link-domain.js';

const dom = new JSDOM('<body><button id="source">Link</button></body>', { url: 'https://office.test/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
const requests = [];
let onLogin;
let loginCalls = 0;
let insideClick = false;
window.IAQAR = { workerBase: 'https://worker.test' };
window.firebase = { auth: () => ({ currentUser: { getIdToken: async () => 'test-token' } }) };
window.FB = {
  init() {},
  login(callback) {
    loginCalls++;
    assert.equal(insideClick, true, 'FB.login must execute before the click handler returns');
    onLogin(callback);
  }
};
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url, options });
  if (url.includes('/meta/config?')) return Response.json({ enabled: true, appId: 'app', configId: 'config' });
  if (url.endsWith('/meta/signup/complete')) return Response.json({ connected: true });
  throw new Error('Unexpected network request');
};
function clickConfirm() {
  insideClick = true;
  try { document.querySelector('.os-dialog .primary').click(); }
  finally { insideClick = false; }
}
function finishEvent() {
  window.dispatchEvent(new window.MessageEvent('message', {
    origin: 'https://www.facebook.com',
    data: { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: 'waba', phone_number_id: 'phone' } }
  }));
}

test('prepared Meta login opens synchronously in confirmation click and completes once', async () => {
  const prepared = await prepareWhatsapp('office-a');
  assert.equal(loginCalls, 0, 'preparing must not open Meta');
  let connection;
  onLogin = callback => { finishEvent(); callback({ authResponse: { code: 'code' } }); };
  const confirmation = confirmDialog({ title: 'Link', onConfirm: () => { connection = connectWhatsapp('office-a', prepared); } });
  clickConfirm();
  assert.equal(loginCalls, 1, 'no deferred popup');
  assert.equal(await confirmation, true);
  assert.deepEqual(await connection, { connected: true });
  const complete = requests.filter(r => r.url.endsWith('/meta/signup/complete'));
  assert.equal(complete.length, 1);
  assert.equal(JSON.parse(complete[0].options.body).officeId, 'office-a');
});

test('canceling the confirmation never opens Meta or writes to the backend', async () => {
  const before = requests.length;
  let called = false;
  const confirmation = confirmDialog({ title: 'Link', onConfirm: () => { called = true; } });
  document.querySelector('.os-dialog .secondary').click();
  assert.equal(await confirmation, false);
  assert.equal(called, false);
  assert.equal(requests.length, before);
});

test('empty Meta callback reports incomplete login without claiming the window was closed', async () => {
  const prepared = await prepareWhatsapp('office-a');
  const before = requests.length;
  onLogin = callback => callback({});
  insideClick = true;
  const result = connectWhatsapp('office-a', prepared);
  insideClick = false;
  await assert.rejects(result, { message: SIGNUP_TEXT.notCompleted });
  assert.equal(requests.length, before, 'no signup persistence without authorization code');
});

test('SDK exceptions are caught and the event listener is removed', async () => {
  const prepared = await prepareWhatsapp('office-a');
  let removed = 0;
  const original = window.removeEventListener.bind(window);
  window.removeEventListener = (...args) => { if (args[0] === 'message') removed++; original(...args); };
  onLogin = () => { throw new Error('SDK failure with sensitive details'); };
  insideClick = true;
  const result = connectWhatsapp('office-a', prepared);
  insideClick = false;
  await assert.rejects(result, { message: SIGNUP_TEXT.failed });
  assert.equal(removed, 1);
  window.removeEventListener = original;
});

test('prepared login cannot be used for a different office', async () => {
  const prepared = await prepareWhatsapp('office-a');
  const before = loginCalls;
  await assert.rejects(connectWhatsapp('office-b', prepared));
  assert.equal(loginCalls, before);
});

test('confirmation callback errors clean up the dialog and reject', async () => {
  const result = confirmDialog({ title: 'Link', onConfirm: () => { throw new Error('failed'); } });
  clickConfirm();
  await assert.rejects(result, /failed/);
  assert.equal(document.querySelector('.os-dialog'), null);
});
