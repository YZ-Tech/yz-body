import { produce } from 'immer'
import { targetRigFor } from '../avatar/engine/rigRemap'
import type { IStore } from './useStore'

/** Per-character clip pools. Replaces the standalone useBodyClipPools
 *  hook. Layout: a map from source-character filename → pools-by-mode.
 *  Pools are seeded from the gender-appropriate defaults on first read
 *  for a fresh character.
 *
 *  Persisted under the unified `jarvyz-storage` key. The old layout
 *  was one localStorage entry per character (`body.clipPools.<file>`)
 *  plus a legacy global key (`body.clipPools`); the seed below scans
 *  all of those once and loads them into the map. */

export type BodyMode = 'idle' | 'listening' | 'thinking' | 'speaking' | 'boot'
export type BodyClipPools = Record<BodyMode, string[]>
export type BodyPoolsMap = Record<string, BodyClipPools>

// All defaults reference Mixamo-era .fbx/.glb clips that now live under
// _private_assets/animations/ (auto-mirrored to /body/animations/private/).
// New Quaternius UAL clips ship at the unprefixed top-level groups and
// can be added per-character via the picker.
export const Body_DEFAULT_POOLS_FEMALE: BodyClipPools = {
  boot: [],
  idle: ['private/Idle/idle.fbx', 'private/Idle/catwalk-idle.fbx', 'private/Idle/female-idle.glb'],
  listening: [
    'private/Greetings/acknowledging.fbx',
    'private/Nods/thoughtful-head-nod.fbx',
    'private/Idle/idle.fbx',
  ],
  thinking: ['private/Shakes/thoughtful-head-shake.fbx'],
  speaking: [
    'private/Talking/talking.fbx',
    'private/Talking/talking-1.fbx',
    'private/Talking/talking-variation-003.glb',
  ],
}

export const Body_DEFAULT_POOLS_MALE: BodyClipPools = {
  boot: [],
  idle: [
    'private/Idle/male-idle.fbx',
    'private/Idle/male-breathing-idle.fbx',
    'private/Idle/male-neutral-idle.fbx',
    'private/Idle/male-happy-idle.fbx',
  ],
  // Greetings / nods / shakes / talking are currently female-tagged in
  // the genders index but read as gender-neutral motion-wise; we use
  // them here too because the runtime falls back to the unfiltered
  // pool when the gender filter empties it, so they'll still play.
  // Re-tag the relevant clips to `neutral` in BodySettings and the
  // filter will permit them cleanly.
  listening: [
    'private/Idle/male-idle.fbx',
    'private/Greetings/acknowledging.fbx',
    'private/Nods/thoughtful-head-nod.fbx',
  ],
  thinking: [
    'private/Idle/male-breathing-idle.fbx',
    'private/Shakes/thoughtful-head-shake.fbx',
  ],
  speaking: [
    'private/Talking/talking.fbx',
    'private/Talking/talking-1.fbx',
    'private/Talking/talking-variation-003.glb',
  ],
}

// ── Quaternius defaults ───────────────────────────────────────────────
// BotM / BotF (Quaternius UAL rig) can't play the private Mixamo clips
// — bind poses don't match. They need their own pools pointing at the
// UAL clips extracted into the public groups. Quaternius's mannequins
// share one skeleton, so male/female use the same pool set; both
// constants exist for API symmetry with the Mixamo female/male pair.
//
// Per STRICT-LINE POLICY (see rigRemap.ts): each rig only plays its
// own native clips. If you switch BotM to a clip path that doesn't
// exist or belongs to the wrong rig, the mixer silently drops the
// tracks and the character stays at rest.
export const Body_DEFAULT_POOLS_QUATERNIUS_FEMALE: BodyClipPools = {
  boot: [
    'Idle/UAL1_A_TPose.glb',
    'Locomotion/UAL1_Walk_Loop.glb',
  ],
  idle: ['Idle/UAL1_Idle_Loop.glb'],
  listening: ['Idle/UAL2_Idle_FoldArms_Loop.glb'],
  thinking: ['Idle/UAL2_Idle_FoldArms_Loop.glb'],
  speaking: ['Idle/UAL1_Idle_Talking_Loop.glb'],
}

/** Same as Quaternius female — UAL's mannequins share the rig and we
 *  don't have gender-specific UAL clips. Keeping a separate constant
 *  preserves the parallel structure to the Mixamo female/male pair. */
export const Body_DEFAULT_POOLS_QUATERNIUS_MALE: BodyClipPools =
  Body_DEFAULT_POOLS_QUATERNIUS_FEMALE

/** Back-compat alias — older imports still resolve `Body_DEFAULT_POOLS`. */
export const Body_DEFAULT_POOLS: BodyClipPools = Body_DEFAULT_POOLS_FEMALE

