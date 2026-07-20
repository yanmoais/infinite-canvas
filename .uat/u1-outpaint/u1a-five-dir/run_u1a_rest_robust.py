#!/usr/bin/env python3
"""Sequential U1-A remaining dirs with robust submit + server recover."""
from __future__ import annotations
import base64, hashlib, json, time, traceback, urllib.request
from pathlib import Path
from PIL import Image
import importlib.util

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('u1a', ROOT / 'run_u1a_five_dir.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

COMFY_OUT = Path('/Users/zhenbao/ComfyUI/output/llama_bridge\\canvas')
RECEIPTS = Path('/Users/zhenbao/work/Mission_manager/logs/local-agent/generation-receipts')
LOG = ROOT / 'u1a-rest-robust.log'


def log(msg: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    with LOG.open('a', encoding='utf-8') as f:
        f.write(line + '\n')


def list_outputs():
    return sorted(COMFY_OUT.glob('illustrious-mmmix-v8-inpaint_*.png'), key=lambda p: p.stat().st_mtime)


def multipart_body(prompt, size, base_bytes, mask_bytes, base_name, mask_name, extra):
    boundary = '----CodexBoundary' + hashlib.md5(str(time.time()).encode()).hexdigest()
    parts = []

    def add(name, value, filename=None, ctype=None):
        parts.append(f'--{boundary}\r\n'.encode())
        if filename:
            parts.append(
                f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode()
            )
            parts.append(f'Content-Type: {ctype or "application/octet-stream"}\r\n\r\n'.encode())
            parts.append(value)
            parts.append(b'\r\n')
        else:
            parts.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
            parts.append(str(value).encode())
            parts.append(b'\r\n')

    for k, v in [
        ('prompt', prompt),
        ('model', m.MODEL),
        ('size', size),
        ('n', '1'),
        ('response_format', 'b64_json'),
        ('output_format', 'png'),
        ('extra', json.dumps(extra, ensure_ascii=False)),
    ]:
        add(k, v)
    add('image', base_bytes, base_name, 'image/png')
    add('mask', mask_bytes, mask_name, 'image/png')
    body = b''.join(parts) + f'--{boundary}--\r\n'.encode()
    return body, boundary


def prepare(direction):
    out = ROOT / f'u1a-{direction}'
    out.mkdir(exist_ok=True)
    src = Image.open(m.BASELINE)
    seam = m.DEFAULT_SEAM[direction]
    denoise = m.DEFAULT_DENOISE[direction]
    prompt = m.PROMPTS[direction]
    base, mask, g = m.prepare_extend(src, direction, seam)
    size = f"{g['targetWidth']}x{g['targetHeight']}"
    base_name = f"u1a-{direction}-base-{size}.png"
    mask_name = f"u1a-{direction}-mask-softseam-{seam}-{size}.png"
    base_path = out / base_name
    mask_path = out / mask_name
    base.save(base_path)
    mask.save(mask_path)
    extra = {
        'lora_keys': m.LORA_KEYS,
        'face_detailer': False,
        'denoise': denoise,
        'seam_feather': seam,
        'outpaint_direction': direction,
        'prompt_optimize': False,
        'seed': m.SEED,
    }
    req = {
        'endpoint': m.ENDPOINT,
        'model': m.MODEL,
        'size': size,
        'prompt': prompt,
        'image': base_name,
        'mask': mask_name,
        'extra': extra,
        'geometry': g,
        'case': f'U1-A-{direction}',
    }
    (out / 'request.json').write_text(json.dumps(req, ensure_ascii=False, indent=2) + '\n')
    (out / 'started-at.txt').write_text(time.strftime('%Y-%m-%dT%H:%M:%S%z') + '\n')
    return out, prompt, size, base_path, mask_path, extra, g, denoise, seam


def save_metrics(out, direction, base_path, result_path, g, denoise, seam, size, prompt_id=None, output_name=None, recovered=False, elapsed=None):
    base = Image.open(base_path).convert('RGB')
    res = Image.open(result_path).convert('RGB')
    metrics = m.metrics_for(direction, base, res, g)
    metrics.update({
        'direction': direction,
        'denoise': denoise,
        'seam': seam,
        'size': size,
        'sha256': hashlib.sha256(result_path.read_bytes()).hexdigest(),
        'sourcePromptId': prompt_id,
        'windowsOutput': output_name,
        'recoveredFromServer': recovered,
        'elapsedSec': elapsed,
    })
    (out / 'metrics.json').write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + '\n')
    return metrics


def run_direction(direction):
    out, prompt, size, base_path, mask_path, extra, g, denoise, seam = prepare(direction)
    before_outs = {p.name for p in list_outputs()}
    before_receipts = {p.name for p in RECEIPTS.glob('*.json')}
    t0 = time.time()
    body, boundary = multipart_body(
        prompt, size, base_path.read_bytes(), mask_path.read_bytes(),
        base_path.name, mask_path.name, extra,
    )
    req = urllib.request.Request(
        m.ENDPOINT,
        data=body,
        headers={'Content-Type': f'multipart/form-data; boundary={boundary}', 'Connection': 'close'},
        method='POST',
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    log(f'[{direction}] submit size={size} denoise={denoise} seam={seam}')
    client_err = None
    try:
        with opener.open(req, timeout=900) as resp:
            status = resp.status
            raw = resp.read()
        (out / 'http-status.txt').write_text(str(status) + '\n')
        (out / 'response.json').write_bytes(raw)
        data = json.loads(raw)
        receipt = data.get('execution_receipt')
        if receipt:
            (out / 'execution-receipt.json').write_text(
                json.dumps(receipt, ensure_ascii=False, indent=2) + '\n'
            )
        img_b64 = (data.get('data') or [{}])[0].get('b64_json')
        if img_b64:
            img = base64.b64decode(img_b64)
            result_path = out / f'u1a-{direction}-result.png'
            result_path.write_bytes(img)
            elapsed = round(time.time() - t0, 1)
            prompt_id = (receipt or {}).get('actual', {}).get('promptId') if receipt else None
            metrics = save_metrics(
                out, direction, base_path, result_path, g, denoise, seam, size,
                prompt_id=prompt_id, recovered=False, elapsed=elapsed,
            )
            (out / 'run.log').write_text(f'client_ok status={status} elapsed={elapsed}\n')
            log(f'[{direction}] client_ok elapsed={elapsed} metrics={json.dumps(metrics, ensure_ascii=False)}')
            return metrics
        log(f'[{direction}] no b64 image, will recover')
    except Exception as e:
        client_err = f'{type(e).__name__}: {e}'
        (out / 'run.log').write_text(f'client_error: {client_err}\n{traceback.format_exc()}\n')
        log(f'[{direction}] client_error {client_err}; recovering...')

    for i in range(90):
        new_outs = [p for p in list_outputs() if p.name not in before_outs]
        new_recs = [p for p in RECEIPTS.glob('*.json') if p.name not in before_receipts]
        if new_outs and new_recs:
            out_png = max(new_outs, key=lambda p: p.stat().st_mtime)
            rec = max(new_recs, key=lambda p: p.stat().st_mtime)
            result_path = out / f'u1a-{direction}-result.png'
            result_path.write_bytes(out_png.read_bytes())
            (out / 'execution-receipt.json').write_bytes(rec.read_bytes())
            receipt = json.loads(rec.read_text())
            prompt_id = receipt.get('actual', {}).get('promptId') or rec.stem
            elapsed = round(time.time() - t0, 1)
            metrics = save_metrics(
                out, direction, base_path, result_path, g, denoise, seam, size,
                prompt_id=prompt_id, output_name=out_png.name, recovered=True, elapsed=elapsed,
            )
            (out / 'run.log').write_text(
                f'recovered from {out_png.name} receipt={rec.name} after client_err={client_err}\n',
                encoding='utf-8',
            )
            log(f'[{direction}] recovered {out_png.name} elapsed={elapsed} metrics={json.dumps(metrics, ensure_ascii=False)}')
            return metrics
        if new_outs and i > 3:
            try:
                qraw = opener.open('http://192.168.2.157:8188/queue', timeout=8).read()
                q = json.loads(qraw)
                if not q.get('queue_running') and not q.get('queue_pending'):
                    out_png = max(new_outs, key=lambda p: p.stat().st_mtime)
                    result_path = out / f'u1a-{direction}-result.png'
                    result_path.write_bytes(out_png.read_bytes())
                    recs = sorted(RECEIPTS.glob('*.json'), key=lambda p: p.stat().st_mtime)
                    prompt_id = None
                    if recs:
                        rec = recs[-1]
                        (out / 'execution-receipt.json').write_bytes(rec.read_bytes())
                        prompt_id = rec.stem
                    elapsed = round(time.time() - t0, 1)
                    metrics = save_metrics(
                        out, direction, base_path, result_path, g, denoise, seam, size,
                        prompt_id=prompt_id, output_name=out_png.name, recovered=True, elapsed=elapsed,
                    )
                    log(f'[{direction}] recovered-out-only {out_png.name}')
                    return metrics
            except Exception:
                pass
        if i % 3 == 0:
            log(f'[{direction}] wait recover i={i} new_outs={len(new_outs)} new_recs={len(new_recs)}')
        time.sleep(5)
    log(f'[{direction}] FAILED recover timeout')
    return {'direction': direction, 'ok': False}


def main():
    if LOG.exists():
        LOG.write_text('')
    summary = {
        'stage': 'U1-A',
        'baseline': str(m.BASELINE),
        'seed': m.SEED,
        'model': m.MODEL,
        'startedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
        'cases': [],
    }
    for d in ['up', 'down']:
        p = ROOT / f'u1a-{d}' / 'metrics.json'
        if p.exists():
            summary['cases'].append(json.loads(p.read_text()))
    for d in ['left', 'right', 'outward']:
        try:
            summary['cases'].append(run_direction(d))
        except Exception as e:
            log(f'[{d}] fatal {e}')
            summary['cases'].append({'direction': d, 'ok': False, 'error': str(e)})
        (ROOT / 'u1a-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    summary['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S%z')
    (ROOT / 'u1a-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    log('ALL DONE')


if __name__ == '__main__':
    main()
