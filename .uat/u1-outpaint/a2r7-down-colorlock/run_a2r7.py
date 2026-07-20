import json, base64, hashlib, time, urllib.request, io
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

out = Path(__file__).resolve().parent
base_path = out / 'a2r7-down-base-1024x1664.png'
mask_path = out / 'a2r7-down-mask-softseam-96-1024x1664.png'
prompt = (
    "same close-up portrait continuation, preserve the white sleeveless top, "
    "continue only the visible upper torso and warm blurred background below the source image, "
    "same fabric and color, arms outside the frame, no hands visible, no outfit change, no corset, no lacing"
)
extra = {
    "lora_keys": [
        "illustrious-masterpiece-v3",
        "bss-detail-enhancer-v3",
        "bss-visual-enhancer-v3",
        "bss-skin-texture-v2",
        "eyes-for-illustrious",
        "dramatic-lighting-slider",
    ],
    "face_detailer": False,
    "denoise": 0.68,
    "seam_feather": 96,
    "outpaint_direction": "down",
    "prompt_optimize": False,
    "seed": 424242,
}
(out / 'request.json').write_text(json.dumps({
    "endpoint": "http://127.0.0.1:8080/v1/images/edits",
    "model": "comfy/illustrious-mmmix-v8",
    "size": "1024x1664",
    "prompt": prompt,
    "image": base_path.name,
    "mask": mask_path.name,
    "extra": extra,
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(out / 'started-at.txt').write_text(time.strftime('%Y-%m-%dT%H:%M:%S%z') + '\n')

boundary = '----CodexBoundary' + hashlib.md5(str(time.time()).encode()).hexdigest()
parts = []

def add(name, value, filename=None, ctype=None):
    parts.append(f'--{boundary}\r\n'.encode())
    if filename:
        parts.append(f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode())
        parts.append(f'Content-Type: {ctype or "application/octet-stream"}\r\n\r\n'.encode())
        parts.append(value)
        parts.append(b'\r\n')
    else:
        parts.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        parts.append(str(value).encode())
        parts.append(b'\r\n')

for k, v in [
    ('prompt', prompt),
    ('model', 'comfy/illustrious-mmmix-v8'),
    ('size', '1024x1664'),
    ('n', '1'),
    ('response_format', 'b64_json'),
    ('output_format', 'png'),
    ('extra', json.dumps(extra, ensure_ascii=False)),
]:
    add(k, v)
add('image', base_path.read_bytes(), base_path.name, 'image/png')
add('mask', mask_path.read_bytes(), mask_path.name, 'image/png')
body = b''.join(parts) + f'--{boundary}--\r\n'.encode()
req = urllib.request.Request(
    'http://127.0.0.1:8080/v1/images/edits',
    data=body,
    headers={'Content-Type': f'multipart/form-data; boundary={boundary}'},
    method='POST',
)
print('submitting A2R7...', flush=True)
t0 = time.time()
with urllib.request.urlopen(req, timeout=360) as resp:
    status = resp.status
    raw = resp.read()
print('http', status, 'bytes', len(raw), 'elapsed', round(time.time() - t0, 1), flush=True)
(out / 'http-status.txt').write_text(str(status) + '\n')
(out / 'response.json').write_bytes(raw)
data = json.loads(raw)
receipt = data.get('execution_receipt')
if receipt:
    (out / 'execution-receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
img_b64 = (data.get('data') or [{}])[0].get('b64_json')
if not img_b64:
    print('no image', list(data)[:30], flush=True)
    raise SystemExit(2)
img = base64.b64decode(img_b64)
(out / 'a2r7-down-result.png').write_bytes(img)
base = Image.open(base_path).convert('RGB')
result = Image.open(io.BytesIO(img)).convert('RGB')
diff = ImageChops.difference(base.crop((0, 0, 1024, 1024)), result.crop((0, 0, 1024, 1024)))
bbox = diff.getbbox()
different = sum(1 for px in diff.getdata() if px != (0, 0, 0))
gen = result.crop((0, 1024, 1024, 1664))
mean = ImageStat.Stat(gen).mean
metrics = {
    'protectedRegionDiff': {
        'differentPixels': different,
        'totalPixels': 1048576,
        'ratio': round(different / 1048576, 6),
        'changedYRange': [bbox[1], bbox[3] - 1] if bbox else None,
        'changedRows': (bbox[3] - bbox[1]) if bbox else 0,
    },
    'generatedRegionMeanRgb': [round(v, 2) for v in mean],
    'generatedRegionGreenDominance': round(mean[1] - (mean[0] + mean[2]) / 2, 2),
}
(out / 'metrics.json').write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(metrics, ensure_ascii=False, indent=2), flush=True)
px = list(gen.getdata())
g = sum(1 for p in px if p[1] - (p[0] + p[2]) / 2 > 30)
w = sum(1 for p in px if min(p) > 160 and max(p) - min(p) < 40)
print('greenish%', round(100 * g / len(px), 1), 'whiteish%', round(100 * w / len(px), 1), flush=True)
print('sha256', hashlib.sha256(img).hexdigest(), flush=True)
if receipt:
    print('promptId', receipt.get('actual', {}).get('promptId'), flush=True)
    print('mutators', receipt.get('actual', {}).get('mutators'), flush=True)
