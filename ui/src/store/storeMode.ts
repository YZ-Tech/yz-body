import { produce } from 'immer'
import type { IStore } from './useStore'

/** Runtime mode for the avatar. Ephemeral — NOT persisted; the host
 *  (JarvYZ) re-asserts the mode via WS `mode` events on every reconnect.
 *  In standalone mode it stays whatever the local UI sets. */

export type Mode = 'idle' | 'listening' | 'thinking' | 'speaking' | 'boot'

const storeMode = (set: any) => ({
  mode: 'boot' as Mode,
  setMode: (m: Mode): void =>
    set(
      produce((s: IStore) => {
        s.mode = m
      }),
      false,
      'mode/set',
    ),
})

export default storeMode
