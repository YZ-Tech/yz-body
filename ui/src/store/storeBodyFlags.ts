import { produce } from 'immer'
import type { IStore } from './useStore'

/** Boolean / scalar feature flags for the body avatar that don't belong
 *  in the clip-pool map. Replaces the standalone useBodyFlags hook. */

/** Visual rendering style for the character meshes.
 *  - `realistic`: original PBR materials baked into the GLB (default)
 *  - `wireframe`: all meshes replaced with a cyan wireframe material —
 *    same aesthetic family as v11
 *  - `hologram`: semi-transparent cyan emissive material — "AI projection" */
export type BodyRenderStyle = 'realistic' | 'wireframe' | 'hologram'

/** Opt-in spatial visualization of WLED devices in the 3D canvas. Each
 *  device with a configured `point_at` becomes a colored glowing orb at
 *  that position in scene-space, optionally illuminating the avatar.
 *  - `off`: nothing rendered (default)
 *  - `subtle`: small markers + low-intensity PointLights — tasteful
 *  - `full`: larger markers + strong PointLights — avatar visibly stands
 *    in the room's lighting */
export type BodyRoomLighting = 'off' | 'subtle' | 'full'

export interface BodyFlags {
  /** Which character GLB to load. File name relative to /body/characters/. */
  characterFile: string
  /** When true, the eyes (or head fallback) track the pointer and emit
   *  saccades. When false, gaze stays forward — useful for screenshots
   *  or anytime the cursor-following reads as creepy rather than alive. */
  eyeTracking: boolean
  /** When true, the avatar blinks at random intervals (2-6s) using the
   *  eyeBlinkLeft/Right ARKit morph targets. Off = no blinks (mannequin). */
  eyeBlink: boolean
  /** Which material swap to apply to the character meshes. See type. */
  renderStyle: BodyRenderStyle
  /** Spatial WLED visualization mode. See type. */
  roomLighting: BodyRoomLighting
}

export const Body_DEFAULT_FLAGS: BodyFlags = {
  // Default until the user picks a different one in settings. The
  // dynamic character roster (useBodyCharacters) overrides this view
  // once it fetches — and if this file no longer exists on disk, the
  // Select will warn (out-of-range value) until the user picks one.
  // Loom is the most commonly-used character in this project.
  characterFile: 'Loom.glb',
  eyeTracking: false,
  eyeBlink: true,
  renderStyle: 'realistic',
  roomLighting: 'off',
}

const LEGACY_KEY = 'body.flags'

const seedFromLegacy = (): BodyFlags => {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (raw) return { ...Body_DEFAULT_FLAGS, ...JSON.parse(raw) }
  } catch {
    /* localStorage disabled / corrupted — keep defaults */
  }
  return Body_DEFAULT_FLAGS
}

const storeBodyFlags = (set: any) => ({
  bodyFlags: seedFromLegacy(),

  setBodyFlags: (patch: Partial<BodyFlags>): void =>
    set(
      produce((s: IStore) => {
        Object.assign(s.bodyFlags, patch)
      }),
      false,
      'bodyFlags/set',
    ),
})

export default storeBodyFlags
