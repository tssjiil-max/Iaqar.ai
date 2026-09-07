from pathlib import Path

path = Path('test/messaging-phase7.test.mjs')
s = path.read_text()
s = s.replace('assert.equal(tg.adapterStatus, "simulated");', 'assert.equal(tg.adapterStatus, "adapter_ready");')
s = s.replace('assert.equal(tg.inboundEnabled, false);', 'assert.equal(tg.inboundEnabled, true);')
needle = 'assert.equal(tg.headerName, "X-Telegram-Bot-Api-Secret-Token");'
if 'assert.equal(tg.canonicalIntakeOnly, true);' not in s:
    if needle not in s:
        raise SystemExit('telegram fixture test anchor missing')
    s = s.replace(needle, needle + '\n  assert.equal(tg.canonicalIntakeOnly, true);', 1)
path.write_text(s)