const LEGACY_PREFIX = 'body.clipPools.'
const LEGACY_GLOBAL = 'body.clipPools'
const LEGACY_SCHEMA = 'body.clipPools.schema'

/** Normalize the `_custom` suffix to its source character so
 *  Loom.glb and Loom_custom.glb share one pool. */
export const sourceCharacterOf = (file: string): string =>
  file.endsWith('_custom.glb') ? file.replace('_custom.glb', '.glb') : file

export const defaultPoolsForGender = (
  gender: 'male' | 'female' | undefined,
): BodyClipPools => (gender === 'male' ? Body_DEFAULT_POOLS_MALE : Body_DEFAULT_POOLS_FEMALE)

/** Pick the default pool set for a character based on its rig AND
 *  gender. BotM/BotF (Quaternius) get UAL-based pools; everyone else
 *  (Loom, Yeon, private characters) keeps the Mixamo private/ pools.
 *
 *  Use this instead of `defaultPoolsForGender` everywhere the active
 *  character is known — otherwise BotM seeds with Mixamo clips that
 *  silently no-op on its Quaternius skeleton. */
export const defaultPoolsForCharacter = (
  characterFile: string,
  gender: 'male' | 'female' | undefined,
): BodyClipPools => {
  const rig = targetRigFor(characterFile)
  if (rig === 'quaternius') {
    return gender === 'male'
      ? Body_DEFAULT_POOLS_QUATERNIUS_MALE
      : Body_DEFAULT_POOLS_QUATERNIUS_FEMALE
  }
  return defaultPoolsForGender(gender)
}

const sanitizePools = (parsed: any): BodyClipPools | null => {
  if (!parsed || typeof parsed !== 'object') return null
  const out: BodyClipPools = {
    boot: Array.isArray(parsed.boot) ? parsed.boot : [],
    idle: Array.isArray(parsed.idle) ? parsed.idle : [],
    listening: Array.isArray(parsed.listening) ? parsed.listening : [],
    thinking: Array.isArray(parsed.thinking) ? parsed.thinking : [],
    speaking: Array.isArray(parsed.speaking) ? parsed.speaking : [],
  }
  return out
}

/** Scan legacy `body.clipPools.*` entries and load them into the map.
 *  Only honors entries whose schema version matches — older schemas
 *  (v1 bare filenames, v2 folder-prefixed pre-per-character) get
 *  ignored so each character re-seeds from gender defaults at runtime.
 *  We don't delete the legacy keys here — that can happen in a later
 *  numbered migration once we trust the new shape. */
const seedFromLegacy = (): BodyPoolsMap => {
  const map: BodyPoolsMap = {}
  try {
    const schemaVersion = localStorage.getItem(LEGACY_SCHEMA)
    if (schemaVersion !== '3') {
      // Old schema or missing — skip seeding. Each character re-seeds
      // from gender defaults on first edit.
      return map
    }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(LEGACY_PREFIX)) continue
      if (k === LEGACY_SCHEMA) continue
      if (k === LEGACY_GLOBAL) continue
      const charFile = k.slice(LEGACY_PREFIX.length)
      try {
        const raw = localStorage.getItem(k)
        if (!raw) continue
        const parsed = sanitizePools(JSON.parse(raw))
        if (parsed) map[charFile] = parsed
      } catch {
        /* corrupted entry — skip */
      }
    }
  } catch {
    /* localStorage disabled — nothing to seed */
  }
  return map
}

const storeBodyPools = (set: any) => ({
  bodyPools: seedFromLegacy() as BodyPoolsMap,

  setBodyPool: (characterFile: string, mode: BodyMode, clips: string[]): void => {
    const key = sourceCharacterOf(characterFile)
    set(
      produce((s: IStore) => {
        const existing = s.bodyPools[key] ?? defaultPoolsForGender(undefined)
        s.bodyPools[key] = { ...existing, [mode]: clips }
      }),
      false,
      'bodyPools/setMode',
    )
  },

  /** Replace the entire per-character pool. Used when a character is
   *  first encountered and we want to write the gender-seed back so
   *  subsequent reads don't re-derive from defaults. */
  setBodyPoolAll: (characterFile: string, pools: BodyClipPools): void => {
    const key = sourceCharacterOf(characterFile)
    set(
      produce((s: IStore) => {
        s.bodyPools[key] = pools
      }),
      false,
      'bodyPools/setAll',
    )
  },

  /** Drop the per-character override so reads fall back to the gender
   *  default. */
  resetBodyPool: (characterFile: string): void => {
    const key = sourceCharacterOf(characterFile)
    set(
      produce((s: IStore) => {
        delete s.bodyPools[key]
      }),
      false,
      'bodyPools/reset',
    )
  },
})

export default storeBodyPools
