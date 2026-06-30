"""NeuroSync viseme engine — JarvYZ-side, in-process. TORCH-HEAVY.

Audio (whole TTS utterance) -> ARKit mouth-blendshape track (60 fps). The track
is precomputed per utterance (NeuroSync runs many-x realtime) and emitted on the
`tts_visemes` channel for the v13 browser avatar to apply, synced to the voice.
We emit only the jaw+mouth span (ARKit indices 14..40) — the avatar's blink/gaze
systems own the rest — same subset the legacy amplitude driver drove, but with
real visemes.

Importing THIS module pulls torch + librosa (via neuro_*). The torch-free
file/download helpers live in `model_io.py` so the satellite service can report
model status without that cost — keep the split. The model loads lazily on first
`visemes()` call (the in-core producer), never at import.

Model: the MIT-licensed NeuroSync v0.02 weights (convaitech/NEUROSYNC, model.pth).
"""
from __future__ import annotations

import threading

import numpy as np

from .model_io import FPS, MOUTH_HI, MOUTH_LO, _resolve_weights
from .neuro_features import extract_features_from_array
from .neuro_infer import generate_blendshapes
from .neuro_model import load_model


class NeuroSyncEngine:
    """Lazy singleton. The model loads on first use (not at import) so core
    startup never pays for it and stays fine when the engine isn't selected."""

    name = "neurosync"

    def __init__(self) -> None:
        self._model = None
        self._device = None
        self._lock = threading.Lock()
        self._failed = False

    def available(self) -> bool:
        return _resolve_weights() is not None

    def _ensure(self) -> bool:
        if self._model is not None:
            return True
        if self._failed:
            return False
        with self._lock:
            if self._model is not None:
                return True
            try:
                import torch
                path = _resolve_weights()
                if path is None:
                    self._failed = True
                    return False
                self._device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
                self._model = load_model(str(path), self._device)
                return True
            except Exception:
                self._failed = True
                return False

    def visemes(self, y: np.ndarray, sr: int) -> dict | None:
        """Whole-utterance waveform -> mouth track, or None if unusable.

        Returns {"engine","fps","lo","hi","frames"} where frames is a list of
        per-frame mouth values (ARKit indices lo..hi, clamped >=0)."""
        if not self._ensure():
            return None
        try:
            feats = extract_features_from_array(y, sr)
            if feats is None:
                return None
            bs = generate_blendshapes(self._model, feats, self._device)  # (T,68)
            mouth = np.clip(bs[:, MOUTH_LO:MOUTH_HI + 1], 0.0, None)
            return {
                "engine": self.name,
                "fps": FPS,
                "lo": MOUTH_LO,
                "hi": MOUTH_HI,
                "frames": np.round(mouth, 4).tolist(),
            }
        except Exception:
            return None


_engine: NeuroSyncEngine | None = None


def get_engine() -> NeuroSyncEngine:
    global _engine
    if _engine is None:
        _engine = NeuroSyncEngine()
    return _engine
