"""FastAPI daemon for the body (3D avatar) satellite.

Ported from JarvYZ's in-tree `web/api/v13.py`. Routes mirror the old
`/api/v13/*` surface but live HERE without the prefix (the JarvYZ-side
proxy adds `/api/body`). The standalone SPA + JarvYZ both talk HTTP to it.

The big change from the in-tree version: that one juggled THREE asset
trees (Vite `frontend/public/v13/`, the built `web/static/v13/`, and the
git-ignored `_private_assets/` mirror). A standalone satellite has ONE
canonical asset root — `<data_root>/assets/{characters,animations}` —
populated by download-on-first-run. All the public/static/private mirror
plumbing collapses away. Per-clip metadata (tags, genders, beats,
character meta) lives in `<data_root>/metadata/`.

Endpoints (proxy adds /api/body):
  GET  /health
  GET  /characters · /characters/meta · /characters/active
  GET  /clips · /clips/tags · /clips/beats · /clips/genders
  POST /clips/trash · /clips/tags · /clips/genders · /clips/analyze
       /clips/beats/label · /characters/meta · /characters/active
  POST /open_folder · /clips/open_folder            (desktop file manager)
  POST /character/extract · /repack · /customize    (needs [textures] extra)
  GET  /character/appearance
  GET/PATCH /settings · WS /events
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

from . import __version__, observer
from . import persistent_settings as _persist  # noqa: F401 — load() runs on import
from .settings import settings

app = FastAPI(title="body", version=__version__)

_CHARACTER_EXTS = {".glb", ".gltf", ".fbx"}
_CLIP_EXTS = {".glb", ".gltf", ".fbx"}
_TRASH_NAME = "_trash"
_PRIVATE_SUBFOLDER = "private"


# ────────────────────────── paths (per-call so PATCH /settings applies) ──


def _characters_dir() -> Path:
    return settings.characters_dir


def _animations_dir() -> Path:
    return settings.animations_dir


def _meta_dir() -> Path:
    return settings.metadata_dir


def _tags_file() -> Path:
    return _meta_dir() / "_clip_tags.json"


def _beats_file() -> Path:
    return _meta_dir() / "_clip_beats.json"


def _clip_genders_file() -> Path:
    return _meta_dir() / "_clip_genders.json"


def _character_meta_file() -> Path:
    return _meta_dir() / "_character_meta.json"


def _active_character_file() -> Path:
    return _meta_dir() / "_active_character.json"


# ────────────────────────── download-on-first-run ──────────────────────


def _assets_present() -> bool:
    c = _characters_dir()
    return c.is_dir() and any(c.iterdir())


def _ensure_assets() -> None:
    """Fetch + extract the 3D asset bundle into <data_root> on first run.
    No-op once assets exist or if `assets_url` is empty (manual-asset mode).
    Synchronous + best-effort — first-run only; a failure leaves an empty
    library (endpoints just return nothing) rather than crashing the server."""
    if _assets_present():
        return
    url = settings.assets_url
    if not url:
        return
    import urllib.request

    settings.data_root.mkdir(parents=True, exist_ok=True)
    print(f"[body] first run — downloading asset bundle: {url}", file=sys.stderr)
    try:
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            tmp_path = tmp.name
        urllib.request.urlretrieve(url, tmp_path)
        import zipfile

        with zipfile.ZipFile(tmp_path) as zf:
            zf.extractall(settings.data_root)
        os.unlink(tmp_path)
        print("[body] asset bundle extracted", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"[body] asset download failed ({e}); library stays empty", file=sys.stderr)


# ────────────────────────── discovery ──────────────────────────────────


@app.get("/characters")
def list_characters() -> dict[str, Any]:
    """List character files under <assets>/characters/ (+ a `private/`
    subfolder if present), label = filename stem."""
    _ensure_assets()
    items: list[dict[str, str]] = []
    base = _characters_dir()
    if base.is_dir():
        for p in sorted(base.iterdir(), key=lambda x: x.name.lower()):
            if p.is_file() and p.suffix.lower() in _CHARACTER_EXTS:
                items.append({"file": p.name, "label": p.stem})
        private_dir = base / _PRIVATE_SUBFOLDER
        if private_dir.is_dir():
            for p in sorted(private_dir.iterdir(), key=lambda x: x.name.lower()):
                if p.is_file() and p.suffix.lower() in _CHARACTER_EXTS:
                    items.append({"file": f"{_PRIVATE_SUBFOLDER}/{p.name}", "label": p.stem})
    return {"characters": items}


@app.get("/clips")
def list_clips() -> dict[str, Any]:
    """Recursively list animation clips under <assets>/animations/.
    Each entry: {path, file, group}. `_`-prefixed dirs (e.g. _trash) are
    skipped. A `private/` subfolder is walked one level deeper so clips
    land at path 'private/<Group>/<file>'."""
    _ensure_assets()
    items: list[dict[str, str]] = []
    base = _animations_dir()
    if not base.is_dir():
        return {"clips": items}
    for sub in sorted(base.iterdir(), key=lambda x: x.name.lower()):
        if sub.is_file() and sub.suffix.lower() in _CLIP_EXTS:
            items.append({"path": sub.name, "file": sub.name, "group": "Ungrouped"})
            continue
        if not sub.is_dir() or sub.name.startswith("_"):
            continue
        if sub.name == _PRIVATE_SUBFOLDER:
            for inner in sorted(sub.iterdir(), key=lambda x: x.name.lower()):
                if inner.is_file() and inner.suffix.lower() in _CLIP_EXTS:
                    items.append({
                        "path": f"{_PRIVATE_SUBFOLDER}/{inner.name}",
                        "file": inner.name,
                        "group": _PRIVATE_SUBFOLDER,
                    })
                    continue
                if not inner.is_dir() or inner.name.startswith("_"):
                    continue
                inner_group = f"{_PRIVATE_SUBFOLDER}/{inner.name}"
                for p in sorted(inner.iterdir(), key=lambda x: x.name.lower()):
                    if p.is_file() and p.suffix.lower() in _CLIP_EXTS:
                        items.append({"path": f"{inner_group}/{p.name}", "file": p.name, "group": inner_group})
            continue
        group = sub.name
        for p in sorted(sub.iterdir(), key=lambda x: x.name.lower()):
            if p.is_file() and p.suffix.lower() in _CLIP_EXTS:
                items.append({"path": f"{group}/{p.name}", "file": p.name, "group": group})
    return {"clips": items}


def _safe_clip_path(rel: str) -> Path:
    """Resolve a client clip path against the animations dir; reject
    traversal."""
    if not rel or rel.startswith(("/", "\\")) or ".." in rel.replace("\\", "/").split("/"):
        raise HTTPException(400, f"invalid clip path: {rel!r}")
    base = _animations_dir()
    target = (base / rel).resolve()
    if not str(target).startswith(str(base.resolve())):
        raise HTTPException(400, f"clip path escapes animations dir: {rel!r}")
    return target


def _trash_clip_file(rel: Path) -> Path | None:
    """Move animations/<rel> → animations/_trash/<group>/<file>. Returns the
    destination, or None if the source doesn't exist."""
    base = _animations_dir()
    src = base / rel
    if not src.is_file():
        return None
    parts = rel.parts
    dest_dir = base / _TRASH_NAME / ("_root" if len(parts) == 1 else parts[0])
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / src.name
    if dest.exists():
        n = 1
        while (cand := dest_dir / f"{src.stem}.{n}{src.suffix}").exists():
            n += 1
        dest = cand
    shutil.move(str(src), str(dest))
    return dest


