import { apiUrl } from '../lib/assetBase'
import { useCallback, useEffect, useState } from 'react'

/** Dynamically-scanned character roster from the backend.
 *
 *  Replaces the old hardcoded Body_CHARACTERS const. The backend
 *  (web/api/body.py) walks `web/static/body/characters/` and returns
 *  every .glb / .gltf / .fbx file with a label derived from the
 *  filename stem. Drop a file in the folder + click Rescan → it
 *  appears in the picker.
 *
 *  Initial fetch fires on mount. `rescan` re-fetches on demand. */

export interface BodyCharacterEntry {
  file: string
  label: string
}

const FALLBACK: BodyCharacterEntry[] = [
  // Sensible default if the API isn't reachable (e.g. first paint
  // before fetch completes, or backend down). Drives the picker
  // until the real list lands. Must include whatever
  // `Body_DEFAULT_FLAGS.characterFile` is, otherwise MUI Select
  // warns "out-of-range value" until the first fetch completes.
  { file: 'Loom.glb', label: 'Loom' },
]

export function useBodyCharacters(): {
  characters: BodyCharacterEntry[]
  loaded: boolean
  rescan: () => Promise<void>
} {
  const [characters, setCharacters] = useState<BodyCharacterEntry[]>(FALLBACK)
  const [loaded, setLoaded] = useState(false)
  const rescan = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/characters'))
      if (!res.ok) return
      const data = (await res.json()) as { characters?: BodyCharacterEntry[] }
      if (Array.isArray(data.characters) && data.characters.length > 0) {
        setCharacters(data.characters)
      }
      setLoaded(true)
    } catch {
      /* network blip — keep last-known list */
    }
  }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- legit "kick off async fetch on mount" pattern
    void rescan()
  }, [rescan])
  return { characters, loaded, rescan }
}
