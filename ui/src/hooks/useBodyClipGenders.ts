import { apiUrl } from '../lib/assetBase'
import { useCallback, useEffect, useState } from 'react'

/** Per-clip gender — `male`, `female`, or `neutral`. Used to filter the
 *  clip catalog so motions only show for matching characters. Neutral
 *  clips (head nods, generic talking gestures, hand waves) work across
 *  any character.
 *
 *  Auto-seeded server-side from filename heuristics on first request;
 *  user can override via the BodySettings UI. */

export type BodyGender = 'male' | 'female' | 'neutral'

export function useBodyClipGenders(): {
  genders: Record<string, BodyGender>
  loaded: boolean
  rescan: () => Promise<void>
  /** Set a clip's gender. Backend canonicalizes; we update local state
   *  optimistically from the response. */
  setGender: (path: string, gender: BodyGender) => Promise<void>
} {
  const [genders, setGenders] = useState<Record<string, BodyGender>>({})
  const [loaded, setLoaded] = useState(false)
  const rescan = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/clips/genders'))
      if (!res.ok) return
      const data = (await res.json()) as { genders?: Record<string, BodyGender> }
      setGenders(data.genders || {})
      setLoaded(true)
    } catch {
      /* network blip */
    }
  }, [])
  const setGender = useCallback(async (path: string, gender: BodyGender) => {
    try {
      const res = await fetch(apiUrl('/clips/genders'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, gender }),
      })
      if (!res.ok) return
      const data = (await res.json()) as { gender: BodyGender }
      setGenders((prev) => ({ ...prev, [path]: data.gender }))
    } catch {
      /* swallow — UI keeps last-known */
    }
  }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- legit "kick off async fetch on mount" pattern
    void rescan()
  }, [rescan])
  return { genders, loaded, rescan, setGender }
}
