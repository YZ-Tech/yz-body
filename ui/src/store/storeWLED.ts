import { produce } from 'immer'
import type { WLEDDevice } from '../api/types'
import type { IStore } from './useStore'

/** Live state for one WLED device — config (alias, host, point_at,
 *  aura_hand) merged with live state (on, bri, color, fx, reachable). */
export type WLEDDeviceState = WLEDDevice

/** WLED device state, as the body avatar needs it (point-at coords +
 *  live color for the aura overlays).
 *
 *  In JarvYZ this is owned by the host's full WLED slice (config GET +
 *  WS pool). Here the satellite keeps a lean mirror: the host feeds it
 *  via `wled` WS events (and, in standalone, a one-shot seed the host
 *  isn't around to provide — so it simply stays empty until events
 *  arrive). No HTTP fetch, no api/client coupling. */
export interface WLEDEvent {
  alias: string | null
  on?: boolean
  bri?: number
  color?: [number, number, number]
  reachable?: boolean
  /** Full device list — sent by the host on (re)connect so the satellite
   *  can seed point_at/aura_hand config it has no other source for. */
  devices?: WLEDDeviceState[]
}

const storeWLED = (set: any) => ({
  wled: {
    devices: {} as Record<string, WLEDDeviceState>,
    loaded: false,
  },

  /** Replace the whole device roster (host (re)connect seed). */
  seedWLED: (devices: WLEDDeviceState[]): void =>
    set(
      produce((s: IStore) => {
        s.wled.devices = {}
        for (const d of devices) s.wled.devices[d.alias] = d
        s.wled.loaded = true
      }),
      false,
      'wled/seed',
    ),

  applyWLEDEvent: (e: WLEDEvent): void => {
    if (Array.isArray(e.devices)) {
      set(
        produce((s: IStore) => {
          s.wled.devices = {}
          for (const d of e.devices!) s.wled.devices[d.alias] = d
          s.wled.loaded = true
        }),
        false,
        'wled/seedFromEvent',
      )
      return
    }
    if (!e.alias) return
    set(
      produce((s: IStore) => {
        const existing = s.wled.devices[e.alias!]
        if (!existing) return
        if (e.on !== undefined && e.bri !== undefined && e.color !== undefined) {
          existing.state = {
            on: e.on,
            bri: e.bri,
            color: e.color,
            fx: existing.state?.fx ?? 0,
          }
        }
        if (e.reachable !== undefined) existing.reachable = e.reachable
      }),
      false,
      'wled/applyEvent',
    )
  },
})

export default storeWLED
