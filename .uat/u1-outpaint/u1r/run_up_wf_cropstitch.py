#!/usr/bin/env python3
"""U1-R-up-wf: Crop+Stitch upward outpaint (Fooocus / Inpaint AIO style).

Instead of running SetLatentNoiseMask over the full 1024x1664 canvas:
  1) Build full canvas with soft side-edge pad
  2) Crop a window around the hairline
  3) Inpaint only that crop (with soft mask + optional Differential Diffusion via gateway)
  4) Stitch crop back with feathered alpha

Usage:
  python3 run_up_wf_cropstitch.py --seeds 424242,424243,777001 --tag wf1
"""
from __future__ import annotations

import argparse
import base64
import importlib.util
import io
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

HERE = Path(__file__).resolve().parent
UAT = HERE.parent
FIVE = UAT / "u1a-five-dir"
BASELINE = UAT / "baseline" / "u1-character-baseline.png"
QA_SCRIPT = UAT / "u1_qa" / "u1_qa.py"

_spec = importlib.util.spec_from_file_location("u1a_runner", FIVE / "run_u1a_five_dir.py")
u1a = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(u1a)

DEFAULT_SEEDS = (424242, 424243, 777001)
UP_LORA_KEYS = [
    "illustrious-masterpiece-v3",
    "bss-detail-enhancer-v3",
    "bss-skin-texture-v2",
    "eyes-for-illustrious",
]
UP_PROMPT = (
    "soft warm out-of-focus indoor wall and ceiling bokeh only above the hairline, "
    "match source room light and color temperature, seamless hairline transition, "
    "empty clean background only, no hands, no arms, no fingers, no face, no second person, "
    "no object on head, no device, no helmet, no hair dryer, no white box, "
    "no extra hair mass, no hard horizontal seam"
)


def round64(n: int) -> int:
    return max(64, int(round(n / 64.0)) * 64)


