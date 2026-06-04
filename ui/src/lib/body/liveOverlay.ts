import type { BodyOverlayConfig } from './bodyOverlays'

/** Live overlay-edit bypass for the Body settings UI.
 *
 *  Sliders + color pickers fire onChange at 60Hz during drag. Routing
 *  every tick through Zustand triggers backpressure (every setState
 *  fans out to all store subscribers; the React queue piles up faster
 *  than it can flush → "Maximum update depth exceeded" and visible
 *  drag lag).
 *
 *  This module is a side-channel: OverlayEditor calls
 *  `applyLiveOverlayPatch(id, patch)` on every drag tick. BodyAvatar's
 *  scene effect registers a setter that mutates the Three.js-side
 *  overlay config in place (zero React, zero Zustand). Drivers + the
 *  flow shader read that config each frame so the GPU sees the new
 *  values immediately.
 *
 *  The store gets the final value committed (debounced) by
 *  OverlayEditor — that's what persists to localStorage and is read on
 *  next mount.
 *
 *  Patches support shallow-nested merging for the known nested fields
 *  (`flow`, `driver`, `light`) so callers can pass partial sub-objects
 *  e.g. `{ flow: { period_ms: 1200 } }` without losing the other flow
 *  fields. See the setter wiring in BodyAvatar for the merge logic. */

export type LiveOverlayPatch = Partial<BodyOverlayConfig>
export type LiveOverlayPatchSetter = (id: string, patch: LiveOverlayPatch) => void

let setter: LiveOverlayPatchSetter | null = null

export const registerLiveOverlayPatch = (fn: LiveOverlayPatchSetter | null): void => {
  setter = fn
}

export const applyLiveOverlayPatch: LiveOverlayPatchSetter = (id, patch) => {
  setter?.(id, patch)
}
