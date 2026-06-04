<!-- ─────────────────────────── JARVYZ SATELLITE ─────────────────────────── -->

<p align="left">
  <img src="ui/public/logo.svg" alt="JarvYZ" width="200">
</p>

> `yz-body` — JarvYZ's 3D full-body avatar (render engine + motion clips + lipsync)

[![JarvYZ](https://img.shields.io/badge/JARVYZ-Satellite-blue.svg?logoColor=white)](../../README.md)

JarvYZ's **body**: a rigged 3D character — three.js render engine, animation-clip
library, and the motion / lipsync / WLED-pointing systems — surfaced in JarvYZ as
**dashboard variant 13**. (Where musetalk is JarvYZ's photoreal *face*, this is
the full articulated *body* — it gestures, points, crouches, dances.)

Like the other satellites it is a self-contained service (`python -m yz_body`,
HTTP API + bundled SPA) plus a dynamic-module IIFE that JarvYZ loads at runtime.
Unlike the others it is the **app's centerpiece**, so the extraction is staged
build-alongside-then-switch — the in-core avatar keeps working until the
satellite is verified.

## Status

**Scaffolding (Stage 1).** Mid-extraction from JarvYZ core (was the internal
`v13` codename); see the staged plan in the JarvYZ working notes. Not yet
functional standalone.

## Boundary (what lives here — renamed v13 → body on copy)

| Layer | Source (pre-extraction) |
|---|---|
| Render engine | `frontend/src/pages/Face/components/V13/engine/*` |
| Avatar logic | `frontend/src/lib/v13/*` |
| Hooks | `frontend/src/lib/hooks/useV13*` |
| Dashboard UI | `frontend/src/pages/Face/components/V13/*` → export `BodyDashboard` |
| Backend API | `backend/jarvyz/web/api/v13.py` → `yz_body/server.py` (`/api/body`) |
| Clip tooling | `frontend/analyze_clip.mjs`, `analyze_aim.mjs` |
| Assets (~162M) | `public/v13/` characters + animations + clip metadata |

## Seams to JarvYZ core (kept, not extracted)

- **Motion / point dispatch** — core emits `ui_command action=play_body_motion`
  (from a Loom reply's `motion`/`motions` field) and `action=play_body_point`
  (from a single-target WLED tool, so the body points at the light). The
  satellite *subscribes*; no satellite-contributed LLM tools.
- **Motion catalog → Loom prompt** — the satellite *contributes* its motion
  catalog (Stage 4 refactor of `pipeline/llm_external.py`).
- **Lipsync** ← core speech/viseme events. **WLED lighting** ← the `wled` store.

## Settled design points

- **Asset distribution: download-on-first-run.** The ~162M of `.glb` are fetched
  into `~/.jarvyz/satellites/body/assets/` from a release-hosted bundle on first
  boot — never in the wheel or the git tree. (Only public assets; `private/`
  stays out.)
- **Clip analyzer: deferred.** Not built during extraction (its trigger is
  ~80-100 clips; we're at ~40). The catalog interface is shaped to accept a
  generated manifest later without re-plumbing. See `_docs/CLIP_ANALYZER_PLAN.md`.
- **Variant slot stays `13`** — an internal registry index, not a name.
