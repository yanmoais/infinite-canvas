#!/usr/bin/env python3
"""U1-R up-hybrid product runner.

Product path for upward extend (BOSS-validated direction after R1–R4):
  - Far extension: soft background pad only (no free diffusion)
  - Hairline band: low/mid denoise inpaint
  - Source region: pixel-locked composite

Usage:
  python3 run_up_hybrid.py
  python3 run_up_hybrid.py --seeds 424242,424243,777001
  python3 run_up_hybrid.py --band 144 --denoise 0.55 --seam 96
"""
from __future__ import annotations

import argparse
import base64
import importlib.util
import io
import json
import time
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

HERE = Path(__file__).resolve().parent
UAT = HERE.parent
FIVE = UAT / "u1a-five-dir"
BASELINE = UAT / "baseline" / "u1-character-baseline.png"
QA_SCRIPT = UAT / "u1_qa" / "u1_qa.py"

# Load U1-A submit helpers
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
    # deliberately exclude: dramatic-lighting-slider, bss-visual-enhancer-v3, hand-focus
]
UP_PROMPT = (
    "soft warm out-of-focus indoor wall and ceiling bokeh only above the hairline, "
    "match source room light and color temperature, seamless hairline transition, "
    "background only, no hands, no arms, no fingers, no face, no second person, "
    "no extra hair mass, no hard horizontal seam"
)


