import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store'
import type { BodyOverlayConfig } from '../lib/body/bodyOverlays'

/** Atomic selector hooks for body body overlays.
 *
 *  Backed by the Zustand store's overlays slice. Each selector is
 *  stable across renders (module-level or useCallback-memoized) so
 *  Zustand v5's `useStore` — which uses `useCallback([api, selector])`
 *  internally to memoize getSnapshot — doesn't recreate the subscription
 *  bridge on every render of the consumer.
 *
 *  - useOverlayIds()    → only fires on add / remove (NOT on edits)
 *  - useOverlay(id)     → only fires when THAT specific overlay changes
 *  - useOverlayList()   → ordered list, shallow-compared so identity-
 *                         stable entries don't trip a rerender either;
 *                         used by BodyAvatar to drive its rebuild/sync
 *                         effect
 *  - useOverlayActions() → stable action refs; no rerender churn from
 *                          inline onChange handlers */

// Module-level selectors. Stable references across all consumer
// renders — no useCallback wrapper needed because the function itself
// is defined once. Zustand v5 will hit its memoized getSnapshot cache
// instead of recreating it per render.
type State = ReturnType<typeof useStore.getState>

const idsSelector = (s: State) => s.overlays.ids
const listSelector = (s: State) => s.overlays.ids.map((id) => s.overlays.byId[id])
const setAllSelector = (s: State) => s.setAllOverlays
const updateOneSelector = (s: State) => s.updateOverlay
const addSelector = (s: State) => s.addOverlay
const removeSelector = (s: State) => s.removeOverlay
const resetSelector = (s: State) => s.resetOverlays

export const useOverlayIds = (): string[] => useStore(idsSelector)

export const useOverlay = (id: string): BodyOverlayConfig | undefined => {
  // id varies per call site, so the selector closes over it — useCallback
  // memoizes by id so the same id always produces the same selector ref.
  const selector = useCallback((s: State) => s.overlays.byId[id], [id])
  return useStore(selector)
}

export const useOverlayList = (): BodyOverlayConfig[] =>
  useStore(useShallow(listSelector))

export interface OverlayActions {
  setAll: (configs: BodyOverlayConfig[]) => void
  updateOne: (id: string, patch: Partial<BodyOverlayConfig>) => void
  add: () => void
  remove: (id: string) => void
  reset: () => void
}

export const useOverlayActions = (): OverlayActions => {
  // Each useStore call returns a stable function reference from the
  // store (Zustand store functions don't change identity across the
  // app lifetime). Module-level selectors keep the getSnapshot bridge
  // memoized inside useStore.
  const setAll = useStore(setAllSelector)
  const updateOne = useStore(updateOneSelector)
  const add = useStore(addSelector)
  const remove = useStore(removeSelector)
  const reset = useStore(resetSelector)
  return { setAll, updateOne, add, remove, reset }
}
