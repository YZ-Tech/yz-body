"""Image filters used by the V13 Appearance customizer.

Two operations:

- `colorize(img_bytes, hex_color, ...)` — replace each pixel's hue with
  the target's hue while preserving per-pixel luminance and saturation.
  Used for clothing, hair, and iris recoloring; sclera-style pixels
  (S≈0) stay grayscale naturally because S=0 makes hue irrelevant.

- `lab_shift(img_bytes, l_delta, a_delta, b_delta)` — shift every pixel
  in CIE L*a*b* space. Used for skin: preserves the natural color
  variation (cheeks vs forehead) by leaving relative differences
  intact, just shifting the whole distribution along the warmth /
  ethnicity axis.

Both functions take PNG/JPG bytes in, return PNG bytes out. Operate on
RGB channels; alpha (if any) is preserved untouched.
"""

from __future__ import annotations

import io
import math
from typing import Iterable

import numpy as np
from PIL import Image


# ── Skin-tone presets ─────────────────────────────────────────────────
# Each preset is an (L_delta, a_delta, b_delta) triple applied via
# lab_shift. Values chosen to span common natural skin tones without
# losing the per-pixel variation that makes faces look real.
#
# L: lightness delta. Negative = darker.
# a: red↔green axis. Positive = more red (warmer).
# b: yellow↔blue axis. Positive = more yellow.
SKIN_PRESETS: dict[str, tuple[float, float, float]] = {
    "fair":   (+12.0,  -2.0,  +2.0),
    "light":  ( +4.0,  -1.0,  +3.0),
    "medium": (  0.0,   0.0,   0.0),  # baseline — what the asset shipped with
    "olive":  ( -3.0,  -2.0,  +6.0),
    "brown":  (-14.0,  +2.0,  +5.0),
    "deep":   (-26.0,  +1.0,  +3.0),
}


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        raise ValueError(f"invalid hex color: {hex_color!r}")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _open_rgba(img_bytes: bytes) -> tuple[np.ndarray, np.ndarray | None]:
    """Decode `img_bytes` into an (RGB float32 in [0,1], alpha uint8 or
    None) pair. Alpha is split off so the filter math works on RGB only;
    we re-attach the original alpha at encode time."""
    im = Image.open(io.BytesIO(img_bytes))
    if im.mode == "P":  # palette — convert to RGBA first
        im = im.convert("RGBA")
    if im.mode == "RGBA":
        arr = np.asarray(im, dtype=np.uint8)
        rgb = arr[..., :3].astype(np.float32) / 255.0
        alpha = arr[..., 3:4]
        return rgb, alpha
    if im.mode == "L":
        gray = np.asarray(im, dtype=np.float32) / 255.0
        rgb = np.stack([gray, gray, gray], axis=-1)
        return rgb, None
    if im.mode != "RGB":
        im = im.convert("RGB")
    arr = np.asarray(im, dtype=np.uint8)
    rgb = arr.astype(np.float32) / 255.0
    return rgb, None


def _encode_png(rgb: np.ndarray, alpha: np.ndarray | None) -> bytes:
    """Encode an RGB float[0,1] array (plus optional alpha) as PNG bytes."""
    rgb8 = np.clip(rgb * 255.0 + 0.5, 0, 255).astype(np.uint8)
    if alpha is not None:
        rgba = np.concatenate([rgb8, alpha], axis=-1)
        im = Image.fromarray(rgba, mode="RGBA")
    else:
        im = Image.fromarray(rgb8, mode="RGB")
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=False)
    return buf.getvalue()


# ── HSL color space ───────────────────────────────────────────────────
# Hand-rolled vectorized RGB↔HSL — colorize is by far the most common
# call and we don't want to depend on scikit-image. Standard HSL
# formulas; H is in [0,1) (turns), S and L in [0,1].

