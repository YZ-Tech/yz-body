import { produce } from 'immer'
import {
  DEFAULT_BODY_OVERLAYS,
  type BodyOverlayConfig,
} from '../lib/body/bodyOverlays'
import type { IStore } from './useStore'

/** Atomic per-overlay state. byId is spread on every mutation so
 *  unchanged entries keep their object identity — a selector reading
 *  `byId[id]` for an unrelated id sees Object.is match and skips the
 *  re-render. The HTML5 color picker drag (60+Hz) updates a single
 *  byId entry per tick and only THAT overlay's editor re-renders. ids
 *  only changes on add/remove, so BodySettings doesn't re-render either.
 *
 *  Persisted under the unified `jarvyz-storage` key via persist
 *  middleware (replaces the old standalone `body.overlays` key). The
 *  legacy localStorage key is imported once below as the initial-state
 *  seed so existing installs keep their overlays after the migration. */

const LEGACY_KEY = 'body.overlays'

const seedFromLegacy = (): {
  byId: Record<string, BodyOverlayConfig>
  ids: string[]
} => {
  let list = DEFAULT_BODY_OVERLAYS
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) list = parsed as BodyOverlayConfig[]
    }
  } catch {
    /* localStorage disabled / corrupted — keep defaults */
  }
  const byId: Record<string, BodyOverlayConfig> = {}
  const ids: string[] = []
  for (const c of list) {
    byId[c.id] = c
    ids.push(c.id)
  }
  return { byId, ids }
}

const storeBodyOverlays = (set: any) => ({
  overlays: seedFromLegacy(),

  setAllOverlays: (configs: BodyOverlayConfig[]): void =>
    set(
      produce((s: IStore) => {
        const byId: Record<string, BodyOverlayConfig> = {}
        const ids: string[] = []
        for (const c of configs) {
          byId[c.id] = c
          ids.push(c.id)
        }
        s.overlays.byId = byId
        s.overlays.ids = ids
      }),
      false,
      'overlays/setAll',
    ),

  updateOverlay: (id: string, patch: Partial<BodyOverlayConfig>): void =>
    set(
      produce((s: IStore) => {
        const cur = s.overlays.byId[id]
        if (!cur) return
        // Spread so unchanged entries keep their reference — that's
        // what makes per-id selectors skip the re-render via Object.is.
        s.overlays.byId = { ...s.overlays.byId, [id]: { ...cur, ...patch } }
      }),
      false,
      'overlays/update',
    ),

  addOverlay: (): void =>
    set(
      produce((s: IStore) => {
        let n = 1
        let id = `custom-overlay-${n}`
        while (s.overlays.byId[id]) {
          n += 1
          id = `custom-overlay-${n}`
        }
        const fresh: BodyOverlayConfig = {
          id,
          enabled: false,
          bones: ['Head'],
          weightThreshold: 0.4,
          effect: 'solid',
          baseColor: [125, 211, 252],
          baseIntensity: 0,
          driver: { kind: 'static' },
        }
        s.overlays.byId[id] = fresh
        s.overlays.ids.push(id)
      }),
      false,
      'overlays/add',
    ),

  removeOverlay: (id: string): void =>
    set(
      produce((s: IStore) => {
        if (!s.overlays.byId[id]) return
        delete s.overlays.byId[id]
        s.overlays.ids = s.overlays.ids.filter((x) => x !== id)
      }),
      false,
      'overlays/remove',
    ),

  resetOverlays: (): void =>
    set(
      produce((s: IStore) => {
        const byId: Record<string, BodyOverlayConfig> = {}
        const ids: string[] = []
        for (const c of DEFAULT_BODY_OVERLAYS) {
          byId[c.id] = c
          ids.push(c.id)
        }
        s.overlays.byId = byId
        s.overlays.ids = ids
      }),
      false,
      'overlays/reset',
    ),
})

export default storeBodyOverlays