def sample_warm_mean(src: Image.Image) -> Tuple[int, int, int]:
    w, h = src.size
    samples: List[Tuple[int, int, int]] = []
    boxes = [
        (0, 0, max(8, w // 5), h),
        (w - max(8, w // 5), 0, w, h),
        (0, 0, max(8, w // 4), max(8, h // 3)),
        (w - max(8, w // 4), 0, w, max(8, h // 3)),
    ]
    for box in boxes:
        samples.extend(list(src.crop(box).resize((48, 48)).getdata()))
    filt = [
        p
        for p in samples
        if (p[0] + p[1] + p[2]) / 3 > 100 and p[1] - (p[0] + p[2]) / 2 < 12
    ]
    use = filt if len(filt) > 20 else samples
    n = max(1, len(use))
    return tuple(int(round(sum(p[i] for p in use) / n)) for i in range(3))  # type: ignore[return-value]


def build_soft_bg_plate(src: Image.Image, mean: Tuple[int, int, int]) -> Image.Image:
    w, h = src.size
    bg = Image.new("RGB", (w, h), mean)
    left = src.crop((0, 0, max(8, w // 4), h)).resize((max(8, w // 3), h)).filter(ImageFilter.GaussianBlur(30))
    right = src.crop((w - max(8, w // 4), 0, w, h)).resize((max(8, w // 3), h)).filter(ImageFilter.GaussianBlur(30))
    bg.paste(left, (0, 0))
    bg.paste(right, (w - max(8, w // 3), 0))
    bg = bg.filter(ImageFilter.GaussianBlur(50))
    bg = ImageEnhance.Color(bg).enhance(0.8)
    bg = ImageEnhance.Contrast(bg).enhance(0.85)
    return bg


def build_hybrid_assets(
    src: Image.Image,
    *,
    seam: int,
    band_inpaint: int,
    extension_ratio: float,
) -> Dict[str, Any]:
    g = dict(u1a.geometry_for(src.size[0], src.size[1], "up", seam, extension_ratio))
    g["seamOverlapPixels"] = seam
    tw, th = g["targetWidth"], g["targetHeight"]
    ext_h = g["extensionPixels"]
    sy = g["sourceOffsetY"]
    mean = sample_warm_mean(src)
    plate = build_soft_bg_plate(src, mean)
    ext_plate = plate.resize((tw, ext_h), Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(6))

    composite = Image.new("RGB", (tw, th), mean)
    composite.paste(ext_plate, (0, 0))
    composite.paste(src, (g["sourceOffsetX"], sy))

    inpaint_base = composite.copy()
    y0 = max(0, sy - band_inpaint)

    # mask: only hairline band + soft seam into source
    mask = Image.new("RGBA", (tw, th), (255, 255, 255, 255))
    md = ImageDraw.Draw(mask)
    md.rectangle([0, y0, tw, sy], fill=(0, 0, 0, 0))
    for i in range(seam):
        a = int(255 * (i / max(1, seam - 1)))
        y = sy + i
        if y < th:
            md.line([(0, y), (tw - 1, y)], fill=(255, 255, 255, a))
    mask = mask.filter(ImageFilter.GaussianBlur(radius=max(1, seam // 5)))
    md2 = ImageDraw.Draw(mask)
    if y0 > 0:
        md2.rectangle([0, 0, tw, y0], fill=(255, 255, 255, 255))
    md2.rectangle([0, sy + seam, tw, th], fill=(255, 255, 255, 255))

    return {
        "geometry": g,
        "mean": mean,
        "composite": composite,
        "inpaint_base": inpaint_base,
        "mask": mask,
        "y0": y0,
        "sy": sy,
        "tw": tw,
        "th": th,
        "band_inpaint": band_inpaint,
        "seam": seam,
    }


def hybrid_composite(model_img: Image.Image, composite: Image.Image, src: Image.Image, g: Dict[str, Any], y0: int, sy: int, seam: int) -> Image.Image:
    """Compose pad + model band + source with a soft hairline (no hard paste cut)."""
    tw, th = composite.size
    sx = g["sourceOffsetX"]
    # Start from pure pad plate
    final = composite.copy()
    # Place model only in [y0, sy+seam)
    y1 = min(th, sy + seam)
    if y1 > y0:
        final.paste(model_img.crop((0, y0, tw, y1)), (0, y0))

    # Soft blend pad → model at band top
    fade_top = 32
    for i in range(fade_top):
        y = y0 + i
        if y >= th:
            break
        t = i / max(1, fade_top - 1)
        final.paste(Image.blend(composite.crop((0, y, tw, y + 1)), model_img.crop((0, y, tw, y + 1)), t), (0, y))

    # Soft hairline: blend model → source across [sy-soft_above, sy+soft_below]
    # This is the main fix for the hard white line across the crown.
    soft_above = 40
    soft_below = max(24, min(48, seam // 2))
    # Paste deep source first (below soft_below)
    if sy + soft_below < th:
        deep = src.crop((0, soft_below, src.size[0], src.size[1]))
        final.paste(deep, (sx, sy + soft_below))

    for i in range(soft_above + soft_below):
        y = sy - soft_above + i
        if y < 0 or y >= th:
            continue
        # t=0 at top of window (prefer model/pad), t=1 at bottom (prefer source)
        t = i / max(1, soft_above + soft_below - 1)
        # smoothstep
        t = t * t * (3 - 2 * t)
        if y < sy:
            # above hairline: model vs composite pad (already model-heavy)
            a = model_img.crop((0, y, tw, y + 1))
            b = final.crop((0, y, tw, y + 1))
            # as we approach sy, increase pull from model near hair silhouette is already in a;
            # mix a bit of source top edge color via composite source row 0 when close
            if sy - y <= 12:
                src_row = src.crop((0, 0, src.size[0], 1)).resize((tw, 1))
                a = Image.blend(a, src_row, 0.25 * (1 - (sy - y) / 12))
            final.paste(Image.blend(a, b, 0.15 * (1 - t)), (0, y))
        else:
            # inside source soft band: blend model_img row with real source row
            src_y = y - sy
            src_row = src.crop((0, src_y, src.size[0], src_y + 1))
            mod_row = model_img.crop((0, y, tw, y + 1))
            # t→1 means fully source
            blended = Image.blend(mod_row, src_row, t)
            final.paste(blended, (sx, y))

    # Absolute lock for core source below soft band
    if soft_below < src.size[1]:
        final.paste(src.crop((0, soft_below, src.size[0], src.size[1])), (sx, sy + soft_below))
    return final


def run_one(
    *,
    seed: int,
    band: int,
    denoise: float,
    seam: int,
    extension_ratio: float,
    out_root: Path,
    round_tag: str,
) -> Dict[str, Any]:
    case = out_root / f"up-hybrid-s{seed}-{round_tag}"
    case.mkdir(parents=True, exist_ok=True)
    src = Image.open(BASELINE).convert("RGB")
    assets = build_hybrid_assets(src, seam=seam, band_inpaint=band, extension_ratio=extension_ratio)
    g = assets["geometry"]
    tw, th = assets["tw"], assets["th"]
    size = f"{tw}x{th}"
    base_name = f"up-hybrid-base-{size}.png"
    mask_name = f"up-hybrid-mask-band{band}-seam{seam}-{size}.png"
    assets["inpaint_base"].save(case / base_name)
    assets["mask"].save(case / mask_name)
    assets["composite"].save(case / "composite-pad-only.png")
    assets["mask"].convert("RGB").save(case / "mask-preview.png")

    extra = {
        "lora_keys": UP_LORA_KEYS,
        "face_detailer": False,
        "denoise": denoise,
        "seam_feather": seam,
        "outpaint_direction": "up",
        "prompt_optimize": False,
        "seed": seed,
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
        "case": f"U1-R-up-hybrid-seed{seed}",
        "hypothesis": "Product up-hybrid: far soft pad + hairline narrow inpaint; multi-seed gate",
        "bandInpaint": band,
        "meanBg": list(assets["mean"]),
        "loras": UP_LORA_KEYS,
        "seed": seed,
    }
    (case / "request.json").write_text(json.dumps(req, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (case / "started-at.txt").write_text(time.strftime("%Y-%m-%dT%H:%M:%S%z") + "\n", encoding="utf-8")

    print(f"[up-hybrid] seed={seed} size={size} band={band} denoise={denoise}", flush=True)
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
    (case / "http-status.txt").write_text(str(status) + "\n", encoding="utf-8")
    (case / "response.json").write_bytes(raw)
    elapsed = round(time.time() - t0, 1)
    print(f"[up-hybrid] seed={seed} http={status} elapsed={elapsed}s", flush=True)
    data = json.loads(raw)
    if data.get("execution_receipt"):
        (case / "execution-receipt.json").write_text(
            json.dumps(data["execution_receipt"], ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    items = data.get("data") or []
    if not (items and items[0].get("b64_json")):
        raise RuntimeError(f"seed {seed}: no b64_json in response")
    model_img = Image.open(io.BytesIO(base64.b64decode(items[0]["b64_json"]))).convert("RGB")
    model_img.save(case / "model-raw.png")
    final = hybrid_composite(
        model_img,
        assets["composite"],
        src,
        g,
        assets["y0"],
        assets["sy"],
        seam,
    )
    result_path = case / f"u1r-up-hybrid-s{seed}-result.png"
    # name also with *-result.png for QA glob
    final.save(result_path)
    final.save(case / "up-hybrid-result.png")

    # QA
    import subprocess
    import sys

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
    print(f"[up-hybrid] seed={seed} provisional={summary['provisional']} dark={summary['darkPct']} far={summary['farDarkPct']} gdom={summary['gdom']}", flush=True)
    return summary


def gate_seed(summary: Dict[str, Any]) -> Dict[str, Any]:
    """Deterministic pre-gate only; BOSS visual is still required for pass."""
    reasons = []
    ok = True
    if summary.get("protectedCoreDiffRatio", 0) and summary["protectedCoreDiffRatio"] > 0.02:
        ok = False
        reasons.append("protect_drift")
    # hard auto fails that usually mean invented junk
    fails = {a[0] for a in summary.get("autoFindings") or [] if a[1] == "FAIL"}
    if "void_dark" in fails and (summary.get("farDarkPct") or 0) >= 70:
        ok = False
        reasons.append("void_dark_fail")
    # second face / hands are visual; metrics can't see them reliably
    reasons.append("visual_review_required")
    return {"deterministicPreGate": "PASS_PENDING_VISUAL" if ok else "FAIL", "reasons": reasons}


def main(argv: Sequence[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="U1 up-hybrid multi-seed runner")
    p.add_argument("--seeds", default=",".join(str(s) for s in DEFAULT_SEEDS))
    p.add_argument("--band", type=int, default=144, help="hairline inpaint band height in px")
    p.add_argument("--denoise", type=float, default=0.55)
    p.add_argument("--seam", type=int, default=96)
    p.add_argument("--ratio", type=float, default=0.625)
    p.add_argument("--tag", default=time.strftime("%Y%m%d-%H%M%S"))
    p.add_argument("--out-root", type=Path, default=HERE / "up-hybrid-matrix")
    args = p.parse_args(argv)

    seeds = [int(x.strip()) for x in args.seeds.split(",") if x.strip()]
    out_root = args.out_root
    out_root.mkdir(parents=True, exist_ok=True)
    matrix = []
    for seed in seeds:
        try:
            s = run_one(
                seed=seed,
                band=args.band,
                denoise=args.denoise,
                seam=args.seam,
                extension_ratio=args.ratio,
                out_root=out_root,
                round_tag=args.tag,
            )
            s["gate"] = gate_seed(s)
            matrix.append(s)
        except Exception as e:
            matrix.append({"seed": seed, "error": str(e), "gate": {"deterministicPreGate": "FAIL", "reasons": ["submit_error"]}})
            print(f"[up-hybrid] seed={seed} ERROR {e}", flush=True)

    summary = {
        "stage": "U1-R-up-hybrid-matrix",
        "tag": args.tag,
        "params": {
            "band": args.band,
            "denoise": args.denoise,
            "seam": args.seam,
            "ratio": args.ratio,
            "loras": UP_LORA_KEYS,
        },
        "baseline": str(BASELINE),
        "finishedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "matrix": matrix,
        "releaseRule": (
            "Direction UP is released only if: (1) all seeds deterministicPreGate != FAIL; "
            "(2) BOSS visual OK on every seed (no hands/second face/hard seam/color break); "
            "(3) then and only then proceed to next direction."
        ),
        "note": "Automated metrics cannot certify hands/second-face; BOSS multi-sample visual is mandatory.",
    }
    out = out_root / f"up-hybrid-summary-{args.tag}.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"[up-hybrid] summary -> {out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
