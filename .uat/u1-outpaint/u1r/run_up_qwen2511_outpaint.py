#!/usr/bin/env python3
"""U1-R-up Phase A1: Qwen-Image-Edit-2511 outpaint shell.

Qwen 2511 is whole-image instruction edit (NOT mask-native). Pipeline:
  1) Small-step upward pad with soft edge fill
  2) Call gateway /nannan/edit-image-local (fidelity preset)
  3) Force-stitch original source pixels back (protect lock)
  4) Soft-blend only a hairline band
  5) Multi-seed gate (≥4 seeds)

Usage:
  python3 run_up_qwen2511_outpaint.py --seeds 424242,424243,777001,888002 --tag q1
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import math
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

HERE = Path(__file__).resolve().parent
UAT = HERE.parent
BASELINE = UAT / "baseline" / "u1-character-baseline.png"
QA_SCRIPT = UAT / "u1_qa" / "u1_qa.py"
GATEWAY = "http://127.0.0.1:8080"
EDIT_PATH = "/nannan/edit-image-local"
PRESET = "the-witness-qwen-edit2511-fidelity"

DEFAULT_SEEDS = (424242, 424243, 777001, 888002)

EDIT_PROMPT = (
    "Expand the camera framing upward only. "
    "Continue the same single portrait subject and the same warm indoor room. "
    "Keep the original face, hair color, hairstyle, clothing and identity completely unchanged. "
    "Above the head, only continue the existing soft out-of-focus wall/ceiling background and ambient light. "
    "Do not add another person, second face, hand, arm, fingers, object on head, device, helmet, "
    "hair dryer, camera, reflection or duplicate limb. "
    "No hard horizontal seam. Match source color temperature and lighting direction."
)

EDIT_NEGATIVE = (
    "second person, second face, extra head, hand on head, hands, arms above head, "
    "object on head, device on head, helmet, hair dryer, white box, gadget, "
    "hard seam, color banding, green cast, black void, blurry face, identity change, "
    "different hairstyle, extra hair mass, topknot, low quality"
)


def round64(n: int) -> int:
    return max(64, int(math.ceil(n / 64.0) * 64))


def sample_edge_mean(src: Image.Image) -> Tuple[int, int, int]:
    w, h = src.size
    samples: List[Tuple[int, int, int]] = []
    for box in [
        (0, 0, max(8, w // 5), max(8, h // 3)),
        (w - max(8, w // 5), 0, w, max(8, h // 3)),
        (0, max(8, h // 6), max(8, w // 6), max(8, h // 2)),
        (w - max(8, w // 6), max(8, h // 6), w, max(8, h // 2)),
    ]:
        samples.extend(list(src.crop(box).resize((32, 32)).getdata()))
    filt = [p for p in samples if (p[0] + p[1] + p[2]) / 3 > 90 and p[1] - (p[0] + p[2]) / 2 < 16]
    use = filt if len(filt) > 12 else samples
    n = max(1, len(use))
    return tuple(int(round(sum(p[i] for p in use) / n)) for i in range(3))  # type: ignore[return-value]


def pad_up(src: Image.Image, ext_px: int) -> Tuple[Image.Image, int]:
    """Return padded canvas and source offset Y."""
    w, h = src.size
    ext = max(64, int(ext_px))
    th = h + ext
    mean = sample_edge_mean(src)
    canvas = Image.new("RGB", (w, th), mean)
    # soft plate from side strips
    left = src.crop((0, 0, max(8, w // 4), h)).resize((max(8, w // 3), ext)).filter(ImageFilter.GaussianBlur(18))
    right = src.crop((w - max(8, w // 4), 0, w, h)).resize((max(8, w // 3), ext)).filter(ImageFilter.GaussianBlur(18))
    plate = Image.new("RGB", (w, ext), mean)
    plate.paste(left, (0, 0))
    plate.paste(right, (w - max(8, w // 3), 0))
    plate = plate.filter(ImageFilter.GaussianBlur(22))
    plate = ImageEnhance.Color(plate).enhance(0.85)
    canvas.paste(plate, (0, 0))
    canvas.paste(src, (0, ext))
    return canvas, ext


def force_stitch(edited: Image.Image, src: Image.Image, sy: int, blend: int = 64) -> Image.Image:
    """Force original source pixels below hairline; soft blend near boundary only."""
    w, h = edited.size
    sw, sh = src.size
    # resize edited to expected padded size if model returned different aspect
    target_h = sy + sh
    target_w = sw
    if edited.size != (target_w, target_h):
        edited = edited.resize((target_w, target_h), Image.Resampling.LANCZOS)
    out = edited.copy()
    # hard lock deep source
    soft = max(24, min(blend, 96))
    if soft < sh:
        out.paste(src.crop((0, soft, sw, sh)), (0, sy + soft))
    # soft blend in [sy, sy+soft)
    for i in range(soft):
        y = sy + i
        t = i / max(1, soft - 1)
        t = t * t * (3 - 2 * t)
        src_row = src.crop((0, i, sw, i + 1))
        gen_row = out.crop((0, y, target_w, y + 1))
        out.paste(Image.blend(gen_row, src_row, t), (0, y))
    # above sy: keep edited (extension), but dampen extreme differences near boundary
    for i in range(min(soft, sy)):
        y = sy - 1 - i
        t = 1.0 - (i / max(1, soft - 1)) * 0.35  # near hairline slight pull to source top color
        src_top = src.crop((0, 0, sw, 1))
        gen_row = out.crop((0, y, target_w, y + 1))
        # only slight color anchor, not structure
        out.paste(Image.blend(gen_row, src_top.resize((target_w, 1)), 0.12 * (1 - i / max(1, soft - 1))), (0, y))
    return out


def image_to_data_url(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def call_qwen_edit(
    img: Image.Image,
    *,
    seed: int,
    width: int,
    height: int,
    steps: int,
    prompt: str,
    negative: str,
    preset: str,
    model_lora: str | None = None,
    model_lora_strength: float = 1.0,
) -> Tuple[Image.Image, Dict[str, Any]]:
    payload = {
        "prompt": prompt,
        "negative": negative,
        "preset": preset,
        "seed": seed,
        "width": width,
        "height": height,
        "steps": steps,
        "image_url": image_to_data_url(img),
    }
    if model_lora:
        payload["model_lora"] = model_lora
        payload["model_lora_strength"] = model_lora_strength
    req = urllib.request.Request(
        GATEWAY + EDIT_PATH,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=900) as resp:
        raw = resp.read()
    data = json.loads(raw.decode("utf-8"))
    if not data.get("ok"):
        raise RuntimeError(data.get("error") or str(data)[:400])
    media = data.get("media") or []
    if not media:
        raise RuntimeError("edit returned no media")
    # media entries may be URL strings
    url = media[0] if isinstance(media[0], str) else (media[0].get("url") or media[0].get("filename"))
    if not url:
        raise RuntimeError(f"bad media entry: {media[0]!r}")
    if url.startswith("/"):
        url = GATEWAY + url
    # download
    with urllib.request.urlopen(url, timeout=180) as r:
        content = r.read()
    out = Image.open(io.BytesIO(content)).convert("RGB")
    return out, data


def run_one(
    *,
    seed: int,
    ext_px: int,
    steps: int,
    blend: int,
    out_root: Path,
    tag: str,
    model_lora: str | None = None,
    model_lora_strength: float = 1.0,
) -> Dict[str, Any]:
    case = out_root / f"up-qwen2511-s{seed}-{tag}"
    case.mkdir(parents=True, exist_ok=True)
    src = Image.open(BASELINE).convert("RGB")
    padded, sy = pad_up(src, ext_px)
    # Qwen latent size: keep near aspect of padded image, multiple of 64, cap short side ~1024
    tw, th = padded.size
    # fidelity preset used 768x1024; for square-ish pad use proportional
    target_h = min(1280, round64(th if th <= 1280 else int(1024 * th / tw)))
    target_w = min(1280, round64(int(tw * target_h / th)))
    # ensure at least 768 on short side-ish
    if min(target_w, target_h) < 704:
        scale = 768 / min(target_w, target_h)
        target_w = round64(int(target_w * scale))
        target_h = round64(int(target_h * scale))

    send_img = padded.resize((target_w, target_h), Image.Resampling.LANCZOS)
    padded.save(case / "padded.png")
    send_img.save(case / "send-to-qwen.png")
    src.save(case / "source.png")

    # geometry for QA (fake request.json)
    g = {
        "mode": "extend",
        "direction": "up",
        "sourceWidth": src.size[0],
        "sourceHeight": src.size[1],
        "targetWidth": tw,
        "targetHeight": th,
        "extensionPixels": sy,
        "seamOverlapPixels": blend,
        "sourceScale": 1,
        "sourceOffsetX": 0,
        "sourceOffsetY": sy,
        "sourceDrawWidth": src.size[0],
        "sourceDrawHeight": src.size[1],
    }
    req = {
        "endpoint": GATEWAY + EDIT_PATH,
        "model": PRESET,
        "size": f"{tw}x{th}",
        "prompt": EDIT_PROMPT,
        "image": "padded.png",
        "extra": {"seed": seed, "steps": steps, "engine": "qwen-edit-2511"},
        "geometry": g,
        "case": f"U1-R-up-qwen2511-s{seed}",
        "hypothesis": "Qwen-2511 instruction expand + force stitch protect; small-step up",
    }
    (case / "request.json").write_text(json.dumps(req, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (case / "started-at.txt").write_text(time.strftime("%Y-%m-%dT%H:%M:%S%z") + "\n", encoding="utf-8")

    print(
        f"[up-qwen] seed={seed} pad={tw}x{th} send={target_w}x{target_h} ext={sy} steps={steps} "
        f"lora={model_lora or '-'}",
        flush=True,
    )
    t0 = time.time()
    try:
        edited, meta = call_qwen_edit(
            send_img,
            seed=seed,
            width=target_w,
            height=target_h,
            steps=steps,
            prompt=EDIT_PROMPT,
            negative=EDIT_NEGATIVE,
            preset=PRESET,
            model_lora=model_lora,
            model_lora_strength=model_lora_strength,
        )
    except Exception as e:
        (case / "run.log").write_text(f"error: {e}\n", encoding="utf-8")
        print(f"[up-qwen] seed={seed} ERROR {e}", flush=True)
        raise
    elapsed = round(time.time() - t0, 1)
    edited.save(case / "qwen-raw.png")
    (case / "edit-meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2)[:4000] + "\n", encoding="utf-8")
    print(f"[up-qwen] seed={seed} ok elapsed={elapsed}s raw={edited.size}", flush=True)

    stitched = force_stitch(edited, src, sy, blend=blend)
    result_path = case / f"u1r-up-qwen2511-s{seed}-result.png"
    stitched.save(result_path)
    stitched.save(case / "up-qwen2511-result.png")
    # base for QA protect = padded (source locked region)
    padded.save(case / "u1a-up-base-pad.png")
    # update request image field for metrics base
    req["image"] = "padded.png"
    (case / "request.json").write_text(json.dumps(req, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    qa = subprocess.run(
        [sys.executable, str(QA_SCRIPT), "--case-dir", str(case), "--round", "0"],
        capture_output=True,
        text=True,
    )
    (case / "qa-run.log").write_text(qa.stdout + "\n" + qa.stderr, encoding="utf-8")
    report = {}
    if (case / "qa-report.json").exists():
        report = json.loads((case / "qa-report.json").read_text(encoding="utf-8"))
    metrics = report.get("metrics") or {}
    summary = {
        "seed": seed,
        "caseDir": str(case),
        "resultPath": str(result_path),
        "elapsedSec": elapsed,
        "promptId": meta.get("prompt_id"),
        "executionSeconds": meta.get("execution_seconds"),
        "provisional": metrics.get("provisional"),
        "darkPct": metrics.get("darkPct"),
        "farDarkPct": metrics.get("farDarkPct"),
        "gdom": metrics.get("gdom"),
        "protectedCoreDiffRatio": metrics.get("protectedCoreDiffRatio"),
        "seamWorst": metrics.get("seamWorst"),
        "autoFindings": [
            (f.get("label"), f.get("severity"))
            for f in report.get("findings") or []
            if f.get("severity") in ("FAIL", "WARN")
        ],
    }
    (case / "run-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"[up-qwen] seed={seed} provisional={summary.get('provisional')} "
        f"dark={summary.get('darkPct')} protect={summary.get('protectedCoreDiffRatio')} "
        f"seam={summary.get('seamWorst')}",
        flush=True,
    )
    return summary


def main(argv: Sequence[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--seeds", default=",".join(str(s) for s in DEFAULT_SEEDS))
    p.add_argument("--ext", type=int, default=320, help="upward pad pixels (small step)")
    p.add_argument("--steps", type=int, default=28)
    p.add_argument("--blend", type=int, default=72)
    p.add_argument(
        "--lightning",
        action="store_true",
        help="Use Qwen Edit 2511 Lightning 4-step LoRA and default steps=4",
    )
    p.add_argument("--lora", default="", help="Optional model-only LoRA filename")
    p.add_argument("--lora-strength", type=float, default=1.0)
    p.add_argument("--tag", default=time.strftime("%Y%m%d-%H%M%S"))
    p.add_argument("--out-root", type=Path, default=HERE / "up-qwen2511")
    args = p.parse_args(argv)

    seeds = [int(x.strip()) for x in args.seeds.split(",") if x.strip()]
    out_root = args.out_root
    out_root.mkdir(parents=True, exist_ok=True)
    model_lora = args.lora.strip() or None
    steps = args.steps
    if args.lightning:
        model_lora = model_lora or "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"
        if args.steps == 28:
            steps = 4
    matrix = []
    for seed in seeds:
        try:
            matrix.append(
                run_one(
                    seed=seed,
                    ext_px=args.ext,
                    steps=steps,
                    blend=args.blend,
                    out_root=out_root,
                    tag=args.tag,
                    model_lora=model_lora,
                    model_lora_strength=args.lora_strength,
                )
            )
        except Exception as e:
            matrix.append({"seed": seed, "error": str(e)})
            print(f"[up-qwen] seed={seed} FAIL {e}", flush=True)

    summary = {
        "stage": "U1-R-up-qwen2511-outpaint",
        "tag": args.tag,
        "params": {
            "ext": args.ext,
            "steps": args.steps,
            "blend": args.blend,
            "preset": PRESET,
            "engine": "qwen-image-edit-2511 + force-stitch",
        },
        "finishedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "matrix": matrix,
        "releaseRule": "UP released only if all seeds pass BOSS visual multi-sample gate.",
        "note": "Phase A1 per GPT research ranking adapted for commercial self-host (Qwen Apache 2.0).",
    }
    out = out_root / f"up-qwen2511-summary-{args.tag}.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"[up-qwen] summary -> {out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
