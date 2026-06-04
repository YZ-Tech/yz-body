import { apiUrl } from '../lib/assetBase'
import { useCallback, useEffect, useState } from 'react'

/** Per-clip free-form tags. Mirrors the backend's central tags index
 *  (web/api/body.py → frontend/public/body/_clip_tags.json). Used by the
 *  Body Settings UI to filter the clip pool grid and by the LLM
 *  external catalog to give richer semantic labels than filenames.
 *
 *  Storage shape (read-mostly, ~hundreds of clips × handful of tags):
 *    { tags: { "Group/clip.fbx": ["nod", "yes"] }, all_tags: [...] }
 *
 *  Writes go through `setTags(path, tags)` which POSTs a single-clip
 *  replacement; backend canonicalizes (lowercases, dedupes) and
 *  echoes the cleaned list back. We optimistically update local
 *  state from the response so the UI stays consistent. */

export function useBodyClipTags(): {
  /** Map of clip path → tag list. Empty for clips with no tags. */
  tags: Record<string, string[]>
  /** Union of all distinct tags across clips, alphabetized — feed to
   *  the Autocomplete's `options` so suggestions match existing
   *  vocabulary even though tags are technically free-form. */
  allTags: string[]
  /** True once the first fetch has resolved. UI uses this to delay
   *  rendering tag chips until we know the actual list (otherwise
   *  every clip would briefly render as "no tags" then re-render). */
  loaded: boolean
  rescan: () => Promise<void>
  /** Replace tags for one clip. Empty array removes the entry. */
  setTags: (path: string, tags: string[]) => Promise<void>
} {
  const [tags, setTagsState] = useState<Record<string, string[]>>({})
  const [allTags, setAllTags] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)

  const rescan = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/clips/tags'))
      if (!res.ok) return
      const data = (await res.json()) as {
        tags?: Record<string, string[]>
        all_tags?: string[]
      }
      setTagsState(data.tags || {})
      setAllTags(data.all_tags || [])
      setLoaded(true)
    } catch {
      /* network blip — keep last-known list */
    }
  }, [])

  const setTags = useCallback(async (path: string, next: string[]) => {
    try {
      const res = await fetch(apiUrl('/clips/tags'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, tags: next }),
      })
      if (!res.ok) return
      const data = (await res.json()) as { tags?: string[] }
      const cleaned = data.tags || []
      setTagsState((prev) => {
        const updated = { ...prev }
        if (cleaned.length) updated[path] = cleaned
        else delete updated[path]
        // Recompute allTags from the updated map so the Autocomplete
        // suggestions reflect tags added/removed in this session
        // without a full rescan.
        const union = new Set<string>()
        for (const list of Object.values(updated)) {
          for (const t of list) union.add(t)
        }
        setAllTags(Array.from(union).sort())
        return updated
      })
    } catch {
      /* leave UI optimistic — next rescan will reconcile */
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- legit "kick off async fetch on mount" pattern
    void rescan()
  }, [rescan])

  return { tags, allTags, loaded, rescan, setTags }
}