def sample_warm_mean(src: Image.Image) -> Tuple[int, int, int]:
    w, h = src.size
    samples: List[Tuple[int, int, int]] = []
    for box in [
        (0, 0, max(8, w // 5), h),
        (w - max(8, w // 5), 0, w, h),
        (0, max(0, h // 8), max(8, w // 6), max(8, h // 2)),
        (w - max(8, w // 6), max(0, h // 8), w, max(8, h // 2)),
    ]:
        samples.extend(list(src.crop(box).resize((40, 40)).getdata()))
    filt = [p for p in samples if (p[0] + p[1] + p[2]) / 3 > 95 and p[1] - (p[0] + p[2]) / 2 < 14]
    use = filt if len(filt) > 16 else samples
    n = max(1, len(use))
    return tuple(int(round(sum(p[i] for p in use) / n)) for i in range(3))  # type: ignore[return-value]


def build_full_canvas(src: Image.Image, seam: int, ratio: float) -> Dict[str, Any]:
    g = dict(u1a.geometry_for(src.size[0], src.size[1], "up", seam, ratio))
    g["seamOverlapPixels"] = seam
    tw, th = g["targetWidth"], g["targetHeight"]
    ext_h = g["extensionPixels"]
    sy = g["sourceOffsetY"]
    mean = sample_warm_mean(src)
    w, h = src.size
    bg = Image.new("RGB", (w, h), mean)
    lb = src.crop((0, 0, max(8, w // 4), h)).resize((max(8, w // 3), h)).filter(ImageFilter.GaussianBlur(28))
    rb = src.crop((w - max(8, w // 4), 0, w, h)).resize((max(8, w // 3), h)).filter(ImageFilter.GaussianBlur(28))
    bg.paste(lb, (0, 0))
    bg.paste(rb, (w - max(8, w // 3), 0))
    # near hairline sides: sample a bit of real top side light
    top_l = src.crop((0, 0, max(8, w // 5), max(8, h // 6))).resize((max(8, w // 3), max(8, ext_h // 4))).filter(
        ImageFilter.GaussianBlur(10)
    )
    top_r = src.crop((w - max(8, w // 5), 0, w, max(8, h // 6))).resize((max(8, w // 3), max(8, ext_h // 4))).filter(
        ImageFilter.GaussianBlur(10)
    )
    bg = bg.filter(ImageFilter.GaussianBlur(40))
    bg = ImageEnhance.Color(bg).enhance(0.82)
    bg = ImageEnhance.Contrast(bg).enhance(0.88)
    ext_plate = bg.resize((tw, ext_h), Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(5))
    # paste top side light into lower extension (near hairline)
    try:
        ext_plate.paste(top_l.resize((tw // 3, max(8, ext_h // 5))), (0, ext_h - max(8, ext_h // 5)))
        ext_plate.paste(top_r.resize((tw // 3, max(8, ext_h // 5))), (tw - tw // 3, ext_h - max(8, ext_h // 5)))
        ext_plate = ext_plate.filter(ImageFilter.GaussianBlur(4))
    except Exception:
        pass

    full = Image.new("RGB", (tw, th), mean)
    full.paste(ext_plate, (0, 0))
    full.paste(src, (g["sourceOffsetX"], sy))
    return {"geometry": g, "full": full, "mean": mean, "sy": sy, "tw": tw, "th": th, "ext_h": ext_h}


def make_crop_window(sy: int, th: int, band: int, context_below: int, margin_above: int) -> Tuple[int, int]:
    """Return [y0, y1) crop on full canvas, height multiple of 64."""
    y0 = max(0, sy - band - margin_above)
    y1 = min(th, sy + context_below)
    h = y1 - y0
    h64 = round64(h)
    # expand downward first, then upward
    extra = h64 - h
    y1 = min(th, y1 + extra)
    still = h64 - (y1 - y0)
    y0 = max(0, y0 - still)
    # final clamp
    if y1 - y0 < 64:
        y0 = max(0, sy - 128)
        y1 = min(th, y0 + 256)
    # force multiple of 64 by trimming bottom if needed
    y1 = y0 + round64(y1 - y0)
    if y1 > th:
        y1 = th
        y0 = max(0, y1 - round64(y1 - max(0, sy - band - margin_above)))
    return y0, y1


def build_crop_mask(crop_h: int, crop_w: int, local_sy: int, band: int, seam: int) -> Image.Image:
    """RGBA protect mask: white/opaque=protect, alpha0=redraw.

    wf2: far top of crop is HARD protect (pad only). Only a thin band just above
    the hairline is redrawn, reducing invented head-props.
    """
    mask = Image.new("RGBA", (crop_w, crop_h), (255, 255, 255, 255))
    md = ImageDraw.Draw(mask)
    # redraw only thin band above hairline (not full `band` height)
    redraw_h = max(48, min(band, 120))
    y_redraw0 = max(0, local_sy - redraw_h)
    md.rectangle([0, y_redraw0, crop_w, local_sy], fill=(0, 0, 0, 0))
    # soft seam into source
    for i in range(min(seam, max(0, crop_h - local_sy))):
        t = i / max(1, seam - 1)
        a = int(255 * t)
        y = local_sy + i
        md.line([(0, y), (crop_w - 1, y)], fill=(255, 255, 255, a))
    # soft falloff at top of redraw → pad (so no hard line against pure pad)
    fall = min(36, redraw_h // 2)
    for i in range(fall):
        y = y_redraw0 + i
        if y >= local_sy:
            break
        t = i / max(1, fall - 1)
        # top of redraw: more protect (prefer pad); bottom: full redraw
        a = int(200 * (1 - t))
        md.line([(0, y), (crop_w - 1, y)], fill=(255, 255, 255, a))
    mask = mask.filter(ImageFilter.GaussianBlur(radius=max(2, seam // 5)))
    md2 = ImageDraw.Draw(mask)
    if local_sy + seam < crop_h:
        md2.rectangle([0, local_sy + seam, crop_w, crop_h], fill=(255, 255, 255, 255))
    # hard protect everything above redraw band
    if y_redraw0 > 0:
        md2.rectangle([0, 0, crop_w, y_redraw0], fill=(255, 255, 255, 255))
    return mask


def feather_paste(dest: Image.Image, src: Image.Image, box: Tuple[int, int, int, int], feather: int = 24) -> Image.Image:
    """Paste src into dest[box] with edge feather. box=(x0,y0,x1,y1)."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    if src.size != (w, h):
        src = src.resize((w, h), Image.Resampling.LANCZOS)
    out = dest.copy()
    # build alpha ramp on edges
    alpha = Image.new("L", (w, h), 255)
    ad = ImageDraw.Draw(alpha)
    for i in range(feather):
        a = int(255 * (i / max(1, feather - 1)))
        # top edge: low alpha at top
        ad.line([(0, i), (w - 1, i)], fill=a)
        # bottom edge
        ad.line([(0, h - 1 - i), (w - 1, h - 1 - i)], fill=a)
    alpha = alpha.filter(ImageFilter.GaussianBlur(radius=max(1, feather // 3)))
    rgba = src.convert("RGBA")
    rgba.putalpha(alpha)
    base = out.crop((x0, y0, x1, y1)).convert("RGBA")
    blended = Image.alpha_composite(base, rgba)
    out.paste(blended.convert("RGB"), (x0, y0))
    return out


def run_one(
    *,
    seed: int,
    band: int,
    denoise: float,
    seam: int,
    ratio: float,
    context_below: int,
    margin_above: int,
    use_dd: bool,
    out_root: Path,
    tag: str,
) -> Dict[str, Any]:
    case = out_root / f"up-wf-cs-s{seed}-{tag}"
    case.mkdir(parents=True, exist_ok=True)
    src = Image.open(BASELINE).convert("RGB")
    built = build_full_canvas(src, seam=seam, ratio=ratio)
    full = built["full"]
    g = built["geometry"]
    sy, tw, th = built["sy"], built["tw"], built["th"]

    y0, y1 = make_crop_window(sy, th, band=band, context_below=context_below, margin_above=margin_above)
    crop = full.crop((0, y0, tw, y1))
    local_sy = sy - y0
    crop_mask = build_crop_mask(crop.size[1], crop.size[0], local_sy, band=band, seam=seam)

    # Do NOT upscale crop width (wf1 2752-wide blew up artifacts). Keep native width;
    # only pad height to multiple of 64 if needed.
    cw, ch = crop.size
    scale = 1.0
    nw, nh = cw, round64(ch)
    if nh != ch:
        # pad bottom with last rows instead of stretch-distorting hairline
        crop_s = Image.new("RGB", (nw, nh), (128, 128, 128))
        crop_s.paste(crop, (0, 0))
        if nh > ch:
            pad_row = crop.crop((0, ch - 1, cw, ch)).resize((nw, nh - ch))
            crop_s.paste(pad_row, (0, ch))
        mask_s = Image.new("RGBA", (nw, nh), (255, 255, 255, 255))
        mask_s.paste(crop_mask, (0, 0))
    else:
        crop_s, mask_s = crop, crop_mask

    size = f"{nw}x{nh}"
    base_name = f"crop-base-{size}.png"
    mask_name = f"crop-mask-{size}.png"
    crop_s.save(case / base_name)
    mask_s.save(case / mask_name)
    full.save(case / "full-canvas-before.png")
    crop.save(case / "crop-native.png")
    crop_mask.save(case / "crop-mask-native.png")

    extra = {
        "lora_keys": UP_LORA_KEYS,
        "face_detailer": False,
        "denoise": denoise,
        "seam_feather": seam,
        "outpaint_direction": "up",
        "prompt_optimize": False,
        "seed": seed,
        "use_differential_diffusion": True if use_dd else False,
        "differential_strength": 1.0,
    }
    req = {
        "endpoint": u1a.ENDPOINT,
        "model": u1a.MODEL,
        "size": size,
        "prompt": UP_PROMPT,
        "image": base_name,
        "mask": mask_name,
        "extra": extra,
        "geometry": g,
        "case": f"U1-R-up-wf-cropstitch-s{seed}",
        "hypothesis": "Crop+Stitch hairline window + soft mask; optional Differential Diffusion on gateway",
        "cropWindow": [0, y0, tw, y1],
        "localSy": local_sy,
        "band": band,
        "scale": scale,
        "use_dd": use_dd,
        "seed": seed,
    }
    (case / "request.json").write_text(json.dumps(req, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (case / "started-at.txt").write_text(time.strftime("%Y-%m-%dT%H:%M:%S%z") + "\n", encoding="utf-8")

    print(f"[up-wf-cs] seed={seed} crop={size} window=y[{y0},{y1}) local_sy={local_sy} dd={use_dd}", flush=True)
    t0 = time.time()
    status, raw = u1a.multipart_submit(
        UP_PROMPT,
        size,
        (case / base_name).read_bytes(),
        (case / mask_name).read_bytes(),
        base_name,
        mask_name,
        extra,
    )
    elapsed = round(time.time() - t0, 1)
    (case / "http-status.txt").write_text(str(status) + "\n", encoding="utf-8")
    (case / "response.json").write_bytes(raw)
    print(f"[up-wf-cs] seed={seed} http={status} elapsed={elapsed}s", flush=True)
    data = json.loads(raw)
    if data.get("execution_receipt"):
        (case / "execution-receipt.json").write_text(
            json.dumps(data["execution_receipt"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    items = data.get("data") or []
    if not (items and items[0].get("b64_json")):
        # fallback: if DD node missing, retry without DD once
        err_txt = raw[:500].decode("utf-8", "replace") if isinstance(raw, (bytes, bytearray)) else str(raw)[:500]
        if use_dd:
            print(f"[up-wf-cs] seed={seed} no b64 with DD, retry without DD. head={err_txt[:200]}", flush=True)
            extra2 = dict(extra)
            extra2["use_differential_diffusion"] = False
            status, raw = u1a.multipart_submit(
                UP_PROMPT,
                size,
                (case / base_name).read_bytes(),
                (case / mask_name).read_bytes(),
                base_name,
                mask_name,
                extra2,
            )
            (case / "response-retry-no-dd.json").write_bytes(raw)
            data = json.loads(raw)
            items = data.get("data") or []
            use_dd = False
        if not (items and items[0].get("b64_json")):
            raise RuntimeError(f"seed {seed}: no b64_json; body head={raw[:300]!r}")

    crop_out = Image.open(io.BytesIO(base64.b64decode(items[0]["b64_json"]))).convert("RGB")
    crop_out.save(case / "crop-result.png")
    if crop_out.size != (cw, ch):
        # if model returned padded height, crop top-left native region
        if crop_out.size[0] == cw and crop_out.size[1] >= ch:
            crop_out_native = crop_out.crop((0, 0, cw, ch))
        else:
            crop_out_native = crop_out.resize((cw, ch), Image.Resampling.LANCZOS)
    else:
        crop_out_native = crop_out
    crop_out_native.save(case / "crop-result-native.png")

    # Stitch: prefer pad for far extension; only blend model near hairline (anti head-props)
    final = full.copy()
    local_sy = sy - y0
    blend_h = max(48, min(band, 120))
    # pure pad already in full for y < sy - blend_h
    # blend zone: [sy - blend_h, sy + soft]
    soft = max(20, seam // 2)
    for i in range(blend_h + soft):
        y_full = sy - blend_h + i
        y_crop = local_sy - blend_h + i
        if y_full < 0 or y_full >= th or y_crop < 0 or y_crop >= ch:
            continue
        t = i / max(1, blend_h + soft - 1)
        # smoothstep: start pad-heavy, mid model, end source
        if i < blend_h:
            # above hairline: pad → model
            u = i / max(1, blend_h - 1)
            u = u * u * (3 - 2 * u)
            pad_row = full.crop((0, y_full, tw, y_full + 1))
            mod_row = crop_out_native.crop((0, y_crop, cw, y_crop + 1))
            # cap model influence to avoid inventing solid props (max 0.65 near hairline)
            mix = min(0.65, u)
            final.paste(Image.blend(pad_row, mod_row, mix), (0, y_full))
        else:
            # into source: model/gen → source lock
            j = i - blend_h
            u = j / max(1, soft - 1)
            u = u * u * (3 - 2 * u)
            src_row = src.crop((0, j, src.size[0], j + 1))
            gen_row = crop_out_native.crop((0, y_crop, cw, y_crop + 1)) if y_crop < ch else src_row
            final.paste(Image.blend(gen_row, src_row, u), (g["sourceOffsetX"], y_full))
    # absolute lock deep source
    if soft < src.size[1]:
        final.paste(src.crop((0, soft, src.size[0], src.size[1])), (g["sourceOffsetX"], sy + soft))

    result_path = case / f"u1r-up-wf-cs-s{seed}-result.png"
    final.save(result_path)
    final.save(case / "up-wf-cs-result.png")

    # QA on full result: need request geometry for qa - rewrite request for full canvas
    full_req = dict(req)
    full_req["size"] = f"{tw}x{th}"
    full_req["image"] = "full-canvas-before.png"
    # dummy mask name not needed if metrics use result vs base geometry
    (case / "request.json").write_text(json.dumps(full_req, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # base for protect metrics should be full canvas pad+source
    # QA finds *-result.png and base from request.image
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
        "httpStatus": status,
        "elapsedSec": elapsed,
        "cropWindow": [0, y0, tw, y1],
        "use_dd": use_dd,
        "provisional": metrics.get("provisional"),
        "darkPct": metrics.get("darkPct"),
        "farDarkPct": metrics.get("farDarkPct"),
        "gdom": metrics.get("gdom"),
        "relDeltaE": metrics.get("relDeltaE"),
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
        f"[up-wf-cs] seed={seed} provisional={summary.get('provisional')} "
        f"dark={summary.get('darkPct')} seam={summary.get('seamWorst')}",
        flush=True,
    )
    return summary


def main(argv: Sequence[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--seeds", default=",".join(str(s) for s in DEFAULT_SEEDS))
    p.add_argument("--band", type=int, default=112)
    p.add_argument("--denoise", type=float, default=0.52)
    p.add_argument("--seam", type=int, default=96)
    p.add_argument("--ratio", type=float, default=0.625)
    p.add_argument("--context-below", type=int, default=160)
    p.add_argument("--margin-above", type=int, default=64)
    p.add_argument("--no-dd", action="store_true", help="disable Differential Diffusion")
    p.add_argument("--tag", default=time.strftime("%Y%m%d-%H%M%S"))
    p.add_argument("--out-root", type=Path, default=HERE / "up-wf-cropstitch")
    args = p.parse_args(argv)

    seeds = [int(x.strip()) for x in args.seeds.split(",") if x.strip()]
    out_root = args.out_root
    out_root.mkdir(parents=True, exist_ok=True)
    matrix = []
    for seed in seeds:
        try:
            matrix.append(
                run_one(
                    seed=seed,
                    band=args.band,
                    denoise=args.denoise,
                    seam=args.seam,
                    ratio=args.ratio,
                    context_below=args.context_below,
                    margin_above=args.margin_above,
                    use_dd=not args.no_dd,
                    out_root=out_root,
                    tag=args.tag,
                )
            )
        except Exception as e:
            matrix.append({"seed": seed, "error": str(e)})
            print(f"[up-wf-cs] seed={seed} ERROR {e}", flush=True)

    summary = {
        "stage": "U1-R-up-wf-cropstitch",
        "tag": args.tag,
        "params": {
            "band": args.band,
            "denoise": args.denoise,
            "seam": args.seam,
            "ratio": args.ratio,
            "context_below": args.context_below,
            "margin_above": args.margin_above,
            "differential_diffusion": not args.no_dd,
            "loras": UP_LORA_KEYS,
        },
        "finishedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "matrix": matrix,
        "releaseRule": "UP released only if all seeds pass BOSS visual (no hands/second face/hard seam).",
        "note": "Crop+Stitch workflow experiment inspired by Civitai Inpaint AIO / Fooocus Crop&Stitch.",
    }
    out = out_root / f"up-wf-cs-summary-{args.tag}.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"[up-wf-cs] summary -> {out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