def _rgb_to_hsl(rgb: np.ndarray) -> np.ndarray:
    """RGB[H,W,3] in [0,1] → HSL[H,W,3] in ([0,1), [0,1], [0,1])."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.max(rgb, axis=-1)
    mn = np.min(rgb, axis=-1)
    d = mx - mn
    L = (mx + mn) * 0.5
    S = np.where(d == 0, 0.0, d / (1.0 - np.abs(2.0 * L - 1.0) + 1e-12))
    # Hue per the standard piecewise formula. We compute three
    # candidates and select based on which channel is max — vectorized.
    h_r = ((g - b) / (d + 1e-12)) % 6.0
    h_g = (b - r) / (d + 1e-12) + 2.0
    h_b = (r - g) / (d + 1e-12) + 4.0
    H = np.where(mx == r, h_r, np.where(mx == g, h_g, h_b)) / 6.0
    H = np.where(d == 0, 0.0, H)
    return np.stack([H, S, L], axis=-1)


def _hsl_to_rgb(hsl: np.ndarray) -> np.ndarray:
    H = hsl[..., 0] * 6.0
    S = hsl[..., 1]
    L = hsl[..., 2]
    C = (1.0 - np.abs(2.0 * L - 1.0)) * S
    X = C * (1.0 - np.abs((H % 2.0) - 1.0))
    m = L - C * 0.5

    zeros = np.zeros_like(H)
    region = np.floor(H).astype(np.int32) % 6
    # Per-region (r,g,b) candidates pre-shift by m.
    r_options = np.stack([C, X, zeros, zeros, X, C], axis=-1)
    g_options = np.stack([X, C, C, X, zeros, zeros], axis=-1)
    b_options = np.stack([zeros, zeros, X, C, C, X], axis=-1)
    take = np.take_along_axis
    idx = region[..., None]
    r = take(r_options, idx, axis=-1).squeeze(-1) + m
    g = take(g_options, idx, axis=-1).squeeze(-1) + m
    b = take(b_options, idx, axis=-1).squeeze(-1) + m
    return np.stack([r, g, b], axis=-1)


def colorize(img_bytes: bytes, hex_color: str, *, sat_floor: float = 0.0) -> bytes:
    """Photoshop-style "Color" blend on every pixel: replace H + S with
    the target's, keep the original L. That recolors grey/black
    clothing to the target while preserving folds, seams, and shadow
    depth (which all live in L).

    `sat_floor` skips pixels whose ORIGINAL saturation is below the
    threshold — useful for the iris texture (sclera ≈ S 0 stays white,
    pupil L ≈ 0 stays black), but unhelpful for clothing where the
    starting fabric is intentionally grey. Default 0 = recolor
    everything; pass ~0.15 for iris."""
    rgb, alpha = _open_rgba(img_bytes)
    target = np.array(_hex_to_rgb(hex_color), dtype=np.float32) / 255.0
    target_hsl = _rgb_to_hsl(target.reshape(1, 1, 3))
    target_h = float(target_hsl[0, 0, 0])
    target_s = float(target_hsl[0, 0, 1])

    hsl = _rgb_to_hsl(rgb)
    mask = hsl[..., 1] >= sat_floor
    new_h = np.where(mask, target_h, hsl[..., 0])
    new_s = np.where(mask, target_s, hsl[..., 1])
    new_hsl = np.stack([new_h, new_s, hsl[..., 2]], axis=-1)
    new_rgb = _hsl_to_rgb(new_hsl)
    return _encode_png(new_rgb, alpha)


# ── L*a*b* color space ────────────────────────────────────────────────
# Hand-rolled vectorized RGB↔Lab (sRGB → linear → XYZ (D65) → Lab).
# Constants from the CIE definition.

def _srgb_to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _linear_to_srgb(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(np.clip(c, 0, None), 1.0 / 2.4) - 0.055)


_M_RGB2XYZ = np.array([
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.0721750],
    [0.0193339, 0.1191920, 0.9503041],
], dtype=np.float32)
_M_XYZ2RGB = np.linalg.inv(_M_RGB2XYZ).astype(np.float32)
# D65 white point reference XYZ (Y=1).
_REF_XYZ = np.array([0.95047, 1.0, 1.08883], dtype=np.float32)


def _f_lab(t: np.ndarray) -> np.ndarray:
    delta = 6.0 / 29.0
    return np.where(t > delta ** 3, np.cbrt(t), t / (3.0 * delta ** 2) + 4.0 / 29.0)


def _f_lab_inv(t: np.ndarray) -> np.ndarray:
    delta = 6.0 / 29.0
    return np.where(t > delta, t ** 3, 3.0 * delta ** 2 * (t - 4.0 / 29.0))


def _rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    lin = _srgb_to_linear(rgb)
    xyz = lin @ _M_RGB2XYZ.T
    xyz_n = xyz / _REF_XYZ
    fx, fy, fz = _f_lab(xyz_n[..., 0]), _f_lab(xyz_n[..., 1]), _f_lab(xyz_n[..., 2])
    L = 116.0 * fy - 16.0
    a = 500.0 * (fx - fy)
    b = 200.0 * (fy - fz)
    return np.stack([L, a, b], axis=-1)


def _lab_to_rgb(lab: np.ndarray) -> np.ndarray:
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    fy = (L + 16.0) / 116.0
    fx = a / 500.0 + fy
    fz = fy - b / 200.0
    xyz = np.stack([_f_lab_inv(fx), _f_lab_inv(fy), _f_lab_inv(fz)], axis=-1) * _REF_XYZ
    lin = xyz @ _M_XYZ2RGB.T
    return np.clip(_linear_to_srgb(lin), 0.0, 1.0)


def lab_shift(img_bytes: bytes, l_delta: float, a_delta: float, b_delta: float) -> bytes:
    """Shift every pixel's CIE L*a*b* coordinates by (l_delta, a_delta,
    b_delta). Use for skin-tone shifts: presets supply the triple,
    the tone slider adds extra l_delta on top.

    Typical ranges: L in [0,100], a/b in [-128,127]. Sensible deltas
    are L ±25, a ±5, b ±5."""
    rgb, alpha = _open_rgba(img_bytes)
    lab = _rgb_to_lab(rgb)
    lab[..., 0] = np.clip(lab[..., 0] + l_delta, 0.0, 100.0)
    lab[..., 1] = lab[..., 1] + a_delta
    lab[..., 2] = lab[..., 2] + b_delta
    new_rgb = _lab_to_rgb(lab)
    return _encode_png(new_rgb, alpha)


def skin_filter(img_bytes: bytes, preset: str, tone_delta: float, custom_color: str | None) -> bytes:
    """High-level skin filter used by the customize endpoint. Picks
    between lab_shift (natural tones) and colorize (custom non-natural
    color) based on whether a custom hex is provided. Tone delta
    stacks on top in both modes."""
    if custom_color:
        # Custom mode: colorize toward the hex, then optionally darken/lighten
        # via lab L-shift so the tone slider remains meaningful.
        out = colorize(img_bytes, custom_color, sat_floor=0.0)
        if abs(tone_delta) > 0.01:
            out = lab_shift(out, l_delta=tone_delta, a_delta=0.0, b_delta=0.0)
        return out
    triple = SKIN_PRESETS.get(preset, SKIN_PRESETS["medium"])
    return lab_shift(
        img_bytes,
        l_delta=triple[0] + tone_delta,
        a_delta=triple[1],
        b_delta=triple[2],
    )


def list_presets() -> Iterable[str]:
    return SKIN_PRESETS.keys()
