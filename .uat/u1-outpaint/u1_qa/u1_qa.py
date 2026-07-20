#!/usr/bin/env python3
"""U1-QA: geometry-driven crops, seam continuity metrics, and qa-report scaffold.

Usage:
  python3 u1_qa.py --case-dir ../u1a-five-dir/u1a-down
  python3 u1_qa.py --matrix-root ../u1a-five-dir
  python3 u1_qa.py --matrix-root ../u1a-five-dir --directions up,down,left,right,outward
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from PIL import Image, ImageChops, ImageStat

SCHEMA_VERSION = "u1-qa-v1"
QA_PROFILE_VERSION = "u1-qa-profile-v1"
GENERATOR_VERSION = "u1_qa.py@2026-07-17"
THIS_DIR = Path(__file__).resolve().parent
DEFAULT_THRESHOLD_PATH = THIS_DIR / "threshold_profile_v1.json"
DIRS_DEFAULT = ("up", "down", "left", "right", "outward")

Box = Tuple[int, int, int, int]  # left, top, right, bottom


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def clamp_box(box: Box, w: int, h: int) -> Optional[Box]:
    l, t, r, b = box
    l = max(0, min(w, l))
    t = max(0, min(h, t))
    r = max(0, min(w, r))
    b = max(0, min(h, b))
    if r <= l or b <= t:
        return None
    return (l, t, r, b)


def box_area(box: Box) -> int:
    return max(0, box[2] - box[0]) * max(0, box[3] - box[1])


def load_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_thresholds(path: Path) -> Dict[str, Any]:
    data = load_json(path)
    if "global" not in data:
        raise ValueError(f"threshold profile missing global: {path}")
    return data


def thr_for(direction: str, profile: Dict[str, Any]) -> Dict[str, float]:
    out = dict(profile["global"])
    out.update((profile.get("directions") or {}).get(direction) or {})
    return out  # type: ignore[return-value]


@dataclass
class Geometry:
    direction: str
    target_w: int
    target_h: int
    extension_pixels: int
    seam: int
    sx: int
    sy: int
    sw: int
    sh: int

    @classmethod
    def from_request(cls, req: Dict[str, Any]) -> "Geometry":
        g = req["geometry"]
        direction = g.get("direction") or req.get("extra", {}).get("outpaint_direction")
        if not direction:
            raise ValueError("geometry.direction missing")
        return cls(
            direction=direction,
            target_w=int(g["targetWidth"]),
            target_h=int(g["targetHeight"]),
            extension_pixels=int(g["extensionPixels"]),
            seam=int(g["seamOverlapPixels"]),
            sx=int(g["sourceOffsetX"]),
            sy=int(g["sourceOffsetY"]),
            sw=int(g["sourceDrawWidth"]),
            sh=int(g["sourceDrawHeight"]),
        )


def protected_core_box(geo: Geometry) -> Box:
    s = geo.seam
    if geo.direction == "down":
        return (geo.sx, geo.sy, geo.sx + geo.sw, geo.sy + max(1, geo.sh - s))
    if geo.direction == "up":
        return (geo.sx, geo.sy + s, geo.sx + geo.sw, geo.sy + geo.sh)
    if geo.direction == "left":
        return (geo.sx + s, geo.sy, geo.sx + geo.sw, geo.sy + geo.sh)
    if geo.direction == "right":
        return (geo.sx, geo.sy, geo.sx + max(1, geo.sw - s), geo.sy + geo.sh)
    # outward
    return (geo.sx + s, geo.sy + s, geo.sx + geo.sw - s, geo.sy + geo.sh - s)


def source_box(geo: Geometry) -> Box:
    return (geo.sx, geo.sy, geo.sx + geo.sw, geo.sy + geo.sh)


def extension_boxes(geo: Geometry) -> Dict[str, Box]:
    """Primary extension region(s)."""
    tw, th = geo.target_w, geo.target_h
    if geo.direction == "down":
        return {"extension": (0, geo.sy + geo.sh, tw, th)}
    if geo.direction == "up":
        return {"extension": (0, 0, tw, geo.sy)}
    if geo.direction == "left":
        return {"extension": (0, 0, geo.sx, th)}
    if geo.direction == "right":
        return {"extension": (geo.sx + geo.sw, 0, tw, th)}
    # outward: four sides
    sx, sy, sw, sh = geo.sx, geo.sy, geo.sw, geo.sh
    return {
        "extension_top": (0, 0, tw, sy),
        "extension_bottom": (0, sy + sh, tw, th),
        "extension_left": (0, sy, sx, sy + sh),
        "extension_right": (sx + sw, sy, tw, sy + sh),
    }


def seam_band_boxes(geo: Geometry, half_band: Optional[int] = None) -> Dict[str, Box]:
    """Bands centered on the soft-seam boundary between protected source and generated area."""
    s = geo.seam
    hb = half_band if half_band is not None else max(24, min(96, s // 2 or 24))
    tw, th = geo.target_w, geo.target_h
    sx, sy, sw, sh = geo.sx, geo.sy, geo.sw, geo.sh

    if geo.direction == "down":
        y = sy + sh
        return {"seam": (0, max(0, y - hb), tw, min(th, y + hb))}
    if geo.direction == "up":
        y = sy
        return {"seam": (0, max(0, y - hb), tw, min(th, y + hb))}
    if geo.direction == "left":
        x = sx
        return {"seam": (max(0, x - hb), 0, min(tw, x + hb), th)}
    if geo.direction == "right":
        x = sx + sw
        return {"seam": (max(0, x - hb), 0, min(tw, x + hb), th)}

    # outward four seams
    return {
        "seam_top": (sx, max(0, sy - hb), sx + sw, min(th, sy + hb)),
        "seam_bottom": (sx, max(0, sy + sh - hb), sx + sw, min(th, sy + sh + hb)),
        "seam_left": (max(0, sx - hb), sy, min(tw, sx + hb), sy + sh),
        "seam_right": (max(0, sx + sw - hb), sy, min(tw, sx + sw + hb), sy + sh),
    }


def far_extension_boxes(geo: Geometry) -> Dict[str, Box]:
    """Far from seam half of extension (void_dark spatialization)."""
    tw, th = geo.target_w, geo.target_h
    if geo.direction == "down":
        y0 = geo.sy + geo.sh
        mid = y0 + max(1, (th - y0) // 2)
        return {"far_extension": (0, mid, tw, th)}
    if geo.direction == "up":
        mid = max(1, geo.sy // 2)
        return {"far_extension": (0, 0, tw, mid)}
    if geo.direction == "left":
        mid = max(1, geo.sx // 2)
        return {"far_extension": (0, 0, mid, th)}
    if geo.direction == "right":
        x0 = geo.sx + geo.sw
        mid = x0 + max(1, (tw - x0) // 2)
        return {"far_extension": (mid, 0, tw, th)}
    # outward far rings: outer half of each side
    sx, sy, sw, sh = geo.sx, geo.sy, geo.sw, geo.sh
    return {
        "far_top": (0, 0, tw, max(1, sy // 2)),
        "far_bottom": (0, sy + sh + max(0, (th - (sy + sh)) // 2), tw, th),
        "far_left": (0, sy, max(1, sx // 2), sy + sh),
        "far_right": (sx + sw + max(0, (tw - (sx + sw)) // 2), sy, tw, sy + sh),
    }


def corner_boxes(geo: Geometry, size: int = 256) -> Dict[str, Box]:
    tw, th = geo.target_w, geo.target_h
    s = min(size, tw, th)
    return {
        "corner_tl": (0, 0, s, s),
        "corner_tr": (tw - s, 0, tw, s),
        "corner_bl": (0, th - s, s, th),
        "corner_br": (tw - s, th - s, tw, th),
    }


def adjacent_source_band(geo: Geometry, depth: Optional[int] = None) -> Box:
    """Source-side strip next to the seam for relative color comparison."""
    d = depth if depth is not None else max(16, min(64, geo.seam // 2 or 16))
    sx, sy, sw, sh = geo.sx, geo.sy, geo.sw, geo.sh
    if geo.direction == "down":
        y1 = sy + sh
        return (sx, max(sy, y1 - d), sx + sw, y1)
    if geo.direction == "up":
        return (sx, sy, sx + sw, min(sy + sh, sy + d))
    if geo.direction == "left":
        return (sx, sy, min(sx + sw, sx + d), sy + sh)
    if geo.direction == "right":
        x1 = sx + sw
        return (max(sx, x1 - d), sy, x1, sy + sh)
    # outward: use inner ring just inside source (average via full core edge later)
    s = geo.seam
    return (sx + s, sy + s, sx + sw - s, sy + sh - s)


def adjacent_gen_band(geo: Geometry, depth: Optional[int] = None) -> Box:
    d = depth if depth is not None else max(16, min(64, geo.seam // 2 or 16))
    tw, th = geo.target_w, geo.target_h
    sx, sy, sw, sh = geo.sx, geo.sy, geo.sw, geo.sh
    if geo.direction == "down":
        y0 = sy + sh
        return (0, y0, tw, min(th, y0 + d))
    if geo.direction == "up":
        y1 = sy
        return (0, max(0, y1 - d), tw, y1)
    if geo.direction == "left":
        x1 = sx
        return (max(0, x1 - d), 0, x1, th)
    if geo.direction == "right":
        x0 = sx + sw
        return (x0, 0, min(tw, x0 + d), th)
    # outward: outer ring just outside source
    return (max(0, sx - d), max(0, sy - d), min(tw, sx + sw + d), min(th, sy + sh + d))


def sample_region_stats(img: Image.Image, box: Box, step: int = 2) -> Dict[str, Any]:
    crop = img.crop(box)
    w, h = crop.size
    px = crop.load()
    samples: List[Tuple[int, int, int]] = []
    for y in range(0, h, step):
        for x in range(0, w, step):
            samples.append(px[x, y])
    n = max(1, len(samples))
    mean = [sum(p[i] for p in samples) / n for i in range(3)]
    gdom = mean[1] - (mean[0] + mean[2]) / 2
    dark = sum(1 for p in samples if (p[0] + p[1] + p[2]) / 3 < 50) / n * 100
    greenish = sum(1 for p in samples if p[1] - (p[0] + p[2]) / 2 > 30) / n * 100
    whiteish = sum(1 for p in samples if min(p) > 160 and max(p) - min(p) < 40) / n * 100
    return {
        "sampleCount": len(samples),
        "meanRgb": [round(v, 2) for v in mean],
        "gdom": round(gdom, 2),
        "darkPct": round(dark, 1),
        "greenishPct": round(greenish, 1),
        "whiteishPct": round(whiteish, 1),
        "box": list(box),
    }


def approx_delta_e(rgb_a: Sequence[float], rgb_b: Sequence[float]) -> float:
    # Cheap perceptual stand-in (not CIE Lab): weighted RGB Euclidean.
    dr = rgb_a[0] - rgb_b[0]
    dg = rgb_a[1] - rgb_b[1]
    db = rgb_a[2] - rgb_b[2]
    return math.sqrt((2 * dr) ** 2 + (4 * dg) ** 2 + (3 * db) ** 2) / 5.0


def seam_continuity_metrics(result: Image.Image, geo: Geometry) -> Dict[str, Any]:
    """Cross-seam luminance/RGB jump and gradient peak along the boundary."""
    tw, th = result.size
    s = geo.seam
    strip = max(8, min(32, s // 4 or 8))
    px = result.load()

    def row_mean(y: int, x0: int, x1: int) -> Tuple[float, float, float, float]:
        xs = range(x0, x1, max(1, (x1 - x0) // 256 or 1))
        vals = [px[x, y] for x in xs]
        n = max(1, len(vals))
        r = sum(v[0] for v in vals) / n
        g = sum(v[1] for v in vals) / n
        b = sum(v[2] for v in vals) / n
        luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
        return r, g, b, luma

    def col_mean(x: int, y0: int, y1: int) -> Tuple[float, float, float, float]:
        ys = range(y0, y1, max(1, (y1 - y0) // 256 or 1))
        vals = [px[x, y] for y in ys]
        n = max(1, len(vals))
        r = sum(v[0] for v in vals) / n
        g = sum(v[1] for v in vals) / n
        b = sum(v[2] for v in vals) / n
        luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
        return r, g, b, luma

    def analyze_horizontal(y_boundary: int, x0: int, x1: int, name: str) -> Dict[str, Any]:
        y_src = max(0, min(th - 1, y_boundary - 1))
        y_gen = max(0, min(th - 1, y_boundary))
        src = row_mean(y_src, x0, x1)
        gen = row_mean(y_gen, x0, x1)
        # gradient peak across a local vertical window
        y0 = max(0, y_boundary - strip)
        y1 = min(th - 1, y_boundary + strip)
        peak = 0.0
        prev = None
        for y in range(y0, y1 + 1):
            cur = row_mean(y, x0, x1)[3]
            if prev is not None:
                peak = max(peak, abs(cur - prev))
            prev = cur
        luma_delta = abs(gen[3] - src[3])
        rgb_delta = math.sqrt(sum((gen[i] - src[i]) ** 2 for i in range(3)))
        return {
            "name": name,
            "axis": "horizontal",
            "boundary": y_boundary,
            "srcMeanRgb": [round(src[i], 2) for i in range(3)],
            "genMeanRgb": [round(gen[i], 2) for i in range(3)],
            "lumaDelta": round(luma_delta, 2),
            "rgbDelta": round(rgb_delta, 2),
            "gradPeak": round(peak, 2),
        }

    def analyze_vertical(x_boundary: int, y0: int, y1: int, name: str) -> Dict[str, Any]:
        x_src = max(0, min(tw - 1, x_boundary - 1))
        x_gen = max(0, min(tw - 1, x_boundary))
        # ensure src is on the source side
        if geo.direction == "left":
            x_src = min(tw - 1, x_boundary)
            x_gen = max(0, x_boundary - 1)
        src = col_mean(x_src, y0, y1)
        gen = col_mean(x_gen, y0, y1)
        x0 = max(0, x_boundary - strip)
        x1 = min(tw - 1, x_boundary + strip)
        peak = 0.0
        prev = None
        for x in range(x0, x1 + 1):
            cur = col_mean(x, y0, y1)[3]
            if prev is not None:
                peak = max(peak, abs(cur - prev))
            prev = cur
        luma_delta = abs(gen[3] - src[3])
        rgb_delta = math.sqrt(sum((gen[i] - src[i]) ** 2 for i in range(3)))
        return {
            "name": name,
            "axis": "vertical",
            "boundary": x_boundary,
            "srcMeanRgb": [round(src[i], 2) for i in range(3)],
            "genMeanRgb": [round(gen[i], 2) for i in range(3)],
            "lumaDelta": round(luma_delta, 2),
            "rgbDelta": round(rgb_delta, 2),
            "gradPeak": round(peak, 2),
        }

    seams: List[Dict[str, Any]] = []
    if geo.direction == "down":
        seams.append(analyze_horizontal(geo.sy + geo.sh, 0, tw, "seam_down"))
    elif geo.direction == "up":
        seams.append(analyze_horizontal(geo.sy, 0, tw, "seam_up"))
    elif geo.direction == "left":
        seams.append(analyze_vertical(geo.sx, 0, th, "seam_left"))
    elif geo.direction == "right":
        seams.append(analyze_vertical(geo.sx + geo.sw, 0, th, "seam_right"))
    else:
        seams.append(analyze_horizontal(geo.sy, geo.sx, geo.sx + geo.sw, "seam_top"))
        seams.append(analyze_horizontal(geo.sy + geo.sh, geo.sx, geo.sx + geo.sw, "seam_bottom"))
        seams.append(analyze_vertical(geo.sx, geo.sy, geo.sy + geo.sh, "seam_left"))
        seams.append(analyze_vertical(geo.sx + geo.sw, geo.sy, geo.sy + geo.sh, "seam_right"))

    worst = max(seams, key=lambda s: max(s["lumaDelta"], s["rgbDelta"], s["gradPeak"]))
    return {
        "seams": seams,
        "worst": {
            "name": worst["name"],
            "lumaDelta": worst["lumaDelta"],
            "rgbDelta": worst["rgbDelta"],
            "gradPeak": worst["gradPeak"],
        },
    }


def protected_core_diff(base: Image.Image, result: Image.Image, geo: Geometry) -> Dict[str, Any]:
    box = protected_core_box(geo)
    b = base.crop(box).convert("RGB")
    r = result.crop(box).convert("RGB")
    if b.size != r.size:
        r = r.resize(b.size)
    diff = ImageChops.difference(b, r)
    # Avoid Image.getdata deprecation path; flattened RGB tuples are enough here.
    different = sum(1 for px in list(diff.getdata()) if px != (0, 0, 0))
    total = b.size[0] * b.size[1]
    return {
        "box": list(box),
        "differentPixels": different,
        "totalPixels": total,
        "ratio": round(different / max(1, total), 6),
        "metricName": "protectedCoreDiffRatio",
    }


def level_from_thresholds(
    *,
    dark_pct: Optional[float],
    gdom: Optional[float],
    protect_ratio: float,
    seam: Dict[str, Any],
    far_dark_pct: Optional[float],
    rel_gdom: Optional[float],
    rel_delta_e: Optional[float],
    thr: Dict[str, float],
) -> Tuple[str, List[str]]:
    reasons: List[str] = []
    fail = False
    warn = False

    def mark(cond: bool, hard: bool, reason: str) -> None:
        nonlocal fail, warn
        if not cond:
            return
        reasons.append(reason)
        if hard:
            fail = True
        else:
            warn = True

    if dark_pct is not None:
        mark(dark_pct >= thr["darkPctFail"], True, f"darkPct>={thr['darkPctFail']}")
        mark(dark_pct >= thr["darkPctWarn"], False, f"darkPct>={thr['darkPctWarn']}")
    if gdom is not None:
        abs_fail = thr.get("absGdomFail")
        if abs_fail is not None:
            mark(abs(gdom) >= abs_fail, True, f"abs(gdom)>={abs_fail}")
        mark(abs(gdom) >= thr["absGdomWarn"], False, f"abs(gdom)>={thr['absGdomWarn']}")
    mark(protect_ratio >= thr["protectedCoreDiffFail"], True, f"protectedCoreDiff>={thr['protectedCoreDiffFail']}")
    mark(protect_ratio > thr["protectedCoreDiffWarn"], False, f"protectedCoreDiff>{thr['protectedCoreDiffWarn']}")

    worst = seam.get("worst") or {}
    mark(worst.get("lumaDelta", 0) >= thr["seamLumaDeltaFail"], True, "seamLumaDeltaFail")
    mark(worst.get("lumaDelta", 0) >= thr["seamLumaDeltaWarn"], False, "seamLumaDeltaWarn")
    mark(worst.get("rgbDelta", 0) >= thr["seamRgbDeltaFail"], True, "seamRgbDeltaFail")
    mark(worst.get("rgbDelta", 0) >= thr["seamRgbDeltaWarn"], False, "seamRgbDeltaWarn")
    mark(worst.get("gradPeak", 0) >= thr["seamGradPeakFail"], True, "seamGradPeakFail")
    mark(worst.get("gradPeak", 0) >= thr["seamGradPeakWarn"], False, "seamGradPeakWarn")

    if far_dark_pct is not None:
        mark(far_dark_pct >= thr["farDarkPctFail"], True, f"farDarkPct>={thr['farDarkPctFail']}")
        mark(far_dark_pct >= thr["farDarkPctWarn"], False, f"farDarkPct>={thr['farDarkPctWarn']}")
    if rel_gdom is not None:
        mark(abs(rel_gdom) >= thr["relGdomFail"], True, f"abs(relGdom)>={thr['relGdomFail']}")
        mark(abs(rel_gdom) >= thr["relGdomWarn"], False, f"abs(relGdom)>={thr['relGdomWarn']}")
    if rel_delta_e is not None:
        mark(rel_delta_e >= thr["relDeltaEFail"], True, f"relDeltaE>={thr['relDeltaEFail']}")
        mark(rel_delta_e >= thr["relDeltaEWarn"], False, f"relDeltaE>={thr['relDeltaEWarn']}")

    if fail:
        return "METRIC_FAIL", reasons
    if warn:
        return "METRIC_WARN_PENDING_VISUAL", reasons
    return "METRIC_PASS_PENDING_VISUAL", reasons


def save_crop(
    img: Image.Image,
    box: Box,
    out_path: Path,
    meta: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    w, h = img.size
    cbox = clamp_box(box, w, h)
    if not cbox:
        return None
    crop = img.crop(cbox)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    crop.save(out_path, "PNG")
    return {
        "name": out_path.name,
        "path": str(out_path),
        "box": list(cbox),
        "size": [crop.size[0], crop.size[1]],
        "sha256": sha256_file(out_path),
        **meta,
    }


def find_result_path(case_dir: Path, direction: str) -> Path:
    preferred = case_dir / f"u1a-{direction}-result.png"
    if preferred.exists():
        return preferred
    matches = sorted(case_dir.glob("*-result.png"))
    if matches:
        return matches[0]
    raise FileNotFoundError(f"no result png in {case_dir}")


def find_base_path(case_dir: Path, req: Dict[str, Any]) -> Path:
    name = req.get("image")
    if name and (case_dir / name).exists():
        return case_dir / name
    matches = sorted(case_dir.glob("*-base-*.png"))
    if matches:
        return matches[0]
    raise FileNotFoundError(f"no base png in {case_dir}")


def build_crops(result: Image.Image, geo: Geometry, crop_dir: Path) -> List[Dict[str, Any]]:
    crops: List[Dict[str, Any]] = []
    # seam
    for name, box in seam_band_boxes(geo).items():
        meta = save_crop(result, box, crop_dir / f"{name}.png", {"kind": "seam", "lossless": True})
        if meta:
            crops.append(meta)
    # extension
    for name, box in extension_boxes(geo).items():
        meta = save_crop(result, box, crop_dir / f"{name}.png", {"kind": "extension", "lossless": True})
        if meta:
            crops.append(meta)
    # far extension
    for name, box in far_extension_boxes(geo).items():
        meta = save_crop(result, box, crop_dir / f"{name}.png", {"kind": "far_extension", "lossless": True})
        if meta:
            crops.append(meta)
    # outward corners always useful; also for other dirs as optional diagnostics
    for name, box in corner_boxes(geo).items():
        if geo.direction != "outward" and name not in ("corner_tl", "corner_tr"):
            # keep cost down for unidirectional: only top corners for up, etc.
            if geo.direction == "up" and name not in ("corner_tl", "corner_tr"):
                continue
            if geo.direction == "down" and name not in ("corner_bl", "corner_br"):
                continue
            if geo.direction == "left" and name not in ("corner_tl", "corner_bl"):
                continue
            if geo.direction == "right" and name not in ("corner_tr", "corner_br"):
                continue
        meta = save_crop(result, box, crop_dir / f"{name}.png", {"kind": "corner", "lossless": True})
        if meta:
            crops.append(meta)
    # full overview small is optional; keep one downscaled overview as PNG for convenience
    overview = result.copy()
    overview.thumbnail((1024, 1024))
    overview_path = crop_dir / "overview.png"
    overview.save(overview_path, "PNG")
    crops.append(
        {
            "name": overview_path.name,
            "path": str(overview_path),
            "box": [0, 0, result.size[0], result.size[1]],
            "size": [overview.size[0], overview.size[1]],
            "sha256": sha256_file(overview_path),
            "kind": "overview",
            "lossless": True,
            "downscaled": True,
        }
    )
    return crops


def aggregate_extension_stats(result: Image.Image, geo: Geometry) -> Dict[str, Any]:
    boxes = extension_boxes(geo)
    if len(boxes) == 1:
        return sample_region_stats(result, next(iter(boxes.values())))
    # outward: merge samples conceptually via mean of side stats weighted by area
    stats = []
    total_area = 0
    for box in boxes.values():
        c = clamp_box(box, *result.size)
        if not c:
            continue
        st = sample_region_stats(result, c)
        area = box_area(c)
        st["_area"] = area
        stats.append(st)
        total_area += area
    if not stats:
        return {"sampleCount": 0, "meanRgb": [0, 0, 0], "gdom": 0, "darkPct": 0, "greenishPct": 0, "whiteishPct": 0}
    mean = [0.0, 0.0, 0.0]
    dark = gdom = green = white = 0.0
    samples = 0
    for st in stats:
        w = st["_area"] / max(1, total_area)
        for i in range(3):
            mean[i] += st["meanRgb"][i] * w
        dark += st["darkPct"] * w
        gdom += st["gdom"] * w
        green += st["greenishPct"] * w
        white += st["whiteishPct"] * w
        samples += st["sampleCount"]
    return {
        "sampleCount": samples,
        "meanRgb": [round(v, 2) for v in mean],
        "gdom": round(gdom, 2),
        "darkPct": round(dark, 1),
        "greenishPct": round(green, 1),
        "whiteishPct": round(white, 1),
        "sides": {k: sample_region_stats(result, v) for k, v in boxes.items() if clamp_box(v, *result.size)},
    }


def aggregate_far_dark(result: Image.Image, geo: Geometry) -> Dict[str, Any]:
    boxes = far_extension_boxes(geo)
    stats = []
    for name, box in boxes.items():
        c = clamp_box(box, *result.size)
        if not c:
            continue
        st = sample_region_stats(result, c)
        st["name"] = name
        stats.append(st)
    if not stats:
        return {"farDarkPct": 0.0, "regions": []}
    # worst (max) far dark is more diagnostic than average
    worst = max(stats, key=lambda s: s["darkPct"])
    avg = sum(s["darkPct"] for s in stats) / len(stats)
    return {
        "farDarkPct": round(worst["darkPct"], 1),
        "farDarkPctAvg": round(avg, 1),
        "worstRegion": worst["name"],
        "regions": stats,
    }


def relative_color_metrics(result: Image.Image, geo: Geometry) -> Dict[str, Any]:
    src_box = clamp_box(adjacent_source_band(geo), *result.size)
    gen_box = clamp_box(adjacent_gen_band(geo), *result.size)
    if not src_box or not gen_box:
        return {"relGdom": 0.0, "relDeltaE": 0.0}
    src = sample_region_stats(result, src_box)
    gen = sample_region_stats(result, gen_box)
    rel_gdom = gen["gdom"] - src["gdom"]
    rel_de = approx_delta_e(gen["meanRgb"], src["meanRgb"])
    return {
        "sourceBand": src,
        "generatedBand": gen,
        "relGdom": round(rel_gdom, 2),
        "relDeltaE": round(rel_de, 2),
    }


def auto_findings(
    *,
    direction: str,
    metrics: Dict[str, Any],
    crops: List[Dict[str, Any]],
    thr: Dict[str, float],
) -> List[Dict[str, Any]]:
    findings: List[Dict[str, Any]] = []
    crop_by_kind = {}
    for c in crops:
        crop_by_kind.setdefault(c.get("kind"), []).append(c)

    def add(label: str, severity: str, region: Any, crop: Optional[Dict[str, Any]], note: str, evaluator: str) -> None:
        findings.append(
            {
                "label": label,
                "severity": severity,
                "region": region,
                "cropPath": crop.get("path") if crop else None,
                "cropName": crop.get("name") if crop else None,
                "evaluator": evaluator,
                "confidence": 1.0 if evaluator.startswith("metric") else 0.5,
                "note": note,
                "humanReviewRequired": not evaluator.startswith("metric"),
            }
        )

    protect = metrics["protectedCoreDiff"]["ratio"]
    if protect >= thr["protectedCoreDiffFail"]:
        add("protect_violation", "FAIL", metrics["protectedCoreDiff"]["box"], None, f"core diff ratio {protect}", "metric.protectedCoreDiff")
    elif protect > thr["protectedCoreDiffWarn"]:
        add("protect_violation", "WARN", metrics["protectedCoreDiff"]["box"], None, f"core diff ratio {protect}", "metric.protectedCoreDiff")

    seam_crop = (crop_by_kind.get("seam") or [None])[0]
    worst = metrics["seamContinuity"]["worst"]
    if (
        worst["lumaDelta"] >= thr["seamLumaDeltaFail"]
        or worst["rgbDelta"] >= thr["seamRgbDeltaFail"]
        or worst["gradPeak"] >= thr["seamGradPeakFail"]
    ):
        add(
            "hard_seam",
            "FAIL",
            worst,
            seam_crop,
            f"worst={worst['name']} luma={worst['lumaDelta']} rgb={worst['rgbDelta']} grad={worst['gradPeak']}",
            "metric.seamContinuity",
        )
    elif (
        worst["lumaDelta"] >= thr["seamLumaDeltaWarn"]
        or worst["rgbDelta"] >= thr["seamRgbDeltaWarn"]
        or worst["gradPeak"] >= thr["seamGradPeakWarn"]
    ):
        add(
            "hard_seam",
            "WARN",
            worst,
            seam_crop,
            f"worst={worst['name']} luma={worst['lumaDelta']} rgb={worst['rgbDelta']} grad={worst['gradPeak']}",
            "metric.seamContinuity",
        )

    far = metrics["voidDarkSpatial"]
    far_crop = (crop_by_kind.get("far_extension") or crop_by_kind.get("extension") or [None])[0]
    if far["farDarkPct"] >= thr["farDarkPctFail"]:
        add("void_dark", "FAIL", far, far_crop, f"farDarkPct={far['farDarkPct']} region={far.get('worstRegion')}", "metric.voidDarkSpatial")
    elif far["farDarkPct"] >= thr["farDarkPctWarn"]:
        add("void_dark", "WARN", far, far_crop, f"farDarkPct={far['farDarkPct']} region={far.get('worstRegion')}", "metric.voidDarkSpatial")

    rel = metrics["relativeColor"]
    if abs(rel["relGdom"]) >= thr["relGdomFail"] or rel["relDeltaE"] >= thr["relDeltaEFail"]:
        add(
            "green_cast",
            "FAIL",
            rel,
            (crop_by_kind.get("extension") or [None])[0],
            f"relGdom={rel['relGdom']} relDeltaE={rel['relDeltaE']}",
            "metric.relativeColor",
        )
    elif abs(rel["relGdom"]) >= thr["relGdomWarn"] or rel["relDeltaE"] >= thr["relDeltaEWarn"]:
        add(
            "green_cast",
            "WARN",
            rel,
            (crop_by_kind.get("extension") or [None])[0],
            f"relGdom={rel['relGdom']} relDeltaE={rel['relDeltaE']}",
            "metric.relativeColor",
        )

    # Labels that still need human/VLM review are listed as placeholders only when metric stage is not FAIL-closed.
    for label in ("second_subject", "camera_prop", "anatomy_break", "identity_drift", "bg_incoherent"):
        findings.append(
            {
                "label": label,
                "severity": "PENDING_VISUAL",
                "region": None,
                "cropPath": None,
                "cropName": None,
                "evaluator": "human_or_vlm",
                "confidence": 0.0,
                "note": "No automatic detector in U1-QA v1; must be filled by visual reader with region+crop.",
                "humanReviewRequired": True,
            }
        )
    return findings


def analyze_case(
    case_dir: Path,
    *,
    threshold_path: Path,
    round_id: int = 0,
    parent_run_id: Optional[str] = None,
) -> Dict[str, Any]:
    case_dir = case_dir.resolve()
    req_path = case_dir / "request.json"
    if not req_path.exists():
        raise FileNotFoundError(f"missing request.json in {case_dir}")
    req = load_json(req_path)
    geo = Geometry.from_request(req)
    direction = geo.direction

    profile = load_thresholds(threshold_path)
    thr = thr_for(direction, profile)

    result_path = find_result_path(case_dir, direction)
    base_path = find_base_path(case_dir, req)
    result = Image.open(result_path).convert("RGB")
    base = Image.open(base_path).convert("RGB")
    if result.size != (geo.target_w, geo.target_h):
        # still analyze actual pixels, but record mismatch
        size_mismatch = {"expected": [geo.target_w, geo.target_h], "actual": list(result.size)}
    else:
        size_mismatch = None

    crop_dir = case_dir / "qa-crops"
    crops = build_crops(result, geo, crop_dir)

    protect = protected_core_diff(base, result, geo)
    ext = aggregate_extension_stats(result, geo)
    far = aggregate_far_dark(result, geo)
    rel = relative_color_metrics(result, geo)
    seam = seam_continuity_metrics(result, geo)

    provisional, reasons = level_from_thresholds(
        dark_pct=ext.get("darkPct"),
        gdom=ext.get("gdom"),
        protect_ratio=protect["ratio"],
        seam=seam,
        far_dark_pct=far.get("farDarkPct"),
        rel_gdom=rel.get("relGdom"),
        rel_delta_e=rel.get("relDeltaE"),
        thr=thr,
    )

    receipt = {}
    if (case_dir / "execution-receipt.json").exists():
        receipt = load_json(case_dir / "execution-receipt.json")
    old_metrics = {}
    if (case_dir / "metrics.json").exists():
        old_metrics = load_json(case_dir / "metrics.json")

    run_id = f"u1qa-{direction}-r{round_id}-{int(time.time())}"
    metrics = {
        "schemaVersion": SCHEMA_VERSION,
        "qaProfileVersion": QA_PROFILE_VERSION,
        "thresholdProfileVersion": profile.get("thresholdProfileVersion"),
        "generatorVersion": GENERATOR_VERSION,
        "direction": direction,
        "denoise": (req.get("extra") or {}).get("denoise"),
        "seam": geo.seam,
        "size": f"{result.size[0]}x{result.size[1]}",
        "geometry": {
            "targetWidth": geo.target_w,
            "targetHeight": geo.target_h,
            "extensionPixels": geo.extension_pixels,
            "seamOverlapPixels": geo.seam,
            "sourceOffsetX": geo.sx,
            "sourceOffsetY": geo.sy,
            "sourceDrawWidth": geo.sw,
            "sourceDrawHeight": geo.sh,
        },
        "sizeMismatch": size_mismatch,
        "protectedCoreDiff": protect,
        # legacy aliases for summary compatibility
        "protectedRegionDiff": {
            "differentPixels": protect["differentPixels"],
            "totalPixels": protect["totalPixels"],
            "ratio": protect["ratio"],
        },
        "generatedRegionMeanRgb": ext.get("meanRgb"),
        "generatedRegionGreenDominance": ext.get("gdom"),
        "generatedRegionGreenishPct": ext.get("greenishPct"),
        "generatedRegionWhiteishPct": ext.get("whiteishPct"),
        "generatedRegionDarkPct": ext.get("darkPct"),
        "extensionStats": ext,
        "voidDarkSpatial": far,
        "relativeColor": rel,
        "seamContinuity": seam,
        "sha256": sha256_file(result_path),
        "sourcePromptId": old_metrics.get("sourcePromptId")
        or (receipt.get("actual") or {}).get("promptId"),
        "windowsOutput": old_metrics.get("windowsOutput"),
        "recoveredFromServer": old_metrics.get("recoveredFromServer"),
        "provisional": provisional,
        "provisionalReasons": reasons,
        "seed": (req.get("extra") or {}).get("seed"),
        "resultPath": str(result_path),
        "basePath": str(base_path),
        "resultSha256": sha256_file(result_path),
        "baseSha256": sha256_file(base_path),
        "requestSha256": sha256_file(req_path),
    }

    findings = auto_findings(direction=direction, metrics=metrics, crops=crops, thr=thr)
    deterministic = provisional
    # visual pending unless all pending visual labels resolved (they aren't in v1 auto)
    visual_verdict = "PENDING_VISUAL"
    human_verdict = None
    final = "NEEDS_VISUAL" if provisional != "METRIC_FAIL" else "METRIC_FAIL_OPEN_REPAIR"

    qa_report = {
        "schemaVersion": SCHEMA_VERSION,
        "qaProfileVersion": QA_PROFILE_VERSION,
        "thresholdProfileVersion": profile.get("thresholdProfileVersion"),
        "generatorVersion": GENERATOR_VERSION,
        "runId": run_id,
        "direction": direction,
        "round": round_id,
        "parentRunId": parent_run_id,
        "caseDir": str(case_dir),
        "sourceSha256": metrics["baseSha256"],
        "resultSha256": metrics["resultSha256"],
        "requestSha256": metrics["requestSha256"],
        "seed": metrics["seed"],
        "promptId": metrics["sourcePromptId"],
        "workflowHash": (receipt.get("actual") or {}).get("workflowHash"),
        "operationProfile": (receipt.get("actual") or {}).get("operationProfile"),
        "actualAssets": (receipt.get("actual") or {}).get("assetVersions"),
        "recoveredFromServer": metrics.get("recoveredFromServer"),
        "readerModel": None,
        "readerPromptVersion": None,
        "evaluatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "metrics": {
            "provisional": provisional,
            "provisionalReasons": reasons,
            "protectedCoreDiffRatio": protect["ratio"],
            "darkPct": ext.get("darkPct"),
            "gdom": ext.get("gdom"),
            "whitePct": ext.get("whiteishPct"),
            "farDarkPct": far.get("farDarkPct"),
            "relGdom": rel.get("relGdom"),
            "relDeltaE": rel.get("relDeltaE"),
            "seamWorst": seam.get("worst"),
        },
        "thresholds": thr,
        "crops": crops,
        "findings": findings,
        "deterministicVerdict": deterministic,
        "visualVerdict": visual_verdict,
        "humanVerdict": human_verdict,
        "finalDisposition": final,
        "notes": [
            "Auto metric findings only for protect/hard_seam/void_dark/green_cast.",
            "second_subject/camera_prop/anatomy_break/identity_drift/bg_incoherent require human or VLM with region+crop.",
            "METRIC_PASS is coarse filter only; never product acceptance.",
        ],
    }

    # write outputs
    write_json(case_dir / "metrics.qa.json", metrics)
    write_json(case_dir / "qa-report.json", qa_report)
    # also refresh metrics.json with QA fields while preserving old keys
    merged = dict(old_metrics)
    merged.update(
        {
            "direction": direction,
            "denoise": metrics["denoise"],
            "seam": metrics["seam"],
            "size": metrics["size"],
            "protectedRegionDiff": metrics["protectedRegionDiff"],
            "protectedCoreDiff": protect,
            "generatedRegionMeanRgb": metrics["generatedRegionMeanRgb"],
            "generatedRegionGreenDominance": metrics["generatedRegionGreenDominance"],
            "generatedRegionGreenishPct": metrics["generatedRegionGreenishPct"],
            "generatedRegionWhiteishPct": metrics["generatedRegionWhiteishPct"],
            "generatedRegionDarkPct": metrics["generatedRegionDarkPct"],
            "voidDarkSpatial": far,
            "relativeColor": rel,
            "seamContinuity": seam,
            "sha256": metrics["sha256"],
            "provisional": provisional,
            "provisionalReasons": reasons,
            "qaReportPath": str(case_dir / "qa-report.json"),
            "qaCropsDir": str(crop_dir),
            "thresholdProfileVersion": profile.get("thresholdProfileVersion"),
            "generatorVersion": GENERATOR_VERSION,
        }
    )
    write_json(case_dir / "metrics.json", merged)
    return qa_report


def analyze_matrix(matrix_root: Path, directions: Sequence[str], threshold_path: Path) -> Dict[str, Any]:
    reports = []
    for d in directions:
        case_dir = matrix_root / f"u1a-{d}"
        if not case_dir.exists():
            raise FileNotFoundError(case_dir)
        print(f"[u1-qa] analyzing {d} ...", flush=True)
        reports.append(analyze_case(case_dir, threshold_path=threshold_path))

    matrix = []
    for r in reports:
        m = r["metrics"]
        matrix.append(
            {
                "direction": r["direction"],
                "provisional": m["provisional"],
                "provisionalReasons": m["provisionalReasons"],
                "darkPct": m["darkPct"],
                "gdom": m["gdom"],
                "farDarkPct": m["farDarkPct"],
                "relGdom": m["relGdom"],
                "relDeltaE": m["relDeltaE"],
                "protectedCoreDiffRatio": m["protectedCoreDiffRatio"],
                "seamWorst": m["seamWorst"],
                "promptId": r.get("promptId"),
                "finalDisposition": r["finalDisposition"],
                "qaReport": str(Path(r["caseDir"]) / "qa-report.json"),
            }
        )

    summary = {
        "stage": "U1-QA",
        "schemaVersion": SCHEMA_VERSION,
        "qaProfileVersion": QA_PROFILE_VERSION,
        "generatorVersion": GENERATOR_VERSION,
        "thresholdProfile": str(threshold_path),
        "matrixRoot": str(matrix_root.resolve()),
        "finishedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "matrix": matrix,
        "reports": [
            {
                "direction": r["direction"],
                "runId": r["runId"],
                "deterministicVerdict": r["deterministicVerdict"],
                "finalDisposition": r["finalDisposition"],
                "findingsAuto": [f for f in r["findings"] if f["severity"] in ("FAIL", "WARN")],
            }
            for r in reports
        ],
        "note": (
            "U1-QA v1 deterministic gate only. BOSS/visual labels still pending. "
            "Do not treat METRIC_PASS as product acceptance."
        ),
    }
    out = matrix_root / "u1-qa-summary.json"
    write_json(out, summary)
    print(f"[u1-qa] summary -> {out}", flush=True)
    return summary


def main(argv: Optional[Sequence[str]] = None) -> int:
    p = argparse.ArgumentParser(description="U1-QA metrics/crops/qa-report runner")
    p.add_argument("--case-dir", type=Path, help="Single case directory (u1a-down, ...)")
    p.add_argument("--matrix-root", type=Path, help="Root containing u1a-{dir}/ folders")
    p.add_argument("--directions", default=",".join(DIRS_DEFAULT), help="Comma-separated directions")
    p.add_argument("--thresholds", type=Path, default=DEFAULT_THRESHOLD_PATH)
    p.add_argument("--round", type=int, default=0)
    args = p.parse_args(argv)

    if not args.case_dir and not args.matrix_root:
        p.error("provide --case-dir or --matrix-root")

    if args.case_dir:
        report = analyze_case(args.case_dir, threshold_path=args.thresholds, round_id=args.round)
        print(json.dumps({
            "direction": report["direction"],
            "deterministicVerdict": report["deterministicVerdict"],
            "finalDisposition": report["finalDisposition"],
            "metrics": report["metrics"],
            "autoFindings": [f for f in report["findings"] if f["severity"] in ("FAIL", "WARN")],
        }, ensure_ascii=False, indent=2))
        return 0

    dirs = [d.strip() for d in args.directions.split(",") if d.strip()]
    summary = analyze_matrix(args.matrix_root, dirs, args.thresholds)
    print(json.dumps(summary["matrix"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
