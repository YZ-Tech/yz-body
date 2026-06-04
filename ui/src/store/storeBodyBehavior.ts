import { produce } from 'immer'
import type { BodyBehavior } from '../lib/body/behavior'
import type { IStore } from './useStore'

/** Per-character behavior overrides. Keyed by SOURCE character file
 *  (Loom.glb, not Loom_custom.glb) so re-baked appearance variants
 *  share one entry. Missing entries fall back to DEFAULT_Body_BEHAVIOR
 *  via `effectiveBehavior()`. */

export type { BodyBehavior }
export type BodyBehaviorMap = Record<string, BodyBehavior>

const sourceCharacterOf = (file: string): string =>
  file.endsWith('_custom.glb') ? file.replace('_custom.glb', '.glb') : file

const storeBodyBehavior = (set: any) => ({
  bodyBehavior: {} as BodyBehaviorMap,

  setBodyBehavior: (characterFile: string, patch: Partial<BodyBehavior>): void => {
    const key = sourceCharacterOf(characterFile)
    set(
      produce((s: IStore) => {
        s.bodyBehavior[key] = { ...(s.bodyBehavior[key] ?? {}), ...patch }
      }),
      false,
      'bodyBehavior/set',
    )
  },

  clearBodyBehavior: (characterFile: string): void => {
    const key = sourceCharacterOf(characterFile)
    set(
      produce((s: IStore) => {
        delete s.bodyBehavior[key]
      }),
      false,
      'bodyBehavior/clear',
    )
  },

  /** Reset a single group ('feel' or 'rig') of overrides for one
   *  character — used by the per-group reset buttons in the UI. */
  resetBodyBehaviorGroup: (characterFile: string, group: 'feel' | 'rig'): void => {
    const key = sourceCharacterOf(characterFile)
    set(
      produce((s: IStore) => {
        const cur = s.bodyBehavior[key]
        if (!cur) return
        if (group === 'feel') {
          delete cur.blinkIntervalMinMs
          delete cur.blinkIntervalMaxMs
          delete cur.saccadeAmplitude
          delete cur.lipsyncGain
          delete cur.lipsyncMax
          delete cur.repickAfterS
          delete cur.crossfadeS
        } else {
          delete cur.eyeBoneCandidates
          delete cur.blinkMorphNames
          delete cur.jawMorphCandidates
        }
        // Drop the entry entirely if it became empty so the persisted
        // map stays tidy.
        if (Object.keys(cur).length === 0) delete s.bodyBehavior[key]
      }),
      false,
      'bodyBehavior/resetGroup',
    )
  },
})

export default storeBodyBehavior
