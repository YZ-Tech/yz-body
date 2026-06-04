"""Satellite-owned settings.

`data_root` — where the satellite stores its asset library + metadata.
Defaults to `~/.jarvyz/satellites/yz-body/` (derived from JARVYZ_HOME, the
shared single source of truth), overridable via `JWT_BODY_ROOT` env for
test sandboxes + multi-machine deployments.

`assets_url` — where the 3D asset bundle is fetched from on first run
(download-on-first-run; the ~162M of .glb never ship in the wheel).
Overridable via `JWT_BODY_ASSETS_URL` so a fork / offline mirror can point
elsewhere.

Derived dirs (computed in server.py, not stored): `<data_root>/assets/`
(characters + animations) and `<data_root>/metadata/` (the clip/character
JSON indices).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# Default asset bundle: the yz-body release ships the public 3D library as a
# release asset (a .tar.zst / .zip). Empty string disables auto-download
# (the user drops assets into <data_root>/assets/ by hand).
_DEFAULT_ASSETS_URL = (
    "https://github.com/YZ-Tech/yz-body/releases/latest/download/yz-body-assets.zip"
)


def _default_data_root() -> Path:
    env = os.environ.get("JWT_BODY_ROOT")
    if env:
        return Path(env)
    home = Path(os.environ.get("JARVYZ_HOME") or Path.home() / ".jarvyz")
    return home / "satellites" / "yz-body"


def _default_assets_url() -> str:
    return os.environ.get("JWT_BODY_ASSETS_URL", _DEFAULT_ASSETS_URL)


@dataclass
class Settings:
    """Snapshot of mutable satellite settings."""

    data_root: Path = field(default_factory=_default_data_root)
    assets_url: str = field(default_factory=_default_assets_url)

    @property
    def assets_dir(self) -> Path:
        return self.data_root / "assets"

    @property
    def characters_dir(self) -> Path:
        return self.assets_dir / "characters"

    @property
    def animations_dir(self) -> Path:
        return self.assets_dir / "animations"

    @property
    def metadata_dir(self) -> Path:
        return self.data_root / "metadata"


# Module singleton. persistent_settings.load() may replace fields from the
# on-disk JSON sidecar at boot.
settings = Settings()
