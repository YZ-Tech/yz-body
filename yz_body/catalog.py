"""Motion-catalog builder — the body satellite's prompt contribution.

JarvYZ's `onPromptBuild` hook (pipeline/satellite_prompt.py) fetches
`GET /catalog` when the body dashboard is the active dashboard, and appends
the returned text to the Loom persona overlay so Loom knows which gestures
it can trigger + the discipline around using them.

This was previously `MOTION_CATALOG_BLOCK` + the dynamic section builders in
JarvYZ core's `pipeline/llm_external.py`, reading `frontend/public/v13/
_clip_*.json` straight off disk. It now lives HERE and reads the satellite's
own `<data_root>/metadata/_clip_*.json`, so core carries zero motion-specific
knowledge — the satellite owns the whole block (prose + data).

The static prose references the core<->satellite seam contract
(`play_body_motion` ui_command, the `motion`/`motions` reply fields). That is
the satellite's to own: it is the body half of that contract (it already
listens for the `body.motion` window event core dispatches).
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .settings import settings


# ────────────────────────── metadata access ────────────────────────────


def _meta_dir() -> Path:
    return settings.metadata_dir


def _read_index(name: str, key: str) -> dict[str, Any]:
    """Read `<metadata>/<name>` and return its `<key>` sub-object, or {}."""
    f = _meta_dir() / name
    if not f.is_file():
        return {}
    try:
        data = json.loads(f.read_text("utf-8"))
    except Exception:  # noqa: BLE001 — corrupt index -> treat as empty
        return {}
    if not isinstance(data, dict):
        return {}
    sub = data.get(key)
    return sub if isinstance(sub, dict) else {}


def _read_active_character() -> dict[str, Any]:
    f = _meta_dir() / "_active_character.json"
    if not f.is_file():
        return {}
    try:
        data = json.loads(f.read_text("utf-8"))
    except Exception:  # noqa: BLE001
        return {}
    return data if isinstance(data, dict) else {}


# ────────────────────────── active-character filters ───────────────────


def _active_character_gender() -> str | None:
    """Gender of the active character, or None (= don't filter by gender)."""
    active = _read_active_character()
    file = active.get("file")
    if not isinstance(file, str) or not file:
        return None
    # A customized variant inherits its source character's gender
    # (Loom_custom.glb is still female).
    if file.endswith("_custom.glb"):
        file = file.replace("_custom.glb", ".glb")
    chars = _read_index("_character_meta.json", "characters")
    entry = chars.get(file)
    if not isinstance(entry, dict):
        return None
    g = entry.get("gender")
    return g if isinstance(g, str) and g in ("male", "female") else None


def _load_clip_genders() -> dict[str, str]:
    g = _read_index("_clip_genders.json", "genders")
    return {k: v for k, v in g.items() if isinstance(k, str) and isinstance(v, str)}


def _gender_allows(path: str, active_gender: str | None, gender_map: dict[str, str]) -> bool:
    """Neutral clips always pass; gendered clips pass only when the active
    character's gender matches (or no active gender is known)."""
    if active_gender is None:
        return True
    g = gender_map.get(path, "neutral")
    return g == "neutral" or g == active_gender


def _active_character_rig() -> str | None:
    """Active character's rig type from its filename, mirroring the
    frontend's `targetRigFor` (rigRemap.ts): BotM/BotF are Quaternius UAL
    mannequins; everything else is Mixamo-rigged. None = don't filter."""
    active = _read_active_character()
    file = active.get("file")
    if not isinstance(file, str) or not file:
        return None
    stem = file.rsplit("/", 1)[-1]
    if stem.startswith("BotM") or stem.startswith("BotF"):
        return "quaternius"
    return "mixamo"


def _clip_rig_for_path(path: str) -> str:
    """Mirror of frontend's `sourceRigFor`: clips under `private/` are
    Mixamo-rigged; everything else is Quaternius UAL."""
    return "mixamo" if path.startswith("private/") else "quaternius"


def _rig_allows(path: str, active_rig: str | None) -> bool:
    """Cross-rig clips silently no-op at the mixer, so surfacing them to
    Loom wastes prompt budget. None active rig = allow everything."""
    if active_rig is None:
        return True
    return _clip_rig_for_path(path) == active_rig


# ────────────────────────── static prose ───────────────────────────────


BODY_CATALOG_BLOCK = """
=== body avatar motion catalog ===
Trigger a gesture anytime (between turns, mid-thought, before reply):
  POST /api/ui/command {"action":"play_body_motion","clip":"<file>","mode":"once"}
  POST /api/ui/command {"action":"play_body_motion","clips":["a.fbx","b.fbx"]}
       ^ sequence — chains via mixer 'finished'; preempts mode-pool until done.

Or include in the reply JSON for sentence-timed gestures (fires ~200ms
before TTS so body language leads audio):
  motion:  "<file>"            single
  motions: ["a.fbx","b.fbx"]   sequence

Also available on /api/say (for at-any-time speech):
  POST /api/say {"text":"...","motion":"<file>"}
  POST /api/say {"text":"...","motions":["a.fbx","b.fbx"]}

For tight motion<->sentence pairing across multiple sentences, prefer
multiple /api/say calls (TTS lock serializes them). For continuous speech
with shifting body language beneath, use one call with motions: [].

To sync a world-changing tool call with a motion (e.g. lights off at
the trigger pull of `shooting-gun.fbx`), use either:

  - `sync_to: { clip: "shooting-gun.fbx", beat: "peak", offset_ms: 0 }`
    Resolves against the auto-analyzed peaks listed below. `beat`
    defaults to "peak" (highest-intensity moment); use "peak2" /
    "peak3" for the 2nd/3rd-strongest peaks. `offset_ms` (optional,
    +/-) shifts off the beat — handy when an action needs a small
    head start. Preferred — auto-correct timing.

  - `delay_ms: <0-10000>` — raw fallback when no beat data exists or
    you want a hand-tuned offset.

Tools without either fire immediately, BEFORE TTS.

Discipline:
- Most replies should have NO motion. Motion is condiment, not main course.
- Skip on: stops, panic-spam, cross-talk cancels, one-word acks, echoes.
- One motion per reply max. Latest wins if you fire several in a row.
- `mode:"once"` is the default and what you want 99% of the time.
- DO NOT use `thinking.fbx` as a reply motion — the `thinking` mode-pool
  already plays it while your reply is being composed; firing it again at
  TTS start is visually redundant. Use it ONLY via curl in non-reply
  moments (e.g., between turns, holding a contemplative beat).

Intent -> clip suggestions:
- nod_yes:    head-nod-yes.fbx, hard-head-nod.fbx, thoughtful-head-nod.fbx, lengthy-head-nod.glb
- shake_no:   shaking-head-no.fbx, annoyed-head-shake.fbx, thoughtful-head-shake.fbx
- shrug:      shrugging.fbx                            (uncertain / I don't know)
- thank:      thankful.fbx                              (gratitude)
- greet:      standing-greeting.fbx, quick-formal-bow.fbx, salute.fbx, hand-raising.fbx, waving.fbx
- explain:    talking.fbx, talking-1.fbx
- think:      thinking.fbx                              (CURL-ONLY — see discipline)
- annoy:      angry-gesture.glb, dismissing-gesture.fbx, threatening.fbx, standing-arguing.fbx
- emote:      relieved-sigh.fbx, being-cocky.fbx, look-away-gesture.fbx
- confide:    telling-a-secret.fbx                      (conspiratorial / intimate)
- celebrate:  hip-hop-dancing.fbx, dance-007.glb       (silly — only when fun fits)
- combat:     fight-idle.fbx                            (combat stance — sustained, not a strike)
- strike:     boxing.fbx, boxing-1.fbx, boxing-2.fbx, punching-bag.fbx, knee-jabs-to-uppercut.fbx, surprise-uppercut.fbx
- kick:       kicking.fbx, kicking-1.fbx, kicking-2.fbx, flying-kick.fbx, roundhouse-kick.fbx, martelo-2.fbx
- taunt:      taunt.fbx                                 (provoke / "come at me" — between strikes)
- shoot:      gunplay.fbx, shooting-gun.fbx             (drawn-gun gestures)
- cast:       casting-spell.fbx, magic-heal.fbx         (magic — use sparingly, very on-brand for "Jedi-hand" WLED control)

Motion preempts the mode-pool for its duration (~2-4s), then mode-pool resumes.
The body dashboard must be the active dashboard for motions to be visible;
otherwise silent drop. Combat / strike / kick / cast clips are NOT in any
default mode pool — they only fire when YOU pick them. Use only when the
moment genuinely calls for that energy; don't reach for them as filler.
"""


# ────────────────────────── dynamic sections ───────────────────────────


def _tagged_clips_section() -> str:
    """Per-clip tags index as an LLM-readable list, filtered by the active
    character's rig + gender. Empty when nothing remains after filtering."""
    tags = _read_index("_clip_tags.json", "tags")
    if not tags:
        return ""
    active_gender = _active_character_gender()
    active_rig = _active_character_rig()
    gender_map = _load_clip_genders()
    lines = ["", "Tagged clips (free-form labels — match by intent / mood):"]
    appended = False
    for path in sorted(tags.keys()):
        labels = tags[path]
        if not isinstance(labels, list) or not labels:
            continue
        if not _rig_allows(path, active_rig):
            continue
        if not _gender_allows(path, active_gender, gender_map):
            continue
        lines.append(f"  - {path} — [{', '.join(labels)}]")
        appended = True
    return ("\n".join(lines) + "\n") if appended else ""


def _clip_beats_section() -> str:
    """Top-K peaks per clip as an LLM-readable block, with each peak's
    dominant bone, canonical rank name, and any user-set label."""
    beats = _read_index("_clip_beats.json", "beats")
    if not beats:
        return ""
    active_gender = _active_character_gender()
    active_rig = _active_character_rig()
    gender_map = _load_clip_genders()
    lines = ["", "Clip beats (set `sync_to:{clip,beat}` on a tool_call to delay_ms = beat_t * 1000):"]
    appended = False
    for path in sorted(beats.keys()):
        if not _rig_allows(path, active_rig):
            continue
        if not _gender_allows(path, active_gender, gender_map):
            continue
        entry = beats[path]
        if not isinstance(entry, dict):
            continue
        peaks = entry.get("peaks") or []
        if not peaks:
            continue
        labels = entry.get("labels") if isinstance(entry.get("labels"), dict) else {}
        sorted_peaks = sorted(peaks, key=lambda p: -float(p.get("intensity", 0)))[:3]
        bits = []
        for rank, p in enumerate(sorted_peaks):
            canonical = "peak" if rank == 0 else f"peak{rank + 1}"
            t = p.get("t", 0)
            t_key = f"{float(t):.2f}"
            label = labels.get(t_key) if isinstance(labels, dict) else None
            name = f"{canonical}={label}" if isinstance(label, str) and label else canonical
            bones = p.get("bones") or []
            via = ("/" + bones[0]) if bones else ""
            bits.append(f"{name}:{t:.2f}s{via}")
        dur = entry.get("duration", 0)
        lines.append(f"  - {path} ({dur:.2f}s) — [{', '.join(bits)}]")
        appended = True
    return ("\n".join(lines) + "\n") if appended else ""


def build_catalog() -> str:
    """Static prose + dynamic tagged-clips + per-clip beats. Built fresh on
    each request so JarvYZ (which caches with a short TTL) eventually sees
    tag edits, clip additions, and character swaps without a satellite
    restart."""
    return BODY_CATALOG_BLOCK + _tagged_clips_section() + _clip_beats_section()
