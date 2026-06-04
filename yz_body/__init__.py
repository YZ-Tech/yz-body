"""body — JarvYZ's 3D full-body avatar (render assets + clip management).

This package is the satellite's backend service: it enumerates the 3D
character + animation-clip library, manages per-clip metadata (tags,
genders, beats), and exposes the GLB texture tools — everything the avatar
UI (the dynamic-module IIFE) and JarvYZ's `/api/body/*` proxy need.

Storage layout (created lazily under <data_root>, default
`~/.jarvyz/satellites/yz-body/`, override via `JWT_BODY_ROOT`):

    <data_root>/
        assets/                 # 3D library — DOWNLOADED ON FIRST RUN
            characters/         #   .glb / .gltf / .fbx rigged characters
            animations/         #   .glb / .fbx motion clips (grouped in subdirs)
        metadata/               # per-clip + per-character JSON indices
            _clip_tags.json
            _clip_genders.json
            _clip_beats.json
            _character_meta.json
            _active_character.json
        settings.json           # mutable satellite settings

Unlike the other satellites, the ~162M of `.glb` assets are not shipped in
the wheel — they are fetched into `<data_root>/assets/` on first boot (see
server._ensure_assets). Surfaced in JarvYZ as dashboard variant 13.
"""
from __future__ import annotations

__version__ = "0.0.1"
__all__ = ["__version__"]
