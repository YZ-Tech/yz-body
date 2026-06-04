"""Load + persist satellite settings to disk.

On import, read `<settings_root>/settings.json` into the module-level
`settings` dataclass. PATCH /settings (server.py) mutates the dataclass
in-place and calls save().

`<settings_root>` defaults to `~/.jarvyz/satellites/yz-body/` (derived from
JARVYZ_HOME), override via `JWT_BODY_SETTINGS_ROOT` (unusual — most
overrides should move the data dir via `JWT_BODY_ROOT` instead).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from .settings import Settings, settings as _live


def _settings_root() -> Path:
    env = os.environ.get("JWT_BODY_SETTINGS_ROOT")
    if env:
        return Path(env)
    home = Path(os.environ.get("JARVYZ_HOME") or Path.home() / ".jarvyz")
    return home / "satellites" / "yz-body"


def _settings_path() -> Path:
    return _settings_root() / "settings.json"


MUTABLE_KEYS = ("data_root", "assets_url")


def load() -> None:
    """Read settings.json into the live dataclass. No-op if missing
    (defaults stand). Soft-fail on parse errors."""
    p = _settings_path()
    if not p.exists():
        return
    try:
        data = json.loads(p.read_text("utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"[body] settings.json parse failed: {e}", file=sys.stderr)
        return
    if "data_root" in data:
        _live.data_root = Path(str(data["data_root"]))
    if "assets_url" in data:
        _live.assets_url = str(data["assets_url"])


def save() -> None:
    """Persist the live dataclass to settings.json. Atomic via tmp+rename."""
    p = _settings_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = {"data_root": str(_live.data_root), "assets_url": _live.assets_url}
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    tmp.replace(p)


def apply_patch(patch: dict) -> Settings:
    """Validate + apply a PATCH /settings body. Returns the post-merge
    snapshot. Unknown keys are dropped silently."""
    if "data_root" in patch:
        _live.data_root = Path(str(patch["data_root"])).expanduser()
    if "assets_url" in patch:
        _live.assets_url = str(patch["assets_url"])
    save()
    return _live


# Read on module import so any consumer that imports `settings` immediately
# sees persisted state.
load()
