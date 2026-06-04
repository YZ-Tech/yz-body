import { apiUrl } from '../lib/assetBase'
import { useCallback, useEffect, useState } from 'react'

/** Dynamically-scanned animation clip roster from the backend.
 *
 *  Replaces the old hardcoded Body_ALL_CLIPS const. The backend
 *  (web/api/body.py) walks `web/static/body/animations/` recursively
 *  and returns every .glb / .gltf / .fbx file under it. Subfolders
 *  become "groups" — used as section headers in the settings UI and
 *  as the high-level category in MOTION_CATALOG_BLOCK (eventually).
 *
 *  Soft-delete: the `trash(path)` method moves a clip into the
 *  backend's `_trash/<group>/<file>` subfolder. Scans skip `_*`
 *  folders, so the clip disappears from the UI but stays on disk
 *  for manual restore.
 *
 *  Initial fetch fires on mount. `rescan` re-fetches on demand
 *  (rescan icon button in BodySettings + after a trash POST). */

export interface BodyClip {
  /** Identifier — relative POSIX path under animations/, e.g.
   *  "Idle/idle.fbx" or just "happy-hand-gesture.glb" for root-
   *  level files. This is the canonical clip name used in pools,
   *  canned-reply motion lists, ui_command payloads, etc. */
  path: string
  /** Bare filename — display label in the settings UI + used by the
   *  BodyAvatar basename→path resolver so the LLM-facing API can keep
   *  using basenames in MOTION_CATALOG_BLOCK. */
  file: string
  /** Subfolder name, or "Ungrouped" for root-level files. */
  group: string
}

export function useBodyClips(): {
  clips: BodyClip[]
  loaded: boolean
  rescan: () => Promise<void>
  trash: (path: string) => Promise<void>
  /** Whether a beat-analysis pass is in flight (rescan kicks one
   *  off in the background so the UI can show a spinner). */
  analyzing: boolean
} {
  const [clips, setClips] = useState<BodyClip[]>([])
  const [loaded, setLoaded] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const rescan = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/clips'))
      if (!res.ok) return
      const data = (await res.json()) as { clips?: BodyClip[] }
      if (Array.isArray(data.clips)) setClips(data.clips)
      setLoaded(true)
    } catch {
      /* network blip — keep last-known list */
    }
    // Fire-and-forget beat analysis after the listing refreshes. The
    // backend mtime-skips already-analyzed clips so this is cheap when
    // nothing changed; only fresh/edited clips pay the ~150ms node
    // subprocess cost. Doesn't block the rescan UI — the dropdown +
    // pool grid are usable immediately.
    setAnalyzing(true)
    fetch(apiUrl('/clips/analyze'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .catch(() => {
        /* analyzer is best-effort */
      })
      .finally(() => setAnalyzing(false))
  }, [])
  const trash = useCallback(async (path: string) => {
    try {
      const res = await fetch(apiUrl('/clips/trash'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      if (res.ok) await rescan()
    } catch {
      /* swallow — UI will stay showing the clip until next rescan */
    }
  }, [rescan])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- legit "kick off async fetch on mount" pattern
    void rescan()
  }, [rescan])
  return { clips, loaded, rescan, trash, analyzing }
}
