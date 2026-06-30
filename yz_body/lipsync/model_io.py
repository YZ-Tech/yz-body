"""NeuroSync weights — resolution, status, promote, download. TORCH-FREE.

Deliberately imports NEITHER torch nor librosa nor the neuro_* modules, so the
satellite service (:9005) can answer model status/install/download requests
without paying the ~6s/942MB torch+model load. The heavy `engine.py` (the
in-core viseme producer) imports THIS for paths; the satellite API imports only
this. Keep it that way — adding a torch import here defeats the split.

Model: the MIT-licensed NeuroSync v0.02 weights (model.pth). The downloader
writes straight to the canonical path, so resolution is just:
  1. $JARVYZ_NEUROSYNC_MODEL                    (explicit power-user override)
  2. ~/.jarvyz/models/neurosync/model.pth       (canonical — where install() puts it)
"""
from __future__ import annotations

import os
import threading
from pathlib import Path

# ARKit standard order: 14 JawForward .. 17 JawOpen .. 40 MouthUpperUpRight.
# Pure constants (no torch) so both the engine and the torch-free API share them.
MOUTH_LO, MOUTH_HI = 14, 40
FPS = 60


def _candidate_paths() -> list[Path]:
    out: list[Path] = []
    env = os.environ.get("JARVYZ_NEUROSYNC_MODEL")
    if env:
        out.append(Path(env))
    out.append(canonical_model_path())
    return out


def _resolve_weights() -> Path | None:
    for p in _candidate_paths():
        if p.is_file():
            return p
    return None


def available() -> bool:
    return _resolve_weights() is not None


# ── setup / check ────────────────────────────────────────────────────────────
# canonical_model_path() is where install() downloads the weights and where they
# resolve from (plus the $JARVYZ_NEUROSYNC_MODEL override). Surfaced via the
# satellite /lipsync/* API.

def canonical_model_path() -> Path:
    return Path.home() / ".jarvyz" / "models" / "neurosync" / "model.pth"


def model_status() -> dict:
    resolved = _resolve_weights()
    # Self-heal: a finished download leaves its byte counters in _dl. If the
    # weights later disappear (e.g. deleted) with nothing in flight, clear that
    # residue so status doesn't report a phantom "942 MB" for an absent model.
    if resolved is None and not _dl["downloading"]:
        _dl["downloaded"] = 0
        _dl["total"] = 0
    return {
        "available": resolved is not None,
        "path": str(resolved) if resolved else None,
        "size_mb": round(resolved.stat().st_size / 1e6, 1) if resolved else None,
        # Live download progress (when install()/start_download is fetching weights).
        "downloading": _dl["downloading"],
        "downloaded_mb": round(_dl["downloaded"] / 1e6, 1),
        "total_mb": round(_dl["total"] / 1e6, 1),
        "download_error": _dl["error"],
    }


# Download source for the MIT NeuroSync weights. Default = our own UNGATED
# redistribution as a YZ-Tech release asset (MIT permits this; the upstream HF
# repos are access-gated). Too large to bundle, so users pull it on demand
# (ship-engine-not-model, same as YOLOE / Ollama). Env-overridable; a HuggingFace
# token (JARVYZ_HF_TOKEN) is only needed if pointed back at a gated HF URL.
_MODEL_URL = os.environ.get(
    "JARVYZ_NEUROSYNC_URL",
    "https://github.com/YZ-Tech/yz-body/releases/download/v0.0.4/model.pth",
)
_dl: dict = {"downloading": False, "downloaded": 0, "total": 0, "error": None}


def download_state() -> dict:
    return dict(_dl)


def _hf_token() -> str:
    for k in ("JARVYZ_HF_TOKEN", "HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"):
        v = (os.environ.get(k) or "").strip()
        if v:
            return v
    return ""


def _download_worker() -> None:
    import urllib.error
    import urllib.request
    canon = canonical_model_path()
    tmp = canon.with_suffix(".part")
    headers = {"User-Agent": "jarvyz-neurosync"}
    token = _hf_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        canon.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(_MODEL_URL, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as r:
            _dl["total"] = int(r.headers.get("Content-Length") or 0)
            with open(tmp, "wb") as f:
                while True:
                    chunk = r.read(1 << 20)  # 1 MiB
                    if not chunk:
                        break
                    f.write(chunk)
                    _dl["downloaded"] += len(chunk)
        tmp.replace(canon)
    except urllib.error.HTTPError as e:  # gated/forbidden -> actionable message
        if e.code in (401, 403):
            _dl["error"] = (
                "NeuroSync weights are gated on HuggingFace. Accept the license at "
                "huggingface.co/convaitech/NEUROSYNC, then set JARVYZ_HF_TOKEN to a "
                "HuggingFace access token — or place model.pth manually at the path below."
            )
        else:
            _dl["error"] = f"download failed: HTTP {e.code}"
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass
    except Exception as e:  # noqa: BLE001 — report via state, never raise
        _dl["error"] = str(e)
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass
    finally:
        _dl["downloading"] = False


def start_download() -> dict:
    """Download the weights to the canonical path in a background thread. No-op if
    a model is already resolvable or a download is in flight."""
    if _resolve_weights() is not None:
        return {"ok": True, "already": True, **model_status()}
    if _dl["downloading"]:
        return {"ok": True, "downloading": True, **download_state()}
    _dl.update(downloading=True, downloaded=0, total=0, error=None)
    threading.Thread(target=_download_worker, name="neurosync-dl", daemon=True).start()
    return {"ok": True, "downloading": True, **download_state()}


def install() -> dict:
    """One-click setup: download the MIT weights to the canonical path in the
    background. No-op if a model already resolves (start_download handles that)."""
    return start_download()
