import { produce } from 'immer'
import type {
  AppearanceCust,
  ColorCust,
  SkinCust,
} from '../lib/body/appearance'
import type { IStore } from './useStore'

/** Per-character appearance customizations (skin / clothing / hair /
 *  iris). State is keyed by the SOURCE character (Loom.glb, not
 *  Loom_custom.glb) so re-opening the dialog after Apply still shows
 *  the active edits. Replaces the direct `body.appearance.<file>`
 *  localStorage reads/writes scattered through BodySettings.
 *
 *  Seeds from legacy `body.appearance.<file>` keys by scanning
 *  localStorage at boot. Old keys aren't deleted (can be cleaned up
 *  in a later numbered migration once the new shape is trusted).
 *
 *  Types + palette constants live in `lib/body/appearance.ts` —
 *  re-exported here so existing consumer call sites keep working. */

export type { AppearanceCust, ColorCust, SkinCust }

export type BodyAppearanceMap = Record<string, AppearanceCust>

const LEGACY_PREFIX = 'body.appearance.'

const sanitize = (parsed: any): AppearanceCust | null => {
  if (!parsed || typeof parsed !== 'object') return null
  return parsed as AppearanceCust
}

const seedFromLegacy = (): BodyAppearanceMap => {
  const map: BodyAppearanceMap = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(LEGACY_PREFIX)) continue
      const charFile = k.slice(LEGACY_PREFIX.length)
      try {
        const raw = localStorage.getItem(k)
        if (!raw) continue
        const parsed = sanitize(JSON.parse(raw))
        if (parsed) map[charFile] = parsed
      } catch {
        /* corrupted entry — skip */
      }
    }
  } catch {
    /* localStorage disabled — empty map */
  }
  return map
}

/** Normalize `_custom.glb` to the source character so Loom.glb and
 *  Loom_custom.glb share one appearance entry. */
const sourceCharacterOf = (file: string): string =>
  file.endsWith('_custom.glb') ? file.replace('_custom.glb', '.glb') : file

const storeBodyAppearance = (set: any) => ({
  bodyAppearance: seedFromLegacy() as BodyAppearanceMap,

  setBodyAppearance: (characterFile: string, next: AppearanceCust): void => {
    const key = sourceCharacterOf(characterFile)
    set(
      produce((s: IStore) => {
        s.bodyAppearance[key] = next
      }),
      false,
      'bodyAppearance/set',
    )
  },

  clearBodyAppearance: (characterFile: string): void => {
    const key = sourceCharacterOf(characterFile)
    set(
      produce((s: IStore) => {
        delete s.bodyAppearance[key]
      }),
      false,
      'bodyAppearance/clear',
    )
  },
})

export default storeBodyAppearance
