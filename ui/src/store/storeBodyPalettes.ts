import { produce } from 'immer'
import {
  DEFAULT_CLOTHING_PALETTE,
  DEFAULT_HAIR_PALETTE,
  DEFAULT_IRIS_PALETTE,
  DEFAULT_SKIN_PRESETS,
} from '../lib/body/appearance'
import type { IStore } from './useStore'

/** User-editable color palettes for the appearance customizer's
 *  skin / clothing / hair / iris quick-pick chips. Seeded from the
 *  `DEFAULT_*` arrays in `lib/body/appearance.ts` on first load; the
 *  user can add / remove / replace colors via the edit-mode toggle
 *  on each row.
 *
 *  Skin is included even though it has special backend treatment:
 *  the 6 default colors map to LAB-shift presets in
 *  `tools/texture_filters.py` (high-quality natural tones), and
 *  user-added colors fall through to the colorize path. BodySettings
 *  decides which path to use at chip-pick time by looking the picked
 *  hex up in DEFAULT_SKIN_PRESETS. */

export type BodyPaletteRegion = 'skin' | 'clothing' | 'hair' | 'iris'

export interface BodyPalettes {
  skin: string[]
  clothing: string[]
  hair: string[]
  iris: string[]
}

const DEFAULT_SKIN_PALETTE: string[] = DEFAULT_SKIN_PRESETS.map((p) => p.color)

export const Body_DEFAULT_PALETTES: BodyPalettes = {
  skin: [...DEFAULT_SKIN_PALETTE],
  clothing: [...DEFAULT_CLOTHING_PALETTE],
  hair: [...DEFAULT_HAIR_PALETTE],
  iris: [...DEFAULT_IRIS_PALETTE],
}

const storeBodyPalettes = (set: any) => ({
  bodyPalettes: {
    skin: [...DEFAULT_SKIN_PALETTE],
    clothing: [...DEFAULT_CLOTHING_PALETTE],
    hair: [...DEFAULT_HAIR_PALETTE],
    iris: [...DEFAULT_IRIS_PALETTE],
  } as BodyPalettes,

  /** Replace the full palette for a region. */
  setBodyPalette: (region: BodyPaletteRegion, colors: string[]): void =>
    set(
      produce((s: IStore) => {
        s.bodyPalettes[region] = colors
      }),
      false,
      'bodyPalettes/setAll',
    ),

  /** Append a color to a region. No dedupe — same color can appear
   *  multiple times if the user wants (lets them order by frequency). */
  addBodyPaletteColor: (region: BodyPaletteRegion, color: string): void =>
    set(
      produce((s: IStore) => {
        s.bodyPalettes[region].push(color)
      }),
      false,
      'bodyPalettes/add',
    ),

  /** Remove the color at `index` from `region`. */
  removeBodyPaletteColor: (region: BodyPaletteRegion, index: number): void =>
    set(
      produce((s: IStore) => {
        if (index < 0 || index >= s.bodyPalettes[region].length) return
        s.bodyPalettes[region].splice(index, 1)
      }),
      false,
      'bodyPalettes/remove',
    ),

  /** Replace the color at `index` in `region`. */
  replaceBodyPaletteColor: (
    region: BodyPaletteRegion,
    index: number,
    color: string,
  ): void =>
    set(
      produce((s: IStore) => {
        if (index < 0 || index >= s.bodyPalettes[region].length) return
        s.bodyPalettes[region][index] = color
      }),
      false,
      'bodyPalettes/replace',
    ),

  /** Restore one region to factory defaults. */
  resetBodyPalette: (region: BodyPaletteRegion): void =>
    set(
      produce((s: IStore) => {
        s.bodyPalettes[region] = [...Body_DEFAULT_PALETTES[region]]
      }),
      false,
      'bodyPalettes/reset',
    ),

  /** Restore ALL regions to factory defaults. */
  resetAllBodyPalettes: (): void =>
    set(
      produce((s: IStore) => {
        s.bodyPalettes = {
          skin: [...DEFAULT_SKIN_PALETTE],
          clothing: [...DEFAULT_CLOTHING_PALETTE],
          hair: [...DEFAULT_HAIR_PALETTE],
          iris: [...DEFAULT_IRIS_PALETTE],
        }
      }),
      false,
      'bodyPalettes/resetAll',
    ),
})

export default storeBodyPalettes
