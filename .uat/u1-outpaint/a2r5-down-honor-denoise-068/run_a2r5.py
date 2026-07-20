import json, base64, hashlib, time, urllib.request, io
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

out = Path(__file__).resolve().parent
base_path = out / 'a2r5-down-base-1024x1664.png'
mask_path = out / 'a2r5-down-mask-softseam-96-1024x1664.png'
if not base_path.exists():
    src = out.parent / 'a2r3-down-nearseam-96'
    base_path.write_bytes((src / 'a2r3-down-base-1024x1664.png').read_bytes())
    mask_path.write_bytes((src / 'a2r3-down-mask-softseam-96-1024x1664.png').read_bytes())

prompt = (
    "same close-up portrait continuation, preserve the white sleeveless top, "
    "continue only the visible upper torso and warm blurred background below the source image, "
    "same fabric and color, arms outside the frame, no hands visible, no outfit change, no corset, no green clothing, no lacing"
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
req_meta = {
    "endpoint": "http://127.0.0.1:8080/v1/images/edits",
    "model": "comfy/illustrious-mmmix-v8",
    "size": "1024x1664",
    "n": 1,
    "response_format": "b64_json",
    "output_format": "png",
    "prompt": prompt,
    "image": base_path.name,
    "mask": mask_path.name,
    "extra": extra,
}
(out / 'request.json').write_text(json.dumps(req_meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(out / 'started-at.txt').write_text(time.strftime('%Y-%m-%dT%H:%M:%S%z') + '\n')

boundary = '----CodexBoundary' + hashlib.md5(str(time.time()).encode()).hexdigest()
parts = []

def add_field(name, value, filename=None, content_type=None):
    chunk = [f'--{boundary}\r\n'.encode()]
    if filename:
        chunk.append(f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode())
        chunk.append(f'Content-Type: {content_type or "application/octet-stream"}\r\n\r\n'.encode())
        chunk.append(value if isinstance(value, (bytes, bytearray)) else str(value).encode())
        chunk.append(b'\r\n')
    else:
        chunk.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        chunk.append(str(value).encode())
        chunk.append(b'\r\n')
    parts.extend(chunk)

add_field('prompt', prompt)
add_field('model', 'comfy/illustrious-mmmix-v8')
add_field('size', '1024x1664')
add_field('n', '1')
add_field('response_format', 'b64_json')
add_field('output_format', 'png')
add_field('extra', json.dumps(extra, ensure_ascii=False))
add_field('image', base_path.read_bytes(), filename=base_path.name, content_type='image/png')
add_field('mask', mask_path.read_bytes(), filename=mask_path.name, content_type='image/png')
body = b''.join(parts) + f'--{boundary}--\r\n'.encode()

req = urllib.request.Request(
    'http://127.0.0.1:8080/v1/images/edits',
    data=body,
    headers={'Content-Type': f'multipart/form-data; boundary={boundary}'},
    method='POST',
)
print('submitting A2R5...', flush=True)
t0 = time.time()
with urllib.request.urlopen(req, timeout=360) as resp:
    status = resp.status
    raw = resp.read()
(out / 'http-status.txt').write_text(str(status) + '\n')
(out / 'response.json').write_bytes(raw)
print('http', status, 'bytes', len(raw), 'elapsed', round(time.time()-t0,1), flush=True)
data = json.loads(raw)
receipt = data.get('execution_receipt')
if receipt:
    (out / 'execution-receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
img_b64 = (data.get('data') or [{}])[0].get('b64_json')
if not img_b64:
    print('no image keys', list(data)[:30], flush=True)
    raise SystemExit(2)
img_bytes = base64.b64decode(img_b64)
(out / 'a2r5-down-result.png').write_bytes(img_bytes)

base = Image.open(base_path).convert('RGB')
result = Image.open(io.BytesIO(img_bytes)).convert('RGB')
source_h = 1024
base_protected = base.crop((0, 0, base.width, source_h))
result_protected = result.crop((0, 0, result.width, source_h))
diff = ImageChops.difference(base_protected, result_protected)
bbox = diff.getbbox()
different = sum(1 for px in diff.getdata() if px != (0, 0, 0))
generated = result.crop((0, source_h, result.width, result.height))
mean = ImageStat.Stat(generated).mean
metrics = {
    'protectedRegionDiff': {
        'differentPixels': different,
        'totalPixels': base.width * source_h,
        'ratio': round(different / (base.width * source_h), 6),
        'changedYRange': [bbox[1], bbox[3]-1] if bbox else None,
        'changedRows': (bbox[3]-bbox[1]) if bbox else 0,
    },
    'generatedRegionMeanRgb': [round(v, 2) for v in mean],
    'generatedRegionGreenDominance': round(mean[1] - (mean[0]+mean[2])/2, 2),
}
(out / 'metrics.json').write_text(json.dumps(metrics, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps(metrics, ensure_ascii=False, indent=2), flush=True)
print('sha256', hashlib.sha256(img_bytes).hexdigest(), flush=True)
if receipt:
    print('receipt mutators', receipt.get('actual',{}).get('mutators'), flush=True)
    print('promptId', receipt.get('actual',{}).get('promptId'), flush=True)
