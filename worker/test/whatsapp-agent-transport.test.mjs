import test from 'node:test';
import assert from 'node:assert/strict';
import { sendWhatsAppMessage } from '../src/office-os/whatsapp-agent-transport.js';

test('Meta transport accepts the Cloudflare META_ACCESS_TOKEN binding without a real request', async () => {
  let authorization = '';
  const result = await sendWhatsAppMessage({
    env: { ECONOMIC_TEST_MODE: 'disabled', META_ACCESS_TOKEN: 'local-test-token' },
    fetchImpl: async (_url, init) => {
      authorization = init.headers.Authorization;
      return Response.json({ messages: [{ id: 'wamid.local-test' }] });
    }
  }, {
    phoneNumberId: 'phone-test', to: '966500000001',
    message: { type: 'text', text: { body: 'local test only' } }
  });

  assert.equal(authorization, 'Bearer local-test-token');
  assert.deepEqual(result, { ok: true, messageId: 'wamid.local-test' });
});
