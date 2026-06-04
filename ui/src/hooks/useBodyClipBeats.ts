import { apiUrl } from '../lib/assetBase'
import { useCallback, useEffect, useState } from 'react'

/** Per-clip motion-analysis cache from the backend. Mirrors
 *  `_clip_beats.json` produced by `node frontend/analyze_clip.mjs`.
 *
 *  Peaks are intensity-detected local maxima at 10Hz. The top 3 by
 *  intensity are surfaced to the LLM as `peak` / `peak2` / `peak3`.
 *  Users can attach a semantic label (e.g. `fire`, `release`) to any
 *  peak — those labels survive re-analysis (matched by t value) and
 *  take precedence over the intensity-rank names when the LLM uses
 *  `sync_to`. */

export interface BodyBeat {
  t: number
  intensity: number
  bones: string[]
}

export interface BodyClipBeats {
  duration: number
  tracks: number
  max_intensity: number
  top_bones?: { bone: string; total: number }[]
  peaks: BodyBeat[]
  /** time-keyed user labels: `"1.90"` → `"fire"`. */
  labels?: Record<string, string>
  mtime?: number
}

export function useBodyClipBeats(): {
  beats: Record<string, BodyClipBeats>
  loaded: boolean
  rescan: () => Promise<void>
  /** Set or clear a label on a single peak. Empty `label` clears.
   *  `t` should match (within 0.05s) an existing peak from the cache. */
  setLabel: (path: string, t: number, label: string) => Promise<void>
} {
  const [beats, setBeats] = useState<Record<string, BodyClipBeats>>({})
  const [loaded, setLoaded] = useState(false)

  const rescan = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/clips/beats'))
      if (!res.ok) return
      const data = (await res.json()) as { beats?: Record<string, BodyClipBeats> }
      setBeats(data.beats || {})
      setLoaded(true)
    } catch {
      /* network blip — keep last-known */
    }
  }, [])

  const setLabel = useCallback(async (path: string, t: number, label: string) => {
    try {
      const res = await fetch(apiUrl('/clips/beats/label'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, t, label }),
      })
      if (!res.ok) return
      const data = (await res.json()) as { t: number; label: string }
      // Optimistic local update — avoid a full rescan round-trip.
      setBeats((prev) => {
        const entry = prev[path]
        if (!entry) return prev
        const key = data.t.toFixed(2)
        const next = { ...entry }
        const labels = { ...(entry.labels || {}) }
        if (data.label) labels[key] = data.label
        else delete labels[key]
        if (Object.keys(labels).length) next.labels = labels
        else delete next.labels
        return { ...prev, [path]: next }
      })
    } catch {
      /* swallow — UI keeps last-known */
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- legit "kick off async fetch on mount" pattern
    void rescan()
  }, [rescan])

  return { beats, loaded, rescan, setLabel }
}
