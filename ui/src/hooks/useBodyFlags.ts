import useStore from '../store/useStore'
import {
  Body_DEFAULT_FLAGS,
  type BodyFlags,
  type BodyRenderStyle,
} from '../store/storeBodyFlags'

/** Compatibility shim — Body flags now live in the unified Zustand
 *  store (`ui-persist/storeBodyFlags`). This hook stays for the
 *  existing consumer call sites; new code can subscribe to
 *  `useStore((s) => s.bodyFlags.<field>)` directly for selector
 *  granularity. */

export { Body_DEFAULT_FLAGS, type BodyFlags, type BodyRenderStyle }

export function useBodyFlags(): [BodyFlags, (patch: Partial<BodyFlags>) => void] {
  const flags = useStore((s) => s.bodyFlags)
  const set = useStore((s) => s.setBodyFlags)
  return [flags, set]
}
