"""In-core NeuroSync viseme producer for the v13 body avatar.

This module runs INSIDE the JarvYZ core process (registered at boot by core's
server.py when the body satellite is enabled) — it is the bridge that keeps core
itself free of any viseme/neurosync code. It:

  1. registers `tts_visemes` as an opt-in event channel (so it isn't hardcoded in
     core's events.py),
  2. registers a post-synth hook on core TTS that, per utterance, computes the
     ARKit mouth track with the NeuroSync engine and emits it on `tts_visemes`
     for the v13 browser avatar to apply (synced to playback), and
  3. warms the model at boot when the engine is the active lipsync engine.

The active engine is the yz-body satellite setting `lipsync_engine`
(amplitude|neurosync), read LIVE per utterance via
`satellite_manifest.effective_setting` so toggling it (PATCH /api/satellites/body)
takes effect without a restart. UE (v14) uses native PCM lipsync, not this.

Satellites may import core; core imports this only behind an `is_enabled("body")`
guard, so a clean install without yz-body carries none of it.
"""
from __future__ import annotations

import threading

from jarvyz.pipeline import events, satellite_manifest
from jarvyz.pipeline import tts as _tts
from jarvyz.pipeline.log import log

_CHANNEL = "tts_visemes"
_utt_seq = 0


def _engine_selected() -> bool:
    """True when the body satellite's lipsync_engine setting is 'neurosync'.
    Read live so the toggle works without a restart; defaults to amplitude."""
    return satellite_manifest.effective_setting("body", "lipsync_engine", "amplitude") == "neurosync"


def _emit_visemes(audio, sr) -> None:
    """Post-synth hook: when neurosync is the active engine AND a v13 browser is
    subscribed, compute this utterance's ARKit mouth track and emit it on
    `tts_visemes`. Non-fatal — any failure just leaves the avatar on amplitude."""
    global _utt_seq
    if not _engine_selected():
        return
    # Only pay for NeuroSync inference when a v13 browser is actually consuming
    # visemes. v13's `useBodyVisemeStream` opt-in subscribes to `tts_visemes`
    # ONLY while mounted, so no subscriber == no v13 active == skip the work.
    if not events.has_subscribers(_CHANNEL):
        return
    try:
        from yz_body.lipsync.engine import get_engine  # torch — lazy
        track = get_engine().visemes(audio, sr)
    except Exception as e:  # noqa: BLE001
        log("tts", f"viseme compute failed: {e}")
        return
    if not track:
        return
    _utt_seq += 1
    events.emit(_CHANNEL, id=_utt_seq, **track)


def _prewarm() -> None:
    """Load the NeuroSync model + JIT its kernels off the playback path by running
    one tiny inference on silence. Best-effort; only when neurosync is active."""
    if not _engine_selected():
        return
    try:
        import numpy as np

        from yz_body.lipsync.engine import get_engine  # torch — lazy
        get_engine().visemes(np.zeros(int(0.5 * 24000), dtype=np.float32), 24000)
        log("tts", "neurosync viseme model warmed")
    except Exception as e:  # noqa: BLE001
        log("tts", f"neurosync warm failed: {e}")


def register() -> None:
    """Wire the producer into core TTS. Idempotent. Called at boot from core's
    server.py when the body satellite is enabled."""
    events.register_opt_in_channel(_CHANNEL)
    _tts.register_synth_hook(_emit_visemes)
    # Warm in the background so boot isn't blocked; no-op unless neurosync active.
    threading.Thread(target=_prewarm, name="neurosync-prewarm", daemon=True).start()
    log("tts", "yz-body viseme producer registered")
