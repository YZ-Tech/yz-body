"""Persistent settings — thin shim over yz_satellite_common.PersistentSettings.

Declares this satellite's sidecar location + mutable fields; the engine
(atomic writes, coercer-per-field, legacy migration) lives in the shared
wheel. Import-time load() keeps the original contract: consumers importing
the live `settings` object immediately see persisted state."""
from __future__ import annotations

import os
from pathlib import Path

from yz_satellite_common import PersistentSettings

from .settings import Settings, settings as _live


def _settings_root() -> Path:
    """Where the satellite stores its own state (separate from any movable
    data root, so a PATCH there can never orphan this file). Override via
    `JWT_BODY_SETTINGS_ROOT` (test isolation)."""
    env = os.environ.get("JWT_BODY_SETTINGS_ROOT")
    if env:
        return Path(env)
    home = Path(os.environ.get("JARVYZ_HOME") or Path.home() / ".jarvyz")
    return home / "satellites" / "yz-body"


def _settings_path() -> Path:
    return _settings_root() / "settings.json"


_engine = PersistentSettings(
    _live,
    tag="body",
    path=_settings_path,
    fields={
        "data_root": lambda v: Path(str(v)).expanduser(),
        "assets_url": str,
    },
)

MUTABLE_KEYS = _engine.mutable_keys
load = _engine.load
save = _engine.save
apply_patch = _engine.apply_patch

# Read on module import so any consumer that imports `settings` immediately
# sees persisted state.
load()
