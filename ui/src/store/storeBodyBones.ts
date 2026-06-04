import { produce } from 'immer'
import type { IStore } from './useStore'

/** Live skeleton bone names — BodyAvatar publishes the full bone list
 *  on each character load; BodySettings reads it to populate the
 *  bone-name Autocomplete in the overlay editor. Replaces the orphan
 *  `body.bones` + `body.bones.change` ad-hoc localStorage + window-event
 *  channel. */

/** Standard Mixamo bone names — fallback when BodyAvatar hasn't
 *  published the live skeleton yet (first paint before character
 *  loads). */
export const Body_FALLBACK_BONES: string[] = [
  'Hips',
  'Spine',
  'Spine1',
  'Spine2',
  'Neck',
  'Head',
  'HeadTop_End',
  'LeftEye',
  'RightEye',
  'LeftShoulder',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightShoulder',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
]

const LEGACY_KEY = 'body.bones'

const seedFromLegacy = (): string[] => {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        return parsed
      }
    }
  } catch {
    /* localStorage disabled — fall through */
  }
  return Body_FALLBACK_BONES
}

const storeBodyBones = (set: any) => ({
  bodyBones: seedFromLegacy(),

  /** Union of all morph target names present on the current character
   *  (across all face/head/teeth meshes). Published alongside bones
   *  by BodyAvatar's discoverBonesAndMorphs; used by the rig-compat
   *  Autocompletes so users pick from what the model actually has. */
  bodyMorphs: [] as string[],

  setBodyBones: (bones: string[]): void =>
    set(
      produce((s: IStore) => {
        s.bodyBones = bones
      }),
      false,
      'bodyBones/set',
    ),

  setBodyMorphs: (morphs: string[]): void =>
    set(
      produce((s: IStore) => {
        s.bodyMorphs = morphs
      }),
      false,
      'bodyMorphs/set',
    ),
})

export default storeBodyBones
