import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("WhatsApp non-text media is retained for review instead of false processing", async () => {
  const source = await readFile(new URL("../worker/src/index.js", import.meta.url), "utf8");
  const start = source.indexOf("async function saveInboundMessage({");
  const end = source.indexOf("\n\nasync function processInboundMessage({", start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.match(block, /env = null/);
  assert.match(block, /if \(!messageText\)/);
  // D-022: media → needs_media_adapter; other text-less messages → pending_review (runtime-tested in
  // test/whatsapp-legacy-intake-journey.test.mjs).
  assert.match(block, /processingState: firestoreString\(media \? "needs_media_adapter" : "pending_review"\)/);
  assert.match(block, /status: firestoreString\("pending_review"\)/);
  assert.match(block, /isProcessed: firestoreBoolean\(false\)/);
  assert.match(block, /const reason = media \? "channel_media_requires_adapter" : "channel_non_text_message"/);
  assert.match(block, /receivedAt, accessToken, env/);
});

test("Meta webhook passes runtime environment to the inbound channel adapter", async () => {
  const source = await readFile(new URL("../worker/src/index.js", import.meta.url), "utf8");
  const start = source.indexOf("async function receiveMetaWebhook(");
  const end = source.indexOf("\nasync function completeEmbeddedSignup(", start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.match(block, /saveInboundMessage\(\{/);
  assert.match(block, /accessToken,\s*env\s*\}\);/s);
});
