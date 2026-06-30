"""Clean-room chunked inference: (T,256) features -> (T,68) blendshapes.

Functional contract only: windowed decode (window=128, overlap=16, linear
cross-fade) + published output scaling (first 61 ARKit dims emitted x100 -> /100
back to 0..1). Original implementation.
"""
from __future__ import annotations

import numpy as np
import torch

WINDOW = 128
OVERLAP = 16
ARKIT_DIMS = 61


def _decode(model, chunk: np.ndarray, device) -> np.ndarray:
    src = torch.from_numpy(chunk).float().unsqueeze(0).to(device)
    with torch.no_grad():
        out = model(src)
    return out.squeeze(0).cpu().numpy()


def _pad(chunk: np.ndarray, window: int) -> np.ndarray:
    if chunk.shape[0] >= window:
        return chunk
    pad = window - chunk.shape[0]
    return np.pad(chunk, ((0, pad), (0, 0)), mode="reflect")


def _crossfade(a: np.ndarray, b: np.ndarray, overlap: int) -> np.ndarray:
    ov = min(overlap, len(a), len(b))
    if ov == 0:
        return np.vstack([a, b])
    out = a.copy()
    ramp = (np.arange(ov, dtype=np.float32) / ov)[:, None]
    out[-ov:] = (1 - ramp) * a[-ov:] + ramp * b[:ov]
    return np.vstack([out, b[ov:]])


def generate_blendshapes(model, features: np.ndarray, device) -> np.ndarray:
    """features (T,256) -> blendshapes (T,68), ARKit dims in ~0..1."""
    n = features.shape[0]
    step = WINDOW - OVERLAP
    out: list[np.ndarray] = []
    i = 0
    while i < n:
        end = min(i + WINDOW, n)
        dec = _decode(model, _pad(features[i:end], WINDOW), device)[: end - i]
        if out:
            out.append(_crossfade(out.pop(), dec, OVERLAP))
        else:
            out.append(dec)
        i += step

    frames = np.concatenate(out, axis=0)[:n]
    if frames.ndim == 3:
        frames = frames.reshape(-1, frames.shape[-1])
    frames = frames.copy()
    frames[:, :ARKIT_DIMS] /= 100.0
    return frames
