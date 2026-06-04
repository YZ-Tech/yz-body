import { useMemo } from 'react'
import useStore from '../store/useStore'
import {
  DEFAULT_Body_BEHAVIOR,
  effectiveBehavior,
  type BodyBehavior,
  type BodyBehaviorEffective,
  type BodyEyeBoneCandidates,
} from '../lib/body/behavior'

/** Read + patch the per-character behavior overrides. Returns the
 *  EFFECTIVE behavior (merged with defaults) so consumers don't have
 *  to spread fallbacks at every call site. */

export {
  DEFAULT_Body_BEHAVIOR,
  effectiveBehavior,
  type BodyBehavior,
  type BodyBehaviorEffective,
  type BodyEyeBoneCandidates,
}

export interface UseBodyBehaviorApi {
  /** Raw stored override (undefined keys = "use default"). */
  raw: BodyBehavior
  /** Override merged with defaults — render-loop reads from this. */
  effective: BodyBehaviorEffective
  setBehavior: (patch: Partial<BodyBehavior>) => void
  resetGroup: (group: 'feel' | 'rig') => void
}

// Stable empty-override sentinel — when the user hasn't customized a
// character, `useStore((s) => s.bodyBehavior[char])` returns undefined.
// Coalescing with `?? {}` inline would mint a fresh object each render
// and bust downstream useMemo deps; using one module-level constant
// keeps the reference stable across renders.
const EMPTY_BEHAVIOR: BodyBehavior = {}

export function useBodyBehavior(characterFile: string): UseBodyBehaviorApi {
  const sourceChar = characterFile.endsWith('_custom.glb')
    ? characterFile.replace('_custom.glb', '.glb')
    : characterFile
  const raw = useStore((s) => s.bodyBehavior[sourceChar]) ?? EMPTY_BEHAVIOR
  const set = useStore((s) => s.setBodyBehavior)
  const reset = useStore((s) => s.resetBodyBehaviorGroup)
  // Memoize the merge — without this, every Avatar re-render (mode WS
  // events, tts_level at 20Hz during speech, etc.) reallocated the
  // candidate-list arrays and downstream JSON.stringify ran for nothing.
  const effective = useMemo(() => effectiveBehavior(raw), [raw])
  return {
    raw,
    effective,
    setBehavior: (patch) => set(characterFile, patch),
    resetGroup: (group) => reset(characterFile, group),
  }
}
