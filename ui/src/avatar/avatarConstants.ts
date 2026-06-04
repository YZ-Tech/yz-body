/** Engineering tuning + path constants for the body avatar.
 *  User-tunable "feel" knobs and rig-compatibility candidate lists
 *  live in `lib/body/behavior.ts` and are configurable per-character
 *  via the Behavior settings panel. */

import { assetUrl } from '../lib/assetBase'

/** Resolve a character file (e.g. "Loom.glb", optionally with a cache-bust
 *  query) to a fetchable URL under the satellite's /assets mount. */
export const characterUrl = (file: string): string => assetUrl(`characters/${file}`)

/** Resolve an animation clip (relative POSIX path under animations/,
 *  optionally with a query suffix) to a fetchable URL. */
export const animUrl = (clip: string): string => assetUrl(`animations/${clip}`)

/** GLB characters are 1 unit = 1 meter; Mixamo FBX animations are 1 unit
 *  = 1 cm. Scaling GLB characters 100× lets the animation hip tracks
 *  land at sensible heights. FBX characters are already Mixamo-native
 *  so they stay at scale 1. */
export const CHARACTER_SCALE = 100

// ── Gaze / saccades ─────────────────────────────────────────────────────
export const GAZE_LERP = 0.18
export const GAZE_YAW_MAX = 0.45
export const GAZE_PITCH_MAX = 0.30
export const SACCADE_MIN_MS = 700
export const SACCADE_MAX_MS = 2200
/** Rotate the head this fraction of gaze magnitude when no eye bones exist. */
export const HEAD_FALLBACK_SCALE = 0.45
export const JAW_BONE_MAX_RAD = 0.32

// ── Blink ───────────────────────────────────────────────────────────────
export const BLINK_DURATION_MS = 280

// ── Camera ──────────────────────────────────────────────────────────────
export const CAMERA_TWEEN_MS = 550

// ── Lipsync ─────────────────────────────────────────────────────────────
export const LIPSYNC_LERP = 0.35
