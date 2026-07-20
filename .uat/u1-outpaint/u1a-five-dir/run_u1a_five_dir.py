#!/usr/bin/env python3
"""U1-A five-direction outpaint UAT runner (extend mode).

Prepares base/mask offline (Pillow port of canvas-outpaint-data soft seam + clothpad),
submits /v1/images/edits, writes receipt + metrics per direction.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat

ROOT = Path(__file__).resolve().parent
UAT = ROOT.parent
BASELINE = UAT / "baseline" / "u1-character-baseline.png"
ENDPOINT = "http://127.0.0.1:8080/v1/images/edits"
MODEL = "comfy/illustrious-mmmix-v8"
SEED = 424242
LORA_KEYS = [
    "illustrious-masterpiece-v3",
    "bss-detail-enhancer-v3",
    "bss-visual-enhancer-v3",
    "bss-skin-texture-v2",
    "eyes-for-illustrious",
    "dramatic-lighting-slider",
]

# U1 product defaults
EXTENSION_RATIO = 0.625
DEFAULT_SEAM = {
    "down": 96,
    "up": 112,
    "left": 112,
    "right": 112,
    "outward": 104,
}
DEFAULT_DENOISE = {
    "down": 0.60,
    "left": 0.70,
    "right": 0.70,
    "up": 0.78,
    "outward": 0.78,
}
PROMPTS = {
    "outward": (
        "seamless outward continuation on all sides, preserve the original character and composition, "
        "keep subject position fixed, naturally expand background and edges around the source image, "
        "consistent lighting, fabric, anatomy, perspective and color"
    ),
    "up": (
        "seamless upward continuation, preserve the original character and composition, "
        "naturally continue only the background scene, walls, ceiling, sky and architecture above the source image, "
        "clean background only above the head, no hands, no arms, consistent lighting, perspective and color"
    ),
    "left": (
        "seamless leftward continuation, preserve the original character and composition, "
        "naturally continue body and background to the left of the source image, "
        "consistent lighting, fabric, anatomy, perspective and color"
    ),
    "right": (
        "seamless rightward continuation, preserve the original character and composition, "
        "naturally continue body and background to the right of the source image, "
        "consistent lighting, fabric, anatomy, perspective and color"
    ),
    "down": (
        "same close-up portrait continuation, preserve the white sleeveless top, "
        "continue only the visible upper torso and warm blurred background below the source image, "
        "same fabric and color, arms outside the frame, no hands visible, no outfit change, no corset, no lacing"
    ),
}

DIRS = ["up", "down", "left", "right", "outward"]


def clamp(v, lo, hi):
    return min(hi, max(lo, v))


def round_up(v, step):
    return int(math.ceil(v / step) * step)


def edge_band_pixels(source_dim, extension_pixels):
    base = min(128, max(64, round(source_dim * 0.12)))
    by_ext = min(160, max(64, round(extension_pixels * 0.28)))
    return min(source_dim, max(base, by_ext))


def near_edge_structure_pixels(seam, pad_w, pad_h):
    pad_span = max(1, min(pad_w, pad_h))
    return min(pad_span, max(24, round(seam)))


def compute_robust_mean_rgb(pixels, exclude_green_dominance=18, max_samples=4000):
    # pixels: list of (r,g,b)
    if not pixels:
        return (128, 128, 128)
    step = max(1, len(pixels) // max_samples)
    samples = pixels[::step]
    filtered = [p for p in samples if p[1] - (p[0] + p[2]) / 2 < exclude_green_dominance]
    min_keep = min(3, len(samples))
    use = filtered if len(filtered) >= max(min_keep, int(len(samples) * 0.15)) else samples
    n = len(use)
    sr = sum(p[0] for p in use) / n
    sg = sum(p[1] for p in use) / n
    sb = sum(p[2] for p in use) / n
    return (int(round(sr)), int(round(sg)), int(round(sb)))


def sample_mean(src: Image.Image, sx, sy, sw, sh, prefer_center_x=False):
    w, h = src.size
    sx = max(0, int(sx))
    sy = max(0, int(sy))
    sw = max(1, int(sw))
    sh = max(1, int(sh))
    if prefer_center_x:
        sw = max(8, int(round(w * 0.5)))
        sx = max(0, int(round((w - sw) / 2)))
    sw = min(sw, w - sx)
    sh = min(sh, h - sy)
    if sw <= 0 or sh <= 0:
        return (128, 128, 128)
    crop = src.crop((sx, sy, sx + sw, sy + sh)).resize(
        (min(64, max(8, sw)), min(48, max(8, sh))), Image.Resampling.BILINEAR
    )
    px = list(crop.getdata())
    return compute_robust_mean_rgb(px)


def geometry_for(src_w, src_h, direction, seam, ratio=EXTENSION_RATIO):
    mode = "extend"
    seam = int(round(clamp(seam, 16, min(192, max(16, min(src_w, src_h) / 3)))))
    if direction == "outward":
        r = clamp(ratio, 0.2, 1.5)
        total_ext_w = max(128, round(src_w * r))
        total_ext_h = max(128, round(src_h * r))
        target_w = min(2560, round_up(src_w + total_ext_w, 64))
        target_h = min(2560, round_up(src_h + total_ext_h, 64))
        total_ext_w = target_w - src_w
        total_ext_h = target_h - src_h
        return {
            "mode": mode,
            "direction": direction,
            "sourceWidth": src_w,
            "sourceHeight": src_h,
            "targetWidth": target_w,
            "targetHeight": target_h,
            "extensionPixels": total_ext_w + total_ext_h,
            "seamOverlapPixels": seam,
            "sourceScale": 1,
            "sourceOffsetX": total_ext_w // 2,
            "sourceOffsetY": total_ext_h // 2,
            "sourceDrawWidth": src_w,
            "sourceDrawHeight": src_h,
        }
    if direction in ("left", "right"):
        requested = max(64, round(src_w * clamp(ratio, 0.2, 1.5)))
        target_w = min(2560, round_up(src_w + requested, 64))
        ext = target_w - src_w
        return {
            "mode": mode,
            "direction": direction,
            "sourceWidth": src_w,
            "sourceHeight": src_h,
            "targetWidth": target_w,
            "targetHeight": src_h,
            "extensionPixels": ext,
            "seamOverlapPixels": seam,
            "sourceScale": 1,
            "sourceOffsetX": ext if direction == "left" else 0,
            "sourceOffsetY": 0,
            "sourceDrawWidth": src_w,
            "sourceDrawHeight": src_h,
        }
    # up / down
    requested = max(64, round(src_h * clamp(ratio, 0.2, 1.5)))
    target_h = min(2560, round_up(src_h + requested, 64))
    ext = target_h - src_h
    return {
        "mode": mode,
        "direction": direction,
        "sourceWidth": src_w,
        "sourceHeight": src_h,
        "targetWidth": src_w,
        "targetHeight": target_h,
        "extensionPixels": ext,
        "seamOverlapPixels": seam,
        "sourceScale": 1,
        "sourceOffsetX": 0,
        "sourceOffsetY": ext if direction == "up" else 0,
        "sourceDrawWidth": src_w,
        "sourceDrawHeight": src_h,
    }


def paste_blurred(src, box_src, base, box_dst, blur):
    sx, sy, sw, sh = box_src
    dx, dy, dw, dh = box_dst
    if dw <= 0 or dh <= 0 or sw <= 0 or sh <= 0:
        return
    crop = src.crop((sx, sy, sx + sw, sy + sh)).resize((dw, dh), Image.Resampling.BILINEAR)
    if blur > 0:
        # approximate canvas blur
        r = max(1, int(round(blur)))
        crop = crop.filter(ImageFilter.GaussianBlur(radius=r))
    base.paste(crop, (dx, dy))


def paint_edge_pad(src, g, base, sx, sy, sw, sh, dx, dy, dw, dh, near_blur, far_blur):
    if dw <= 0 or dh <= 0 or sw <= 0 or sh <= 0:
        return
    paste_blurred(src, (sx, sy, sw, sh), base, (dx, dy, dw, dh), far_blur)
    near_keep = near_edge_structure_pixels(g["seamOverlapPixels"], dw, dh)
    if dh >= dw:
        if g["direction"] == "up" or (g["direction"] == "outward" and dy + dh <= g["sourceOffsetY"] + 1):
            paste_blurred(src, (sx, sy, sw, sh), base, (dx, dy + dh - near_keep, dw, near_keep), near_blur)
        elif g["direction"] == "down" or (g["direction"] == "outward" and dy >= g["sourceOffsetY"] + g["sourceDrawHeight"] - 1):
            paste_blurred(src, (sx, sy, sw, sh), base, (dx, dy, dw, near_keep), near_blur)
        else:
            paste_blurred(src, (sx, sy, sw, sh), base, (dx, dy, dw, dh), near_blur)
    else:
        if g["direction"] == "left" or (g["direction"] == "outward" and dx + dw <= g["sourceOffsetX"] + 1):
            paste_blurred(src, (sx, sy, sw, sh), base, (dx + dw - near_keep, dy, near_keep, dh), near_blur)
        elif g["direction"] == "right" or (g["direction"] == "outward" and dx >= g["sourceOffsetX"] + g["sourceDrawWidth"] - 1):
            paste_blurred(src, (sx, sy, sw, sh), base, (dx, dy, near_keep, dh), near_blur)
        else:
            paste_blurred(src, (sx, sy, sw, sh), base, (dx, dy, dw, dh), near_blur)


def fade_to_mean(base: Image.Image, x, y, w, h, fade_dir, rgb, structure_keep):
    if w <= 0 or h <= 0:
        return
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    span = h if fade_dir in ("up", "down") else w
    keep = clamp(structure_keep if structure_keep > 0 else 0.2, 0.12, 0.72)
    steps = max(8, min(64, span))
    for i in range(steps):
        t = i / max(1, steps - 1)
        # alpha ramp matching canvas stops roughly
        if t <= keep:
            a = 0
        elif t <= min(1.0, keep + 0.22):
            a = int(0.55 * 255 * ((t - keep) / 0.22))
        else:
            a = int(0.55 * 255 + 0.45 * 255 * ((t - min(1.0, keep + 0.22)) / max(1e-6, 1 - min(1.0, keep + 0.22))))
            a = min(255, a)
        if a <= 0:
            continue
        if fade_dir == "down":
            yy = int(round(t * (h - 1)))
            draw.line([(0, yy), (w - 1, yy)], fill=(*rgb, a))
        elif fade_dir == "up":
            yy = int(round((1 - t) * (h - 1)))
            draw.line([(0, yy), (w - 1, yy)], fill=(*rgb, a))
        elif fade_dir == "right":
            xx = int(round(t * (w - 1)))
            draw.line([(xx, 0), (xx, h - 1)], fill=(*rgb, a))
        else:  # left
            xx = int(round((1 - t) * (w - 1)))
            draw.line([(xx, 0), (xx, h - 1)], fill=(*rgb, a))
    # slight blur to soften banding
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=1.2))
    region = base.crop((x, y, x + w, y + h)).convert("RGBA")
    region = Image.alpha_composite(region, overlay)
    base.paste(region.convert("RGB"), (x, y))


def prepare_extend(src: Image.Image, direction: str, seam: int):
    src = src.convert("RGB")
    sw0, sh0 = src.size
    g = geometry_for(sw0, sh0, direction, seam)
    tw, th = g["targetWidth"], g["targetHeight"]
    base = Image.new("RGB", (tw, th), (128, 128, 128))
    base.paste(src, (g["sourceOffsetX"], g["sourceOffsetY"]))

    band_h = edge_band_pixels(g["sourceHeight"], g["sourceOffsetY"] if direction == "outward" else g["extensionPixels"])
    band_w = edge_band_pixels(g["sourceWidth"], g["sourceOffsetX"] if direction == "outward" else g["extensionPixels"])
    near_blur = 10 if direction == "up" else 12
    far_blur = 28 if direction == "up" else 24

    if direction == "outward":
        top = g["sourceOffsetY"]
        left = g["sourceOffsetX"]
        right = tw - left - g["sourceDrawWidth"]
        bottom = th - top - g["sourceDrawHeight"]
        if top > 0:
            paint_edge_pad(src, g, base, 0, 0, sw0, band_h, 0, 0, tw, top, near_blur, far_blur)
        if bottom > 0:
            paint_edge_pad(src, g, base, 0, sh0 - band_h, sw0, band_h, 0, top + g["sourceDrawHeight"], tw, bottom, near_blur, far_blur)
        if left > 0:
            paint_edge_pad(src, g, base, 0, 0, band_w, sh0, 0, top, left, g["sourceDrawHeight"], near_blur, far_blur)
        if right > 0:
            paint_edge_pad(src, g, base, sw0 - band_w, 0, band_w, sh0, left + g["sourceDrawWidth"], top, right, g["sourceDrawHeight"], near_blur, far_blur)
    elif direction == "down":
        center_w = max(8, round(sw0 * 0.5))
        center_x = max(0, round((sw0 - center_w) / 2))
        cloth_band_h = max(24, min(band_h, round(sh0 * 0.18)))
        cloth_band_y = max(0, min(sh0 - cloth_band_h, round(sh0 * 0.62) - cloth_band_h // 2))
        paint_edge_pad(
            src, g, base,
            center_x, cloth_band_y, center_w, cloth_band_h,
            0, g["sourceOffsetY"] + g["sourceDrawHeight"], tw, g["extensionPixels"],
            near_blur, far_blur,
        )
    elif direction == "up":
        paint_edge_pad(src, g, base, 0, 0, sw0, band_h, 0, 0, tw, g["extensionPixels"], near_blur, far_blur)
    elif direction == "right":
        paint_edge_pad(src, g, base, sw0 - band_w, 0, band_w, sh0, g["sourceOffsetX"] + g["sourceDrawWidth"], 0, g["extensionPixels"], th, near_blur, far_blur)
    else:  # left
        paint_edge_pad(src, g, base, 0, 0, band_w, sh0, 0, 0, g["extensionPixels"], th, near_blur, far_blur)

    structure_keep = (
        clamp(g["seamOverlapPixels"] / max(1, g["extensionPixels"] or 1), 0.08, 0.18)
        if direction == "down"
        else clamp(g["seamOverlapPixels"] / max(1, g["extensionPixels"] or 1), 0.18, 0.55)
    )
    if direction == "outward":
        top = g["sourceOffsetY"]
        left = g["sourceOffsetX"]
        right = tw - left - g["sourceDrawWidth"]
        bottom = th - top - g["sourceDrawHeight"]
        if top > 0:
            fade_to_mean(base, 0, 0, tw, top, "up", sample_mean(src, 0, 0, sw0, band_h), structure_keep)
        if bottom > 0:
            fade_to_mean(base, 0, top + g["sourceDrawHeight"], tw, bottom, "down", sample_mean(src, 0, sh0 - band_h, sw0, band_h), structure_keep)
        if left > 0:
            fade_to_mean(base, 0, top, left, g["sourceDrawHeight"], "left", sample_mean(src, 0, 0, band_w, sh0), structure_keep)
        if right > 0:
            fade_to_mean(base, left + g["sourceDrawWidth"], top, right, g["sourceDrawHeight"], "right", sample_mean(src, sw0 - band_w, 0, band_w, sh0), structure_keep)
    elif direction == "down":
        cloth_band_h = max(24, round(sh0 * 0.18))
        cloth_band_y = max(0, round(sh0 * 0.62) - cloth_band_h // 2)
        fade_to_mean(
            base, 0, g["sourceOffsetY"] + g["sourceDrawHeight"], tw, g["extensionPixels"], "down",
            sample_mean(src, 0, cloth_band_y, sw0, cloth_band_h, prefer_center_x=True), structure_keep,
        )
    elif direction == "up":
        fade_to_mean(base, 0, 0, tw, g["extensionPixels"], "up", sample_mean(src, 0, 0, sw0, band_h), structure_keep)
    elif direction == "right":
        fade_to_mean(base, g["sourceOffsetX"] + g["sourceDrawWidth"], 0, g["extensionPixels"], th, "right", sample_mean(src, sw0 - band_w, 0, band_w, sh0), structure_keep)
    else:
        fade_to_mean(base, 0, 0, g["extensionPixels"], th, "left", sample_mean(src, 0, 0, band_w, sh0), structure_keep)

    # mask: RGBA — protect alpha=255 white, redraw alpha=0
    mask = Image.new("RGBA", (tw, th), (255, 255, 255, 255))
    md = ImageDraw.Draw(mask)
    seam = g["seamOverlapPixels"]

    def clear_ext_and_soft_seam(ext_x, ext_y, ext_w, ext_h, seam_dir):
        if ext_w > 0 and ext_h > 0:
            md.rectangle([ext_x, ext_y, ext_x + ext_w - 1, ext_y + ext_h - 1], fill=(255, 255, 255, 0))
        if seam <= 0:
            return
        if seam_dir == "up":
            rx, ry, rw, rh = ext_x, ext_y + ext_h, ext_w, seam
            # alpha: near extension more redraw (low a), deep source high a
            for i in range(rh):
                t = i / max(1, rh - 1)  # 0 at ext side
                # destination-out ramp inverted: protect increases into source
                if t <= 0:
                    a = 0
                elif t < 0.45:
                    a = int(255 * (1 - (1 - t / 0.45) * 1.0))  # rough
                # better: a_protect from 0 -> 255 as t goes 0->1
                # stops: 0: erase fully (a=0), 0.45: 0.28 protect?, use linear protect
                a_protect = int(255 * t)
                # start more erased near ext
                if t < 0.22:
                    a_protect = int(255 * (t / 0.22) * 0.28)
                elif t < 0.55:
                    a_protect = int(255 * (0.28 + (t - 0.22) / 0.33 * 0.44))
                else:
                    a_protect = int(255 * (0.72 + (t - 0.55) / 0.45 * 0.28))
                a_protect = max(0, min(255, a_protect))
                md.line([(rx, ry + i), (rx + rw - 1, ry + i)], fill=(255, 255, 255, a_protect))
        elif seam_dir == "down":
            rh = min(seam, ext_y)
            rx, ry, rw = ext_x, max(0, ext_y - seam), ext_w
            for i in range(rh):
                # i=0 deep source top of seam band, i=rh-1 near extension
                t_from_ext = 1 - i / max(1, rh - 1)  # 1 at deep? wait: ry is deep source
                # near extension (bottom of band, high y) should be more redraw (low alpha)
                t = i / max(1, rh - 1)  # 0 deep, 1 near ext
                # invert: protect high at deep (t=0), low near ext (t=1)
                if t < 0.22:
                    a_protect = int(255 * (1 - t / 0.22 * 0.28))
                elif t < 0.55:
                    a_protect = int(255 * (0.72 - (t - 0.22) / 0.33 * 0.44))
                else:
                    a_protect = int(255 * (0.28 - (t - 0.55) / 0.45 * 0.28))
                a_protect = max(0, min(255, a_protect))
                md.line([(rx, ry + i), (rx + rw - 1, ry + i)], fill=(255, 255, 255, a_protect))
        elif seam_dir == "left":
            rx, ry, rw, rh = ext_x + ext_w, ext_y, seam, ext_h
            for i in range(rw):
                t = i / max(1, rw - 1)  # 0 near ext, 1 deep
                if t < 0.22:
                    a_protect = int(255 * (t / 0.22) * 0.28)
                elif t < 0.55:
                    a_protect = int(255 * (0.28 + (t - 0.22) / 0.33 * 0.44))
                else:
                    a_protect = int(255 * (0.72 + (t - 0.55) / 0.45 * 0.28))
                a_protect = max(0, min(255, a_protect))
                md.line([(rx + i, ry), (rx + i, ry + rh - 1)], fill=(255, 255, 255, a_protect))
        else:  # right: seam left of extension
            rw = min(seam, ext_x)
            rx, ry, rh = max(0, ext_x - seam), ext_y, ext_h
            for i in range(rw):
                t = i / max(1, rw - 1)  # 0 deep, 1 near ext
                if t < 0.22:
                    a_protect = int(255 * (1 - t / 0.22 * 0.28))
                elif t < 0.55:
                    a_protect = int(255 * (0.72 - (t - 0.22) / 0.33 * 0.44))
                else:
                    a_protect = int(255 * (0.28 - (t - 0.55) / 0.45 * 0.28))
                a_protect = max(0, min(255, a_protect))
                md.line([(rx + i, ry), (rx + i, ry + rh - 1)], fill=(255, 255, 255, a_protect))

    if direction == "outward":
        sx, sy = g["sourceOffsetX"], g["sourceOffsetY"]
        sw, sh = g["sourceDrawWidth"], g["sourceDrawHeight"]
        top, left = sy, sx
        right = tw - left - sw
        bottom = th - top - sh
        if top > 0:
            clear_ext_and_soft_seam(0, 0, tw, top, "up")
        if bottom > 0:
            clear_ext_and_soft_seam(0, top + sh, tw, bottom, "down")
        if left > 0:
            clear_ext_and_soft_seam(0, top, left, sh, "left")
        if right > 0:
            clear_ext_and_soft_seam(left + sw, top, right, sh, "right")
    elif direction == "down":
        clear_ext_and_soft_seam(0, g["sourceOffsetY"] + g["sourceDrawHeight"], tw, g["extensionPixels"], "down")
    elif direction == "up":
        clear_ext_and_soft_seam(0, 0, tw, g["extensionPixels"], "up")
    elif direction == "right":
        clear_ext_and_soft_seam(g["sourceOffsetX"] + g["sourceDrawWidth"], 0, g["extensionPixels"], th, "right")
    else:
        clear_ext_and_soft_seam(0, 0, g["extensionPixels"], th, "left")

    return base, mask, g


def multipart_submit(prompt, size, base_bytes, mask_bytes, base_name, mask_name, extra):
    boundary = "----CodexBoundary" + hashlib.md5(str(time.time()).encode()).hexdigest()
    parts = []

    def add(name, value, filename=None, ctype=None):
        parts.append(f"--{boundary}\r\n".encode())
        if filename:
            parts.append(f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode())
            parts.append(f"Content-Type: {ctype or 'application/octet-stream'}\r\n\r\n".encode())
            parts.append(value)
            parts.append(b"\r\n")
        else:
            parts.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
            parts.append(str(value).encode())
            parts.append(b"\r\n")

    for k, v in [
        ("prompt", prompt),
        ("model", MODEL),
        ("size", size),
        ("n", "1"),
        ("response_format", "b64_json"),
        ("output_format", "png"),
        ("extra", json.dumps(extra, ensure_ascii=False)),
    ]:
        add(k, v)
    add("image", base_bytes, base_name, "image/png")
    add("mask", mask_bytes, mask_name, "image/png")
    body = b"".join(parts) + f"--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=900) as resp:
        return resp.status, resp.read()


def metrics_for(direction, base: Image.Image, result: Image.Image, g: dict):
    sx, sy = g["sourceOffsetX"], g["sourceOffsetY"]
    sw, sh = g["sourceDrawWidth"], g["sourceDrawHeight"]
    # protected core = source minus seam intrusion
    seam = g["seamOverlapPixels"]
    if direction == "down":
        core = (0, 0, sw, max(1, sh - seam))
        gen = result.crop((0, sy + sh, g["targetWidth"], g["targetHeight"]))
        base_core = base.crop(core)
        res_core = result.crop(core)
    elif direction == "up":
        core = (0, sy + seam, sw, g["targetHeight"] - (sy + seam))  # wrong
        # source region in canvas: y=sy..sy+sh; protect deeper part excluding seam at top of source
        core_box = (sx, sy + seam, sx + sw, sy + sh)
        gen = result.crop((0, 0, g["targetWidth"], g["extensionPixels"]))
        base_core = base.crop(core_box)
        res_core = result.crop(core_box)
    elif direction == "left":
        core_box = (sx + seam, sy, sx + sw, sy + sh)
        gen = result.crop((0, 0, g["extensionPixels"], g["targetHeight"]))
        base_core = base.crop(core_box)
        res_core = result.crop(core_box)
    elif direction == "right":
        core_box = (sx, sy, sx + sw - seam, sy + sh)
        gen = result.crop((sx + sw, 0, g["targetWidth"], g["targetHeight"]))
        base_core = base.crop(core_box)
        res_core = result.crop(core_box)
    else:  # outward
        core_box = (sx + seam, sy + seam, sx + sw - seam, sy + sh - seam)
        # generated = whole minus core source interior
        gen = None
        base_core = base.crop(core_box)
        res_core = result.crop(core_box)

    diff = ImageChops.difference(base_core.convert("RGB"), res_core.convert("RGB"))
    different = sum(1 for px in diff.getdata() if px != (0, 0, 0))
    total = base_core.size[0] * base_core.size[1]
    out = {
        "protectedRegionDiff": {
            "differentPixels": different,
            "totalPixels": total,
            "ratio": round(different / max(1, total), 6),
        }
    }
    if gen is not None and gen.size[0] > 0 and gen.size[1] > 0:
        mean = ImageStat.Stat(gen).mean
        px = list(gen.getdata())
        n = max(1, len(px))
        gdom = mean[1] - (mean[0] + mean[2]) / 2
        greenish = sum(1 for p in px if p[1] - (p[0] + p[2]) / 2 > 30) / n * 100
        whiteish = sum(1 for p in px if min(p) > 160 and max(p) - min(p) < 40) / n * 100
        dark = sum(1 for p in px if (p[0] + p[1] + p[2]) / 3 < 50) / n * 100
        out.update({
            "generatedRegionMeanRgb": [round(v, 2) for v in mean],
            "generatedRegionGreenDominance": round(gdom, 2),
            "generatedRegionGreenishPct": round(greenish, 1),
            "generatedRegionWhiteishPct": round(whiteish, 1),
            "generatedRegionDarkPct": round(dark, 1),
        })
    return out


def run_one(direction: str, src: Image.Image):
    case_dir = ROOT / f"u1a-{direction}"
    case_dir.mkdir(parents=True, exist_ok=True)
    seam = DEFAULT_SEAM[direction]
    denoise = DEFAULT_DENOISE[direction]
    prompt = PROMPTS[direction]
    base, mask, g = prepare_extend(src, direction, seam)
    size = f"{g['targetWidth']}x{g['targetHeight']}"
    base_name = f"u1a-{direction}-base-{size}.png"
    mask_name = f"u1a-{direction}-mask-softseam-{seam}-{size}.png"
    base_path = case_dir / base_name
    mask_path = case_dir / mask_name
    base.save(base_path)
    mask.save(mask_path)
    extra = {
        "lora_keys": LORA_KEYS,
        "face_detailer": False,
        "denoise": denoise,
        "seam_feather": seam,
        "outpaint_direction": direction,
        "prompt_optimize": False,
        "seed": SEED,
    }
    req_meta = {
        "endpoint": ENDPOINT,
        "model": MODEL,
        "size": size,
        "prompt": prompt,
        "image": base_name,
        "mask": mask_name,
        "extra": extra,
        "geometry": g,
        "case": f"U1-A-{direction}",
    }
    (case_dir / "request.json").write_text(json.dumps(req_meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (case_dir / "started-at.txt").write_text(time.strftime("%Y-%m-%dT%H:%M:%S%z") + "\n")
    print(f"[{direction}] submitting size={size} denoise={denoise} seam={seam}", flush=True)
    t0 = time.time()
    try:
        status, raw = multipart_submit(prompt, size, base_path.read_bytes(), mask_path.read_bytes(), base_name, mask_name, extra)
    except Exception as e:
        # still may complete server-side; write error and try to continue
        (case_dir / "run.log").write_text(f"client_error: {e}\n", encoding="utf-8")
        print(f"[{direction}] client error: {e}", flush=True)
        return {"direction": direction, "ok": False, "error": str(e)}
    elapsed = round(time.time() - t0, 1)
    (case_dir / "http-status.txt").write_text(str(status) + "\n")
    (case_dir / "response.json").write_bytes(raw)
    data = json.loads(raw)
    receipt = data.get("execution_receipt")
    if receipt:
        (case_dir / "execution-receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    img_b64 = (data.get("data") or [{}])[0].get("b64_json")
    if not img_b64:
        print(f"[{direction}] no image keys={list(data)[:20]}", flush=True)
        (case_dir / "run.log").write_text(f"http={status} no image elapsed={elapsed}\n", encoding="utf-8")
        return {"direction": direction, "ok": False, "http": status, "elapsed": elapsed}
    img = base64.b64decode(img_b64)
    result_path = case_dir / f"u1a-{direction}-result.png"
    result_path.write_bytes(img)
    result = Image.open(io.BytesIO(img)).convert("RGB")
    m = metrics_for(direction, base, result, g)
    m.update({
        "direction": direction,
        "denoise": denoise,
        "seam": seam,
        "size": size,
        "elapsedSec": elapsed,
        "sha256": hashlib.sha256(img).hexdigest(),
        "sourcePromptId": (receipt or {}).get("actual", {}).get("promptId") if receipt else None,
        "mutators": (receipt or {}).get("actual", {}).get("mutators") if receipt else None,
    })
    (case_dir / "metrics.json").write_text(json.dumps(m, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (case_dir / "run.log").write_text(f"http={status} elapsed={elapsed} ok=1\n", encoding="utf-8")
    print(f"[{direction}] ok elapsed={elapsed}s metrics={json.dumps(m, ensure_ascii=False)}", flush=True)
    return {"direction": direction, "ok": True, **m}


def main():
    only = [a for a in sys.argv[1:] if a in DIRS]
    directions = only or DIRS
    src = Image.open(BASELINE)
    summary = {
        "stage": "U1-A",
        "baseline": str(BASELINE),
        "seed": SEED,
        "model": MODEL,
        "extensionRatio": EXTENSION_RATIO,
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "cases": [],
    }
    for d in directions:
        summary["cases"].append(run_one(d, src))
    summary["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    (ROOT / "u1a-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("SUMMARY", json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
