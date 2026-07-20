#!/usr/bin/env python3
import json, hashlib, time, shutil
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent
COMFY = Path('/Users/zhenbao/ComfyUI/output/llama_bridge\\canvas')

# recopy outward result
out = ROOT / 'u1a-outward'
src = COMFY / 'illustrious-mmmix-v8-inpaint_00066_.png'
dst = out / 'u1a-outward-result.png'
shutil.copyfile(src, dst)
im = Image.open(dst)
im.load()
clean = out / 'u1a-outward-result.png'
im.convert('RGB').save(clean)
print('outward result ok', clean.stat().st_size, im.size)

req = json.loads((out / 'request.json').read_text())
g = req['geometry']
res = Image.open(clean).convert('RGB')
base = Image.open(out / req['image']).convert('RGB')
sx, sy, sw, sh = g['sourceOffsetX'], g['sourceOffsetY'], g['sourceDrawWidth'], g['sourceDrawHeight']
px = res.load()
samples = []
for y in range(0, res.size[1], 2):
    for x in range(0, res.size[0], 2):
        if sx <= x < sx + sw and sy <= y < sy + sh:
            continue
        samples.append(px[x, y])
mean = [sum(p[i] for p in samples) / max(1, len(samples)) for i in range(3)]
gdom = mean[1] - (mean[0] + mean[2]) / 2
greenish = sum(1 for p in samples if p[1] - (p[0] + p[2]) / 2 > 30) / max(1, len(samples)) * 100
whiteish = sum(1 for p in samples if min(p) > 160 and max(p) - min(p) < 40) / max(1, len(samples)) * 100
dark = sum(1 for p in samples if (p[0] + p[1] + p[2]) / 3 < 50) / max(1, len(samples)) * 100
seam = g['seamOverlapPixels']
core = (sx + seam, sy + seam, sx + sw - seam, sy + sh - seam)
diff = ImageChops.difference(base.crop(core), res.crop(core))
different = sum(1 for p in diff.getdata() if p != (0, 0, 0))
total = (core[2] - core[0]) * (core[3] - core[1])
receipt = {}
rp = out / 'execution-receipt.json'
if rp.exists():
    receipt = json.loads(rp.read_text())
m = {
    'direction': 'outward',
    'denoise': 0.78,
    'seam': 104,
    'size': '1664x1664',
    'protectedRegionDiff': {
        'differentPixels': different,
        'totalPixels': total,
        'ratio': round(different / max(1, total), 6),
    },
    'generatedRegionMeanRgb': [round(v, 2) for v in mean],
    'generatedRegionGreenDominance': round(gdom, 2),
    'generatedRegionGreenishPct': round(greenish, 1),
    'generatedRegionWhiteishPct': round(whiteish, 1),
    'generatedRegionDarkPct': round(dark, 1),
    'sha256': hashlib.sha256(clean.read_bytes()).hexdigest(),
    'sourcePromptId': receipt.get('actual', {}).get('promptId') or '0c39f360-420a-4144-91b4-2f19cc0b7aad',
    'windowsOutput': 'illustrious-mmmix-v8-inpaint_00066_.png',
    'sampledExtensionPixels': len(samples),
    'recoveredFromServer': True,
}
(out / 'metrics.json').write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n')
print('outward metrics', m)

for d, outname in [
    ('left', 'illustrious-mmmix-v8-inpaint_00063_.png'),
    ('right', 'illustrious-mmmix-v8-inpaint_00065_.png'),
]:
    p = ROOT / f'u1a-{d}' / 'metrics.json'
    mm = json.loads(p.read_text())
    if not mm.get('windowsOutput'):
        mm['windowsOutput'] = outname
        p.write_text(json.dumps(mm, ensure_ascii=False, indent=2) + '\n')

for d in ['up', 'down', 'left', 'right']:
    resi = Image.open(ROOT / f'u1a-{d}' / f'u1a-{d}-result.png').convert('RGB')
    w, h = resi.size
    if d == 'up':
        resi.crop((0, 560, w, 760)).save(ROOT / f'u1a-{d}' / 'seam-focus.jpg', 'JPEG', quality=90)
        resi.crop((0, 0, w, 640)).save(ROOT / f'u1a-{d}' / 'extension-focus.jpg', 'JPEG', quality=90)
    elif d == 'down':
        resi.crop((0, 900, w, 1140)).save(ROOT / f'u1a-{d}' / 'seam-focus.jpg', 'JPEG', quality=90)
        resi.crop((0, 1024, w, h)).save(ROOT / f'u1a-{d}' / 'extension-focus.jpg', 'JPEG', quality=90)
    elif d == 'left':
        resi.crop((540, 0, 760, h)).save(ROOT / f'u1a-{d}' / 'seam-focus.jpg', 'JPEG', quality=90)
        resi.crop((0, 0, 640, h)).save(ROOT / f'u1a-{d}' / 'extension-focus.jpg', 'JPEG', quality=90)
    else:
        resi.crop((w - 760, 0, w - 540, h)).save(ROOT / f'u1a-{d}' / 'seam-focus.jpg', 'JPEG', quality=90)
        resi.crop((w - 640, 0, w, h)).save(ROOT / f'u1a-{d}' / 'extension-focus.jpg', 'JPEG', quality=90)
res.resize((832, 832)).save(out / 'overview.jpg', 'JPEG', quality=90)

cases = [json.loads((ROOT / f'u1a-{d}' / 'metrics.json').read_text()) for d in ['up', 'down', 'left', 'right', 'outward']]

def provisional(c):
    dark = c.get('generatedRegionDarkPct')
    gdom = c.get('generatedRegionGreenDominance')
    protect = (c.get('protectedRegionDiff') or {}).get('ratio') or 0
    if dark is not None and dark >= 70:
        return 'METRIC_FAIL'
    if (dark is not None and dark >= 40) or (gdom is not None and abs(gdom) >= 15):
        return 'METRIC_WARN_PENDING_VISUAL'
    if protect > 0.02:
        return 'METRIC_WARN_PENDING_VISUAL'
    return 'METRIC_PASS_PENDING_VISUAL'

matrix = []
for c in cases:
    row = {
        'direction': c.get('direction'),
        'denoise': c.get('denoise'),
        'seam': c.get('seam'),
        'size': c.get('size'),
        'darkPct': c.get('generatedRegionDarkPct'),
        'gdom': c.get('generatedRegionGreenDominance'),
        'whitePct': c.get('generatedRegionWhiteishPct'),
        'protectRatio': (c.get('protectedRegionDiff') or {}).get('ratio'),
        'promptId': c.get('sourcePromptId'),
        'output': c.get('windowsOutput'),
        'provisional': provisional(c),
    }
    matrix.append(row)
    print(row)

summary = {
    'stage': 'U1-A',
    'baseline': str(ROOT.parent / 'baseline' / 'u1-character-baseline.png'),
    'seed': 424242,
    'model': 'comfy/illustrious-mmmix-v8',
    'loras': [
        'illustrious-masterpiece-v3', 'bss-detail-enhancer-v3', 'bss-visual-enhancer-v3',
        'bss-skin-texture-v2', 'eyes-for-illustrious', 'dramatic-lighting-slider',
    ],
    'extensionRatio': 0.625,
    'finishedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
    'matrix': matrix,
    'cases': cases,
    'note': 'Metrics-only provisional. BOSS visual acceptance still required for U1 close.',
}
(ROOT / 'u1a-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
print('summary written')
