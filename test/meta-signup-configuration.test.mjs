import test from 'node:test';
import assert from 'node:assert/strict';
import { whatsappConfig } from '../worker/src/office-os/channels-service.js';
import { whatsappLinkView } from '../public/os/domain/channel-link-domain.js';
test('channel actions remain disabled for malformed Meta identifiers', () => {
  const config = whatsappConfig({ META_APP_ID:'wrong', META_CONFIG_ID:'456', META_APP_SECRET:'secret' });
  assert.deepEqual(whatsappLinkView({}, config).actions, []);
});
