import { apiUrl } from '../lib/assetBase'
import { useCallback, useEffect, useState } from 'react'
import type { BodyGender } from './useBodyClipGenders'

/** Per-character metadata — gender for now. Drives the gender filter
 *  that hides wrong-gender clips from the active character. Auto-
 *  seeded from filename heuristics on the first /api/body/characters/meta
 *  request; user overrides via the UI. */

export interface CharacterMeta {
  gender?: Extract<BodyGender, 'male' | 'female'>
}

/** Strip the `_custom` suffix so a customized variant inherits its
 *  source character's gender. Matches the backend's normalization. */
export const sourceCharacterOf = (file: string): string =>
  file.endsWith('_custom.glb') ? file.replace('_custom.glb', '.glb') : file

export function useBodyCharacterMeta(): {
  meta: Record<string, CharacterMeta>
  loaded: boolean
  rescan: () => Promise<void>
  setGender: (file: string, gender: Exclude<BodyGender, 'neutral'>) => Promise<void>
  /** Sync the currently-selected character to the backend so the LLM
   *  catalog generator's gender filter knows which one is active.
   *  Called when the character dropdown changes. */
  setActive: (file: string) => Promise<void>
  /** Convenience: gender of a single character, resolved through the
   *  _custom→source mapping. Returns undefined for unknown chars. */
  genderOf: (file: string) => 'male' | 'female' | undefined
} {
  const [meta, setMeta] = useState<Record<string, CharacterMeta>>({})
  const [loaded, setLoaded] = useState(false)

  const rescan = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/characters/meta'))
      if (!res.ok) return
      const data = (await res.json()) as { characters?: Record<string, CharacterMeta> }
      setMeta(data.characters || {})
      setLoaded(true)
    } catch {
      /* network blip */
    }
  }, [])

  const setGender = useCallback(
    async (file: string, gender: Exclude<BodyGender, 'neutral'>) => {
      try {
        const res = await fetch(apiUrl('/characters/meta'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file, gender }),
        })
        if (!res.ok) return
        const data = (await res.json()) as { meta: CharacterMeta }
        setMeta((prev) => ({ ...prev, [file]: data.meta }))
      } catch {
        /* swallow */
      }
    },
    [],
  )

  const setActive = useCallback(async (file: string) => {
    try {
      await fetch(apiUrl('/characters/active'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file }),
      })
    } catch {
      /* swallow — best-effort */
    }
  }, [])

  const genderOf = useCallback(
    (file: string) => meta[sourceCharacterOf(file)]?.gender,
    [meta],
  )

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- legit "kick off async fetch on mount" pattern
    void rescan()
  }, [rescan])

  return { meta, loaded, rescan, setGender, setActive, genderOf }
}
