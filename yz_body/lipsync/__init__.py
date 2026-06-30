"""NeuroSync viseme engine for the v13 body avatar (yz-body).

Produces an ARKit jaw+mouth blendshape track from a spoken utterance. Lives here
because v13 is the consumer: the browser three.js avatar has no native solver, so
the in-core producer (`producer.py`, registered into core TTS at boot) runs this
in-process and emits the track on `tts_visemes` for the avatar to apply (synced
to the voice). (It originally lived in yz-unreal for a UE→LiveLink path; UE 5.8
now does native audio2face, so v14 no longer uses this — hence the move to where
it's actually used.)

Two-layer split (LOAD-BEARING — do not import `engine` from this `__init__`):
  - `model_io`  — TORCH-FREE file/status/download helpers + the index constants.
                  The satellite service (:9005) imports only this (or this
                  package, which re-exports it) for the /lipsync/* API. Keeping
                  THIS module torch-free is what lets the satellite report model
                  status without a ~6s/942MB torch+model load — importing any
                  submodule runs this `__init__` first, so it must stay light.
  - `engine`    — the torch+librosa NeuroSyncEngine. ONLY the in-core producer
                  imports it (`from yz_body.lipsync.engine import get_engine`);
                  first `visemes()` call lazy-loads the model.

Public surface (all torch-free):
  - model_status / install / start_download / download_state /
    canonical_model_path / available
  - MOUTH_LO / MOUTH_HI / FPS  -> the ARKit jaw+mouth index span we drive
For the engine itself: `from yz_body.lipsync.engine import get_engine, NeuroSyncEngine`.
"""
from __future__ import annotations

from .model_io import (
    FPS,
    MOUTH_HI,
    MOUTH_LO,
    available,
    canonical_model_path,
    download_state,
    install,
    model_status,
    start_download,
)

__all__ = [
    "MOUTH_LO",
    "MOUTH_HI",
    "FPS",
    "available",
    "model_status",
    "canonical_model_path",
    "install",
    "start_download",
    "download_state",
]
