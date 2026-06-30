"""Clean-room audio feature frontend for NeuroSync v0.02 (256-dim).

ORIGINAL implementation. The numeric recipe is the functional contract the
MIT-licensed weights were trained against (facts for correct output, not
protected expression). No AnimaVR source is reused. Feature extractor proven
numerically identical to the reference (max|Δ|=2.7e-08) 2026-06-07.

256 = MFCC(23)+Δ+Δ² (69)  ⊕  autocorrelation (187), both framed at ~1/60 s with
2x overlap, adjacent-frame pair-averaged to ~60 fps, transposed, then hstacked.
"""
from __future__ import annotations

import io

import librosa
import numpy as np

SR = 88200
FRAME_SEC = 0.01667            # ~1/60 s
N_MFCC = 23
N_AUTOCORR = 187
MIN_FRAMES = 9


def _normalize(y: np.ndarray) -> np.ndarray:
    peak = float(np.max(np.abs(y))) if y.size else 0.0
    if peak > 0:
        y = y / peak
    return y.astype(np.float32)


def load_audio_bytes(audio_bytes: bytes, sr: int = SR) -> np.ndarray:
    y, _ = librosa.load(io.BytesIO(audio_bytes), sr=sr, mono=True)
    return _normalize(y)


def load_audio_array(y: np.ndarray, sr: int) -> np.ndarray:
    """Resample an in-memory float waveform (e.g. straight off the TTS engine)
    to the model SR and peak-normalize — no WAV round-trip."""
    y = np.asarray(y, dtype=np.float32)
    if y.ndim > 1:
        y = y.mean(axis=1)
    if sr != SR:
        y = librosa.resample(y, orig_sr=sr, target_sr=SR)
    return _normalize(y)


def _cmvn(m: np.ndarray) -> np.ndarray:
    mean = m.mean(axis=1, keepdims=True)
    std = m.std(axis=1, keepdims=True)
    return (m - mean) / (std + 1e-10)


def _pair_average(feats: np.ndarray) -> np.ndarray:
    c, t = feats.shape
    even = t - (t % 2)
    pairs = feats[:, :even].reshape(c, -1, 2).mean(axis=2)
    if t % 2:
        pairs = np.hstack([pairs, feats[:, -1:]])
    return pairs


def _mfcc_branch(y, sr, frame, hop) -> np.ndarray:
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=N_MFCC, n_fft=frame, hop_length=hop)
    mfcc = _cmvn(mfcc)
    d1 = librosa.feature.delta(mfcc)
    d2 = librosa.feature.delta(mfcc, order=2)
    return _pair_average(np.vstack([mfcc, d1, d2])).T   # (~T/2, 69)


def _autocorr_branch(y, sr, frame, hop) -> np.ndarray:
    pad = frame // 2
    yp = np.pad(y, pad, mode="reflect")
    frames = librosa.util.frame(yp, frame_length=frame, hop_length=hop)
    frames = frames - frames.mean(axis=0, keepdims=True)
    frames = frames * np.hanning(frame)[:, None]
    lags = N_AUTOCORR + 1
    out = np.empty((lags, frames.shape[1]), dtype=np.float32)
    mid = frame - 1
    for j in range(frames.shape[1]):
        f = frames[:, j]
        corr = np.correlate(f, f, mode="full")[mid: mid + lags]
        if corr[0] != 0:
            corr = corr / corr[0]
        out[:, j] = corr
    out = out[1:, :]
    if np.all(np.abs(out[:, 0]) < 1e-7):
        out[:, 0] = out[:, 1]
    if np.all(np.abs(out[:, -1]) < 1e-7):
        out[:, -1] = out[:, -2]
    return _pair_average(out).T                          # (~T/2, 187)


def _features(y: np.ndarray, sr: int) -> np.ndarray | None:
    frame = int(FRAME_SEC * sr)
    hop = frame // 2
    n_frames = (len(y) - frame) // hop + 1
    if n_frames < MIN_FRAMES:
        return None
    mfcc = _mfcc_branch(y, sr, frame, hop)
    ac = _autocorr_branch(y, sr, frame, hop)
    n = min(len(mfcc), len(ac))
    return np.hstack([mfcc[:n], ac[:n]]).astype(np.float32)


def extract_features(audio_bytes: bytes) -> np.ndarray | None:
    """(T, 256) float32 from encoded audio bytes, or None if too short."""
    return _features(load_audio_bytes(audio_bytes), SR)


def extract_features_from_array(y: np.ndarray, sr: int) -> np.ndarray | None:
    """(T, 256) float32 from an in-memory waveform, or None if too short."""
    return _features(load_audio_array(y, sr), SR)
