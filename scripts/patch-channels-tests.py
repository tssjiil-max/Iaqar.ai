from pathlib import Path

# Root messaging tests: inbound Telegram runtime is now implemented, while outbound remains simulated/disabled.
path = Path('test/messaging-phase7.test.mjs')
s = path.read_text()
s = s.replace('assert.equal(tg.adapterStatus, "simulated");', 'assert.equal(tg.adapterStatus, "adapter_ready");')
s = s.replace('assert.equal(tg.inboundEnabled, false);', 'assert.equal(tg.inboundEnabled, true);')
needle = 'assert.equal(tg.headerName, "X-Telegram-Bot-Api-Secret-Token");'
if 'assert.equal(tg.canonicalIntakeOnly, true);' not in s:
    if needle not in s:
        raise SystemExit('telegram fixture test anchor missing')
    s = s.replace(needle, needle + '\n  assert.equal(tg.canonicalIntakeOnly, true);', 1)
response_old = '  assert.equal(adapterBody.telegram.adapterStatus, "simulated");'
response_new = '''  assert.equal(adapterBody.telegram.adapterStatus, "adapter_ready");
  assert.equal(adapterBody.telegram.outboundAdapterStatus, "simulated");
  assert.equal(adapterBody.telegram.inboundEnabled, true);
  assert.equal(adapterBody.telegram.outboundEnabled, false);
  assert.equal(adapterBody.telegram.canonicalIntakeOnly, true);'''
if response_old in s:
    s = s.replace(response_old, response_new, 1)
path.write_text(s)

# Integration honesty: preserve the no-auto-send/no-fake-delivery contract while acknowledging inbound runtime.
path = Path('test/integration-honesty.test.mjs')
s = path.read_text()
s = s.replace(
    'test("Telegram adapter is simulated, never production-connected or auto-sending", () => {',
    'test("Telegram inbound adapter requires runtime config while outbound remains simulated and disabled", () => {'
)
s = s.replace(
    '// Directive §10 / Phase 7: Telegram may exist as adapter-ready/simulated structure only.',
    '// Phase 8: Telegram inbound is adapter-ready but requires runtime credentials; outbound remains simulated/disabled.'
)
s = s.replace(
    '  assert.ok(messaging.includes("inboundEnabled: false"));',
    '  assert.ok(messaging.includes("inboundEnabled: true"));\n  assert.ok(messaging.includes("requiresRuntimeConfiguration: true"));\n  assert.ok(messaging.includes("canonicalIntakeOnly: true"));'
)
path.write_text(s)

# Worker endpoint tests: same contract at the HTTP adapter surface.
path = Path('worker/test/worker.test.mjs')
s = path.read_text()
old = '  assert.equal(body.telegram.adapterStatus, "simulated");'
new = '''  assert.equal(body.telegram.adapterStatus, "adapter_ready");
  assert.equal(body.telegram.outboundAdapterStatus, "simulated");
  assert.equal(body.telegram.inboundEnabled, true);
  assert.equal(body.telegram.outboundEnabled, false);
  assert.equal(body.telegram.canonicalIntakeOnly, true);'''
if old in s:
    s = s.replace(old, new, 1)
path.write_text(s)
