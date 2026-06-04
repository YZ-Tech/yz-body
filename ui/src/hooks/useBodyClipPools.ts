import { useMemo } from 'react'
import useStore from '../store/useStore'
import {
  defaultPoolsForCharacter,
  sourceCharacterOf,
  Body_DEFAULT_POOLS,
  Body_DEFAULT_POOLS_FEMALE,
  Body_DEFAULT_POOLS_MALE,
  Body_DEFAULT_POOLS_QUATERNIUS_FEMALE,
  Body_DEFAULT_POOLS_QUATERNIUS_MALE,
  type BodyClipPools,
  type BodyMode,
} from '../store/storeBodyPools'

/** Compatibility shim — Body clip pools now live in the unified
 *  Zustand store (`ui-persist/storeBodyPools`) as a `Record<character,
 *  pools>` map. The pre-Zustand hook had per-character localStorage
 *  keys and gender-seeded reads; that behavior is preserved here by
 *  selecting the stored pool when present and falling back to the
 *  gender default otherwise. */

export {
  Body_DEFAULT_POOLS,
  Body_DEFAULT_POOLS_FEMALE,
  Body_DEFAULT_POOLS_MALE,
  Body_DEFAULT_POOLS_QUATERNIUS_FEMALE,
  Body_DEFAULT_POOLS_QUATERNIUS_MALE,
  type BodyClipPools,
  type BodyMode,
}

export function useBodyClipPools(
  characterFile: string,
  gender?: 'male' | 'female',
): [BodyClipPools, (mode: BodyMode, clips: string[]) => void, () => void] {
  const key = sourceCharacterOf(characterFile)
  const stored = useStore((s) => s.bodyPools[key])
  // Memoize the fallback so uncustomized characters don't mint a fresh
  // pools object on every render (which propagated into poolsRef sync
  // and downstream Avatar re-renders).
  //
  // RIG-AWARE: defaultPoolsForCharacter branches on Quaternius vs Mixamo
  // so BotM/BotF seed with UAL pools (clips that actually drive their
  // skeleton) instead of the Mixamo private/ pools (which silently
  // no-op on a Quaternius rig per the STRICT-LINE POLICY).
  const pools = useMemo(
    () => stored ?? defaultPoolsForCharacter(characterFile, gender),
    [stored, characterFile, gender],
  )
  const setPool = useStore((s) => s.setBodyPool)
  const resetPool = useStore((s) => s.resetBodyPool)
  const update = (mode: BodyMode, clips: string[]): void => {
    setPool(characterFile, mode, clips)
  }
  const reset = (): void => {
    resetPool(characterFile)
  }
  return [pools, update, reset]
}
