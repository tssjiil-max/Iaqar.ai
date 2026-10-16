"""Package real captures and keep layout, functional and visual acceptance separate."""
from pathlib import Path
import base64
import datetime
import hashlib
import html
import io
import json
import subprocess
from PIL import Image

ROOT = Path('qa/structural-visual')
BASE = '8d4bc811ca22031d31c2236cfa65162609258f1a'
REVIEWS = json.loads((ROOT/'interior-visual-reviews.json').read_text())['reviews']

def reviewed(name, width):
    for review in REVIEWS:
        if (review['name'], review['width']) != (name, width):
            continue
        before = ROOT/'interior-before'/f'{name}-{width}.png'
        after = ROOT/'interior-after'/f'{name}-{width}.png'
        return (hashlib.sha256(before.read_bytes()).hexdigest() == review['beforeSha256']
                and hashlib.sha256(after.read_bytes()).hexdigest() == review['afterSha256'])
    return False

SELECTED = [('settings-profile',390),('settings-profile',1440),('settings-link',390),
 ('settings-cooperation',390),('settings-notifications',390),('settings-agent',390),
 ('settings-scout',390),('search-results',390),('search-empty',390),('market',390),
 ('market',1440),('calculator',390),('new-offer-manual',390),('new-offer-manual',1440),
 ('review',390),('session',390),('deal',390),('scout-new',390),('scout-find',390),
 ('scout-task',1440),('public-owner-manual',390),('public-request-manual',1440)]
after = json.loads((ROOT/'interior-after/results.json').read_text())
before = json.loads((ROOT/'interior-before/results.json').read_text())
native = json.loads((ROOT/'interior-after/standalone-results.json').read_text())
paired = {(r['name'],r['width']) for r in before['results']}
rows = []
for capture in after['results']:
    r = dict(capture)
    # Ephemeral fixture tokens are not useful as durable route identifiers.
    if r['name'].startswith('party-'):
        r['route'] = r['route'].split('#')[0] + '#<isolated-test-token>'
    key = (r['name'],r['width'])
    rows.append({**r, 'beforeCapture': key in paired,
        'layout': 'passed' if r['overflow'] <= 1 and r['rtl'] == 'rtl' else 'failed',
        'visualReview': 'reviewed-selected-comparison' if reviewed(*key) else 'pending-individual-review',
        'functional': 'Capture alone does not verify behavior; see named suites in checkpoint.'})
entries = subprocess.check_output(['rg','--files','public','-g','*.html'],text=True).splitlines()
covered = {'public/index.html','public/admin/index.html','public/legacy.html',
           'public/complete.html','public/scout-inbox.html','public/s.html','public/r.html'}
coverage = {'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'baseline': BASE, 'sourceCommit': subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
 'branch': 'codex/interior-composition-20261016',
 'releaseGate': 'INCOMPLETE: do not merge or deploy as full-site completion',
 'captures': rows, 'standaloneEntryCaptures': native['results'],
 'uncoveredHtmlEntries': [{'path':p,'acceptance':'not-passed','status':'not-covered-by-this-matrix'} for p in entries if p not in covered],
 'remainingDynamicCoverage': [
   'Authenticated admin console panels: entry screen only captured here.',
   'Authenticated legacy internal panels: access entry only captured here.',
   'Every modal/conditional/loading/error state at all seven widths is not exhaustively covered.',
   'Individual visual review is pending except the explicitly selected comparisons.']}
(ROOT/'interior-coverage.json').write_text(json.dumps(coverage,ensure_ascii=False,indent=2))
count = len(rows) + len(native['results'])
parts = ['''<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>مراجعة الواجهات الداخلية</title><style>body{font-family:Tahoma,sans-serif;background:#eff8fc;color:#101733;margin:0;padding:24px}main{max-width:1400px;margin:auto}article{background:white;padding:18px;border:1px solid #d6e7ee;border-radius:16px;margin:20px 0}.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}figure{margin:0;min-width:0}img{display:block;width:100%;height:auto;border:1px solid #d6e7ee}figcaption{padding:10px;color:#03677a}summary{cursor:pointer;font-weight:bold;padding:10px}.notice{padding:20px;background:#fff1db;line-height:1.9}@media(max-width:700px){.pair{grid-template-columns:1fr}body{padding:12px}}</style><main><h1>مراجعة بنية الواجهات الداخلية</h1>''',
 f'<p class="notice">صور فعلية من المتصفح قبل التعديل وبعده ببيانات اختبار معزولة. فحص التخطيط يشمل {count} حالة. لا يعني ذلك اكتمال المطابقة البصرية: المراجعة الفردية وبقية الحالات المشروطة لم تكتمل. المصدر الأساسي: 8d4bc81. صور العرض مشتقة من PNG مع الاحتفاظ بأبعادها.</p>']
for name,width in SELECTED:
    label = f'{name} — {width}px'
    status = 'تمت مراجعة هذه المقارنة' if reviewed(name,width) else 'صور للمراجعة — لا تُحتسب قبولًا بصريًا'
    parts.append(f'<article><details><summary>{html.escape(label)} · {status}</summary><div class="pair">')
    for variant,caption in [('interior-before','قبل'),('interior-after','بعد')]:
        p = ROOT/variant/f'{name}-{width}.png'
        buf = io.BytesIO()
        Image.open(p).convert('RGB').save(buf,'WEBP',quality=85,method=6)
        data = base64.b64encode(buf.getvalue()).decode()
        digest = hashlib.sha256(p.read_bytes()).hexdigest()
        parts.append(f'<figure><figcaption>{caption}</figcaption><img loading="lazy" alt="{html.escape(label)} {caption}" src="data:image/webp;base64,{data}" data-source-png-sha256="{digest}"></figure>')
    parts.append('</div></details></article>')
parts.append('</main></html>')
(ROOT/'interior-review.html').write_text(''.join(parts))
print(f'{len(rows)} application captures, {len(native["results"])} entry captures, {len(SELECTED)} comparison pairs. Visual gate remains incomplete.')