@app.post("/clips/trash")
def trash_clip(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Soft-delete a clip into _trash/. Body: {"path": "Group/clip.fbx"}."""
    raw = body.get("path", "")
    if not isinstance(raw, str) or not raw or raw.startswith(("/", "\\")) \
            or ".." in raw.replace("\\", "/").split("/"):
        raise HTTPException(400, f"invalid clip path: {raw!r}")
    rel = Path(raw.replace("\\", "/"))
    dest = _trash_clip_file(rel)
    if dest is None:
        raise HTTPException(404, f"clip not found: {raw}")
    _delete_tag_entry(raw)
    _delete_beat_entry(raw)
    _delete_clip_gender(raw)
    observer.emit("clip_trashed", path=raw)
    return {"ok": True, "trashed_to": str(dest.relative_to(_animations_dir())).replace("\\", "/")}


# ────────────────────────── clip tags ──────────────────────────────────


def _load_tags() -> dict[str, list[str]]:
    f = _tags_file()
    if not f.is_file():
        return {}
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    tags = data.get("tags") if isinstance(data, dict) else None
    if not isinstance(tags, dict):
        return {}
    out: dict[str, list[str]] = {}
    for k, v in tags.items():
        if isinstance(k, str) and isinstance(v, list):
            clean = [t.strip() for t in v if isinstance(t, str) and t.strip()]
            if clean:
                out[k] = clean
    return out


def _save_json_index(path: Path, key: str, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"version": 1, key: dict(sorted(value.items()))}
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _save_tags(tags: dict[str, list[str]]) -> None:
    _save_json_index(_tags_file(), "tags", tags)


def _delete_tag_entry(clip_path: str) -> None:
    tags = _load_tags()
    if tags.pop(clip_path, None) is not None:
        _save_tags(tags)


@app.get("/clips/tags")
def list_clip_tags() -> dict[str, Any]:
    tags = _load_tags()
    return {"tags": tags, "all_tags": sorted({t for v in tags.values() for t in v})}


@app.post("/clips/tags")
def set_clip_tags(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    raw_path = body.get("path", "")
    if not isinstance(raw_path, str) or not raw_path:
        raise HTTPException(400, "path must be a non-empty string")
    _safe_clip_path(raw_path)
    raw_tags = body.get("tags", [])
    if not isinstance(raw_tags, list):
        raise HTTPException(400, "tags must be a list of strings")
    clean, seen = [], set()
    for t in raw_tags:
        if isinstance(t, str) and (s := t.strip().lower()) and s not in seen:
            seen.add(s)
            clean.append(s)
    tags = _load_tags()
    if clean:
        tags[raw_path] = clean
    else:
        tags.pop(raw_path, None)
    _save_tags(tags)
    return {"ok": True, "path": raw_path, "tags": clean}


# ────────────────────────── clip beats (motion analysis) ───────────────


def _load_beats() -> dict[str, dict[str, Any]]:
    f = _beats_file()
    if not f.is_file():
        return {}
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    beats = data.get("beats") if isinstance(data, dict) else None
    if not isinstance(beats, dict):
        return {}
    return {k: v for k, v in beats.items() if isinstance(k, str) and isinstance(v, dict)}


def _save_beats(beats: dict[str, dict[str, Any]]) -> None:
    _save_json_index(_beats_file(), "beats", beats)


def _delete_beat_entry(clip_path: str) -> None:
    beats = _load_beats()
    if beats.pop(clip_path, None) is not None:
        _save_beats(beats)


def _analyzer_script() -> Path | None:
    """The node analyzer (analyze_clip.mjs). Optional — needs node + three.
    Configurable via JWT_BODY_ANALYZER; dev default is the satellite ui/.
    Returns None when unavailable (the /analyze endpoints soft-fail; beats
    then come from whatever shipped in the asset bundle's metadata)."""
    env = os.environ.get("JWT_BODY_ANALYZER")
    if env and Path(env).is_file():
        return Path(env)
    cand = Path(__file__).resolve().parent.parent / "ui" / "analyze_clip.mjs"
    return cand if cand.is_file() else None


def _resolve_clip_for_analysis(rel: str) -> Path | None:
    base = _animations_dir()
    cand = (base / rel).resolve()
    try:
        cand.relative_to(base.resolve())
    except ValueError:
        return None
    return cand if cand.is_file() else None


async def _run_analyzer(clip_abs_path: Path) -> dict[str, Any] | None:
    script = _analyzer_script()
    if script is None:
        return None
    try:
        proc = await asyncio.create_subprocess_exec(
            "node", str(script), "--json", "--path", str(clip_abs_path),
            cwd=str(script.parent),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
    except (asyncio.TimeoutError, FileNotFoundError, OSError) as e:
        print(f"[body] analyzer spawn failed for {clip_abs_path.name}: {e}", file=sys.stderr)
        return None
    if proc.returncode != 0:
        print(f"[body] analyzer {clip_abs_path.name} rc={proc.returncode}: "
              f"{stderr.decode('utf-8', 'replace')[:200]}", file=sys.stderr)
        return None
    try:
        return json.loads(stdout.decode("utf-8"))
    except json.JSONDecodeError:
        return None


async def _analyze_one(rel_path: str, *, force: bool = False) -> dict[str, Any] | None:
    abs_path = _resolve_clip_for_analysis(rel_path)
    if abs_path is None:
        return None
    mtime = abs_path.stat().st_mtime
    beats = _load_beats()
    existing = beats.get(rel_path)
    if not force and isinstance(existing, dict) and existing.get("mtime") == mtime:
        return existing
    result = await _run_analyzer(abs_path)
    if result is None:
        return None
    entry = {
        "mtime": mtime,
        "duration": result.get("duration", 0.0),
        "tracks": result.get("tracks", 0),
        "max_intensity": result.get("max_intensity", 0.0),
        "top_bones": result.get("top_bones", []),
        "peaks": result.get("peaks", []),
    }
    if isinstance(existing, dict) and isinstance(existing.get("labels"), dict):
        entry["labels"] = {k: v for k, v in existing["labels"].items()
                           if isinstance(k, str) and isinstance(v, str) and v.strip()}
    beats[rel_path] = entry
    _save_beats(beats)
    return entry


@app.get("/clips/beats")
def list_clip_beats() -> dict[str, Any]:
    return {"beats": _load_beats()}


@app.post("/clips/beats/label")
def set_beat_label(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Set/clear a semantic label on a peak (keyed by peak time so it
    survives re-analysis). Body: {"path","t","label"}."""
    raw_path = body.get("path", "")
    if not isinstance(raw_path, str) or not raw_path:
        raise HTTPException(400, "path must be a non-empty string")
    _safe_clip_path(raw_path)
    t_raw = body.get("t")
    if not isinstance(t_raw, (int, float)):
        raise HTTPException(400, "t must be a number")
    label = body.get("label")
    if label is not None and not isinstance(label, str):
        raise HTTPException(400, "label must be a string or null")
    clean = label.strip().lower() if isinstance(label, str) else ""
    beats = _load_beats()
    entry = beats.get(raw_path)
    if not isinstance(entry, dict):
        raise HTTPException(404, f"no beats cached for {raw_path}")
    match_key = None
    for p in entry.get("peaks") or []:
        pt = p.get("t")
        if isinstance(pt, (int, float)) and abs(pt - float(t_raw)) < 0.05:
            match_key = f"{float(pt):.2f}"
            break
    if match_key is None:
        raise HTTPException(404, f"no peak at t≈{t_raw}s in {raw_path}")
    labels = dict(entry.get("labels") if isinstance(entry.get("labels"), dict) else {})
    if clean:
        labels[match_key] = clean
    else:
        labels.pop(match_key, None)
    if labels:
        entry["labels"] = labels
    else:
        entry.pop("labels", None)
    beats[raw_path] = entry
    _save_beats(beats)
    return {"ok": True, "path": raw_path, "t": float(match_key), "label": clean}


@app.post("/clips/analyze")
async def analyze_clips(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    """Analyze one clip or all. Soft-fails if the node analyzer is
    unavailable (returns the clips as 'failed' with an `analyzer` note)."""
    if _analyzer_script() is None:
        return {"ok": False, "analyzer": "unavailable (needs node + three; beats use bundled cache)",
                "analyzed": [], "skipped": [], "failed": []}
    force = bool(body.get("force"))
    single = body.get("path")
    if isinstance(single, str) and single:
        _safe_clip_path(single)
        entry = await _analyze_one(single, force=force)
        if entry is None:
            raise HTTPException(500, f"analyze failed for {single}")
        return {"ok": True, "analyzed": [single], "skipped": [], "failed": []}
    analyzed, cached, failed = [], [], []
    for entry in list_clips().get("clips", []):
        rel = entry["path"]
        if _resolve_clip_for_analysis(rel) is None:
            failed.append(rel)
            continue
        before = _load_beats().get(rel)
        result = await _analyze_one(rel, force=force)
        if result is None:
            failed.append(rel)
        elif before and before.get("mtime") == result.get("mtime") and not force:
            cached.append(rel)
        else:
            analyzed.append(rel)
    return {"ok": True, "analyzed": analyzed, "skipped": cached, "failed": failed}


# ────────────────────────── clip + character gender ────────────────────

VALID_CLIP_GENDERS = {"male", "female", "neutral"}
VALID_CHAR_GENDERS = {"male", "female"}
_KNOWN_CHARACTER_GENDERS: dict[str, str] = {
    "loom": "female", "loomy": "female", "muhammad": "male",
    "xbot": "female", "ybot": "male", "emin": "male",
    "avatar1": "female", "avatar2": "female",
}


def _load_clip_genders() -> dict[str, str]:
    f = _clip_genders_file()
    if not f.is_file():
        return {}
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    raw = data.get("genders") if isinstance(data, dict) else None
    if not isinstance(raw, dict):
        return {}
    return {k: v for k, v in raw.items()
            if isinstance(k, str) and isinstance(v, str) and v in VALID_CLIP_GENDERS}


def _save_clip_genders(genders: dict[str, str]) -> None:
    _save_json_index(_clip_genders_file(), "genders", genders)


def _load_character_meta() -> dict[str, dict[str, Any]]:
    f = _character_meta_file()
    if not f.is_file():
        return {}
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    raw = data.get("characters") if isinstance(data, dict) else None
    if not isinstance(raw, dict):
        return {}
    return {k: dict(v) for k, v in raw.items() if isinstance(k, str) and isinstance(v, dict)}


def _save_character_meta(meta: dict[str, dict[str, Any]]) -> None:
    _save_json_index(_character_meta_file(), "characters", meta)


def _guess_gender_from_name(name: str) -> str | None:
    low = name.lower()
    if "female" in low or "-f-" in low or "_f_" in low:
        return "female"
    if "male" in low or "-m-" in low or "_m_" in low:
        return "male"
    return None


def _autoseed_genders() -> tuple[int, int]:
    existing_clips = _load_clip_genders()
    clips_seeded = 0
    for entry in list_clips().get("clips", []):
        path = entry["path"]
        if path in existing_clips:
            continue
        existing_clips[path] = _guess_gender_from_name(path) or "neutral"
        clips_seeded += 1
    if clips_seeded:
        _save_clip_genders(existing_clips)
    existing_meta = _load_character_meta()
    chars_seeded = 0
    for entry in list_characters().get("characters", []):
        file = entry["file"]
        if file in existing_meta and "gender" in existing_meta[file]:
            continue
        stem = Path(file).stem.lower()
        guess = _KNOWN_CHARACTER_GENDERS.get(stem) or _guess_gender_from_name(stem)
        if guess and guess in VALID_CHAR_GENDERS:
            existing_meta.setdefault(file, {})["gender"] = guess
            chars_seeded += 1
    if chars_seeded:
        _save_character_meta(existing_meta)
    return clips_seeded, chars_seeded


def _delete_clip_gender(clip_path: str) -> None:
    g = _load_clip_genders()
    if g.pop(clip_path, None) is not None:
        _save_clip_genders(g)


@app.get("/clips/genders")
def list_clip_genders() -> dict[str, Any]:
    if not _clip_genders_file().is_file():
        _autoseed_genders()
    return {"genders": _load_clip_genders()}


@app.post("/clips/genders")
def set_clip_gender(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    raw_path = body.get("path", "")
    if not isinstance(raw_path, str) or not raw_path:
        raise HTTPException(400, "path must be a non-empty string")
    _safe_clip_path(raw_path)
    gender = body.get("gender", "")
    if gender not in VALID_CLIP_GENDERS:
        raise HTTPException(400, f"gender must be one of {sorted(VALID_CLIP_GENDERS)}")
    genders = _load_clip_genders()
    genders[raw_path] = gender
    _save_clip_genders(genders)
    return {"ok": True, "path": raw_path, "gender": gender}


@app.get("/characters/meta")
def list_character_meta() -> dict[str, Any]:
    if not _character_meta_file().is_file():
        _autoseed_genders()
    return {"characters": _load_character_meta()}


@app.post("/characters/meta")
def set_character_meta(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    file = body.get("file", "")
    if not isinstance(file, str) or not file:
        raise HTTPException(400, "file must be a non-empty string")
    gender = body.get("gender")
    if gender is not None and gender not in VALID_CHAR_GENDERS:
        raise HTTPException(400, f"gender must be one of {sorted(VALID_CHAR_GENDERS)}")
    meta = _load_character_meta()
    entry = dict(meta.get(file, {}))
    if gender is not None:
        entry["gender"] = gender
    meta[file] = entry
    _save_character_meta(meta)
    return {"ok": True, "file": file, "meta": entry}


@app.post("/characters/active")
def set_active_character(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    file = body.get("file", "")
    if not isinstance(file, str) or not file:
        raise HTTPException(400, "file must be a non-empty string")
    f = _active_character_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps({"file": file}, indent=2), encoding="utf-8")
    return {"ok": True, "file": file}


@app.get("/characters/active")
def get_active_character() -> dict[str, Any]:
    f = _active_character_file()
    if not f.is_file():
        return {"file": ""}
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
        return {"file": data.get("file", "") if isinstance(data, dict) else ""}
    except (OSError, json.JSONDecodeError):
        return {"file": ""}


# ────────────────────────── open folder (desktop) ──────────────────────


def _safe_character_file(name: str) -> Path:
    if not name or any(c in name for c in ("/", "\\", "..")):
        raise HTTPException(400, f"invalid character name: {name!r}")
    if not name.lower().endswith(".glb"):
        raise HTTPException(400, "extract/repack only supports .glb characters")
    p = _characters_dir() / name
    if not p.is_file():
        raise HTTPException(404, f"character not found: {name}")
    return p


def _textures_dir_for(glb_path: Path) -> Path:
    return glb_path.parent / f"_textures_{glb_path.stem.lower()}"


def _open_in_file_manager(target: Path) -> None:
    if not target.is_dir():
        raise HTTPException(404, f"folder not found on disk: {target}")
    try:
        if sys.platform == "win32":
            os.startfile(str(target))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(target)])
        else:
            subprocess.Popen(["xdg-open", str(target)])
    except OSError as e:
        raise HTTPException(500, f"failed to open folder: {e}") from e


@app.post("/open_folder")
def open_folder(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    target_name = (body.get("target") or "animations").strip()
    if target_name == "animations":
        target = _animations_dir()
    elif target_name == "characters":
        target = _characters_dir()
    elif target_name == "character_textures":
        file_name = body.get("file") or ""
        if not isinstance(file_name, str) or not file_name:
            raise HTTPException(400, "character_textures target needs `file`")
        target = _textures_dir_for(_safe_character_file(file_name))
        if not target.is_dir():
            raise HTTPException(404, f"no textures dir for {file_name} — run extract first")
    else:
        raise HTTPException(400, f"unknown target: {target_name!r}")
    _open_in_file_manager(target)
    return {"ok": True, "path": str(target).replace("\\", "/")}


@app.post("/clips/open_folder")
def open_clips_folder() -> dict[str, Any]:
    target = _animations_dir()
    _open_in_file_manager(target)
    return {"ok": True, "path": str(target).replace("\\", "/")}


# ────────────────────────── GLB texture tools ([textures] extra) ───────


def _glbtools():
    """Lazy-import the vendored glb tools. 503 if the optional extra
    (Pillow + numpy) isn't installed — keeps the base satellite lean."""
    try:
        from .glbtools import glb_extract_textures, glb_pack, texture_filters
    except ImportError as e:
        raise HTTPException(
            503, f"texture tools unavailable — install with: pip install yz-body[textures] ({e})"
        ) from e
    return glb_extract_textures, glb_pack, texture_filters


# Material-category classifier (skin/top/bottom/hair/iris) — substring match,
# specific-first.
_MATERIAL_CATEGORY_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("skin", ("skin",)),
    ("hair", ("hair",)),
    ("top", ("top", "shirt", "tshirt", "jacket")),
    ("bottom", ("bottom", "pants", "trouser", "leg")),
    ("footwear", ("footwear", "shoe", "boot")),
    ("iris", ("eye", "iris")),
]


def _classify_materials(gltf: dict) -> dict[str, dict[str, Any]]:
    materials = gltf.get("materials", [])
    textures = gltf.get("textures", [])
    out: dict[str, dict[str, Any]] = {}
    for mat in materials:
        name = (mat.get("name") or "").lower()
        pbr = mat.get("pbrMetallicRoughness", {})
        for category, keywords in _MATERIAL_CATEGORY_KEYWORDS:
            if category in out or not any(kw in name for kw in keywords):
                continue
            entry: dict[str, Any] = {"material": mat.get("name")}
            bct = pbr.get("baseColorTexture")
            if bct and "index" in bct:
                img_idx = textures[bct["index"]].get("source")
                if img_idx is not None:
                    entry["image_index"] = img_idx
                    entry["mode"] = "texture"
            if "image_index" not in entry and pbr.get("baseColorFactor") is not None:
                entry["mode"] = "factor"
                entry["baseColorFactor"] = pbr["baseColorFactor"]
            if "mode" in entry:
                out[category] = entry
            break
    return out


def _is_atlas_baked(gltf: dict) -> bool:
    materials = gltf.get("materials", [])
    textures = gltf.get("textures", [])
    used: dict[int, int] = {}
    for mat in materials:
        bct = mat.get("pbrMetallicRoughness", {}).get("baseColorTexture")
        if not bct or "index" not in bct:
            continue
        img_idx = textures[bct["index"]].get("source")
        if img_idx is not None:
            used[img_idx] = used.get(img_idx, 0) + 1
    return bool(used) and max(used.values()) >= 3


@app.get("/character/appearance")
def character_appearance_info(file: str) -> dict[str, Any]:
    extractor, _pack, _filters = _glbtools()
    glb_path = _safe_character_file(file)
    gltf, _ = extractor.parse_glb(glb_path)
    categories = _classify_materials(gltf)
    return {
        "ok": True,
        "file": file,
        "atlas_baked": _is_atlas_baked(gltf),
        "categories": {k: {"material": v.get("material"), "mode": v.get("mode")}
                       for k, v in categories.items()},
    }


@app.post("/character/extract")
def character_extract_textures(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    extractor, _pack, _filters = _glbtools()
    name = body.get("file", "")
    if not isinstance(name, str):
        raise HTTPException(400, "file must be a string")
    glb_path = _safe_character_file(name)
    out_dir = _textures_dir_for(glb_path)
    sidecar = extractor.extract(glb_path, out_dir, verbose=False)
    return {"ok": True, "source": name, "dir": str(out_dir).replace("\\", "/"),
            "images": sidecar.get("images", []), "material_refs": sidecar.get("material_refs", [])}


@app.post("/character/repack")
def character_repack(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    _extractor, packer, _filters = _glbtools()
    name = body.get("file", "")
    if not isinstance(name, str):
        raise HTTPException(400, "file must be a string")
    glb_path = _safe_character_file(name)
    out_name = body.get("out") or f"{glb_path.stem}_repacked.glb"
    if not isinstance(out_name, str) or any(c in out_name for c in ("/", "\\", "..")) \
            or not out_name.lower().endswith(".glb"):
        raise HTTPException(400, f"invalid out name: {out_name!r}")
    tex_dir = _textures_dir_for(glb_path)
    if not tex_dir.is_dir():
        raise HTTPException(404, f"no textures dir for {name} — run extract first")
    out_path = glb_path.parent / out_name
    summary = packer.pack(glb_path, tex_dir, out_path, verbose=False)
    return {"ok": True, "source": name, "out": out_name, "out_path": str(out_path).replace("\\", "/"),
            "images_total": summary.get("images_total", 0),
            "images_replaced": summary.get("images_replaced", 0), "bytes": summary.get("bytes", 0)}


@app.post("/character/customize")
def character_customize(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    extractor, packer, filters = _glbtools()
    name = body.get("file", "")
    if not isinstance(name, str):
        raise HTTPException(400, "file must be a string")
    cust_raw = body.get("customizations") or {}
    if not isinstance(cust_raw, dict):
        raise HTTPException(400, "customizations must be an object")
    glb_path = _safe_character_file(name)
    gltf, blob = extractor.parse_glb(glb_path)
    if _is_atlas_baked(gltf):
        raise HTTPException(400, "atlas-baked asset — appearance customization not supported")
    categories = _classify_materials(gltf)
    image_overrides: dict[int, bytes] = {}
    material_overrides: dict[str, dict] = {}
    applied: list[dict[str, Any]] = []

    def _srgb_to_lin(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    for category, payload in cust_raw.items():
        if not isinstance(payload, dict):
            continue
        info = categories.get(category)
        if not info:
            applied.append({"category": category, "skipped": "no matching material"})
            continue
        if info["mode"] == "texture":
            img_idx = info["image_index"]
            img_meta = gltf["images"][img_idx]
            bv = gltf["bufferViews"][img_meta["bufferView"]]
            start = bv.get("byteOffset", 0)
            orig = blob[start:start + bv["byteLength"]]
            if category == "skin":
                new_bytes = filters.skin_filter(
                    orig, (payload.get("preset") or "medium").lower(),
                    float(payload.get("tone") or 0.0), payload.get("color"))
            elif category == "iris":
                if not payload.get("color"):
                    continue
                new_bytes = filters.colorize(orig, payload["color"], sat_floor=0.15)
            else:
                if not payload.get("color"):
                    continue
                new_bytes = filters.colorize(orig, payload["color"])
            image_overrides[img_idx] = new_bytes
            applied.append({"category": category, "image_index": img_idx})
        elif info["mode"] == "factor":
            color = payload.get("color")
            if not color:
                continue
            h = color.lstrip("#")
            if len(h) == 3:
                h = "".join(c * 2 for c in h)
            if len(h) != 6:
                applied.append({"category": category, "skipped": f"bad color: {color}"})
                continue
            material_overrides[info["material"]] = {"baseColorFactor": [
                _srgb_to_lin(int(h[0:2], 16) / 255.0),
                _srgb_to_lin(int(h[2:4], 16) / 255.0),
                _srgb_to_lin(int(h[4:6], 16) / 255.0), 1.0]}
            applied.append({"category": category, "material": info["material"]})

    out_path = glb_path.parent / f"{glb_path.stem}_custom.glb"
    summary = packer.pack(glb_path, None, out_path, image_overrides=image_overrides,
                          material_overrides=material_overrides, verbose=False)
    return {"ok": True, "source": name, "out": out_path.name,
            "out_path": str(out_path).replace("\\", "/"), "applied": applied,
            "images_replaced": summary.get("images_replaced", 0),
            "materials_overridden": summary.get("materials_overridden", 0),
            "bytes": summary.get("bytes", 0)}


# ────────────────────────── lifecycle / settings / events ──────────────


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "version": __version__,
        "python": sys.version.split()[0],
        "platform": sys.platform,
        "data_root": str(settings.data_root),
        "assets_present": _assets_present(),
    }


@app.get("/catalog")
def catalog() -> dict:
    """Prompt contribution for JarvYZ's `onPromptBuild` hook. JarvYZ fetches
    this (and caches it with a short TTL) when the body dashboard is the
    active dashboard, appending `text` to the Loom persona overlay so Loom
    knows which gestures it can trigger. The whole motion catalog — static
    how-to prose + the live tagged-clips + beats sections, rig/gender
    filtered to the active character — is owned and assembled HERE."""
    from . import catalog as _catalog
    return {"text": _catalog.build_catalog()}


# ────────────────────────── lipsync (NeuroSync viseme) model ────────────
# The NeuroSync viseme engine runs IN-CORE (the producer reads TTS audio there);
# these routes only manage its WEIGHTS file on disk (status / one-click install /
# download progress), so they import the TORCH-FREE `lipsync.model_io` — the
# satellite process never loads torch or the ~942MB model. JarvYZ proxies them
# at /api/body/lipsync/*. The engine SELECTION (amplitude|neurosync) is the
# `lipsync_engine` satellite setting, toggled via core PATCH /api/satellites/body.

@app.get("/lipsync/model")
def lipsync_model_status() -> dict:
    """Setup/check for the NeuroSync weights: present?, where?, at the stable
    location?, plus live download progress when install() is fetching them."""
    from .lipsync import model_io
    return model_io.model_status()


@app.post("/lipsync/install")
def lipsync_install() -> dict:
    """One-click NeuroSync setup: promote a local model to the stable
    ~/.jarvyz/models/neurosync/ path if one exists, else start a background
    download of the MIT weights. Progress reported via GET /lipsync/model."""
    from .lipsync import model_io
    return model_io.install()


@app.get("/settings")
def get_settings() -> dict:
    return {"data_root": str(settings.data_root), "assets_url": settings.assets_url}


@app.patch("/settings")
def patch_settings(patch: dict = Body(...)) -> dict:
    _persist.apply_patch(patch)
    return {"data_root": str(settings.data_root), "assets_url": settings.assets_url}


@app.websocket("/events")
async def events_ws(ws: WebSocket) -> None:
    await ws.accept()
    q = observer.subscribe()
    try:
        await ws.send_json({"event": "body", "kind": "hello"})
        while True:
            await ws.send_json(await q.get())
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        observer.unsubscribe(q)


# ────────────────────────── asset bytes (GLB/FBX) ──────────────────────
# The browser's GLTF/FBX loaders fetch the raw character + animation files
# from here. Mounted BEFORE the SPA catch-all so `/assets/...` resolves to
# the on-disk library rather than index.html. The dir is created eagerly so
# the mount succeeds even before download-on-first-run has populated it (a
# missing file just 404s; `_ensure_assets()` fills it lazily on the first
# /characters or /clips scan).
_assets_mount = settings.assets_dir
_assets_mount.mkdir(parents=True, exist_ok=True)
app.mount("/assets", StaticFiles(directory=str(_assets_mount)), name="assets")


# ────────────────────────── SPA mount (last) ───────────────────────────

_static_dir = Path(__file__).parent / "static"
_static_dir.mkdir(parents=True, exist_ok=True)
app.mount("/", StaticFiles(directory=str(_static_dir), html=True), name="static")


# ────────────────────────── entrypoint ─────────────────────────────────


def main() -> None:
    """`python -m yz_body` entry point."""
    import uvicorn

    host = os.environ.get("BODY_HOST", "127.0.0.1")
    # YZ_PORT (core-resolved, settings.ports) wins; BODY_PORT + default for standalone.
    port = int(os.environ.get("YZ_PORT") or os.environ.get("BODY_PORT") or "9005")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
