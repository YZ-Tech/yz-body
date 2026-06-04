import { useEffect, useRef, type MutableRefObject } from 'react'
import { useStore } from '../store'
import type { WLEDEvent } from '../store/storeWLED'
import type { BodyMode } from '../hooks/useBodyClipPools'
import { useWebSocket } from '../lib/ws'
import { useSubscription } from '../lib/ws'

/** React/WS event bridges for BodyAvatar. Each hook does ONE thing: subscribe
 *  to a WS channel or window event and forward the payload into a ref that
 *  the Three.js render-effect populated. Keeps Avatar.tsx readable. */

type PlayMotion = (clips: string[], mode?: 'once' | 'loop') => void
type PlayPoint = (
  target: [number, number, number],
  opts?: { hold_ms?: number; ease_ms?: number; arm?: 'auto' | 'left' | 'right' },
) => void
type AuraEvent = { alias: string | null }

const VALID_MODES: BodyMode[] = ['idle', 'listening', 'thinking', 'speaking', 'boot']

/** Drive store `mode` from server-side `mode` + `announce` events.
 *  `announce` bracket fires `speaking` on start and restores the prior
 *  mode on end so TTS doesn't get stuck. Also auto-exits `boot` after the
 *  transition clip plays through. */
export function useBodyModeBridge(modeRef: MutableRefObject<BodyMode>) {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const preAnnounceModeRef = useRef<BodyMode | null>(null)

  useSubscription<{ state: string }>('announce', (d) => {
    if (d.state === 'start') {
      if (preAnnounceModeRef.current === null) preAnnounceModeRef.current = modeRef.current
      setMode('speaking')
    } else if (d.state === 'end') {
      const prev = preAnnounceModeRef.current ?? 'idle'
      preAnnounceModeRef.current = null
      setMode(prev)
    }
  })
  useSubscription<{ state: string }>('mode', (d) => {
    if (VALID_MODES.includes(d.state as BodyMode)) setMode(d.state as BodyMode)
  })

  useEffect(() => {
    if (mode !== 'boot') return
    const t = setTimeout(() => setMode('idle'), 2500)
    return () => clearTimeout(t)
  }, [mode, setMode])
}

/** Bridge `body.motion` window events (dispatched by useUIControl on
 *  `play_body_motion` ui_commands) into the avatar's playMotion ref. */
export function useBodyMotionBridge(playMotionRef: MutableRefObject<PlayMotion>) {
  useEffect(() => {
    const onMotion = (e: Event) => {
      const ce = e as CustomEvent<{ clips?: string[]; mode?: 'once' | 'loop' }>
      const { clips, mode } = ce.detail || {}
      if (clips && clips.length > 0) {
        playMotionRef.current?.(clips, mode || 'once')
      }
    }
    window.addEventListener('body.motion', onMotion as EventListener)
    return () => window.removeEventListener('body.motion', onMotion as EventListener)
  }, [playMotionRef])
}

/** Bridge `body.point` window events (`play_body_point` ui_commands)
 *  into the avatar's playPoint ref. */
export function useBodyPointBridge(playPointRef: MutableRefObject<PlayPoint>) {
  useEffect(() => {
    const onPoint = (e: Event) => {
      const ce = e as CustomEvent<{
        target?: [number, number, number]
        hold_ms?: number
        ease_ms?: number
        arm?: 'auto' | 'left' | 'right'
      }>
      const t = ce.detail?.target
      if (Array.isArray(t) && t.length === 3) {
        playPointRef.current?.(t, {
          hold_ms: ce.detail?.hold_ms,
          ease_ms: ce.detail?.ease_ms,
          arm: ce.detail?.arm,
        })
      }
    }
    window.addEventListener('body.point', onPoint as EventListener)
    return () => window.removeEventListener('body.point', onPoint as EventListener)
  }, [playPointRef])
}

/** Bridge `body.character.reload` window events (fired by the Appearance
 *  Apply flow) into a force-reload of the current character. */
export function useBodyCharacterReloadBridge(
  loadCharacterRef: MutableRefObject<(file: string, force?: boolean) => void>,
  currentFileRef: MutableRefObject<{ characterFile: string }>,
) {
  useEffect(() => {
    const onReload = () => {
      loadCharacterRef.current?.(currentFileRef.current.characterFile, true)
    }
    window.addEventListener('body.character.reload', onReload)
    return () => window.removeEventListener('body.character.reload', onReload)
  }, [loadCharacterRef, currentFileRef])
}

/** Fire a spike on overlays whose driver matches a WLED device on every
 *  state change. Steady-state color + intensity still come from the
 *  per-frame driver tick (which reads the store directly). */
export function useBodyWledAuraBridge(setAuraRef: MutableRefObject<(s: AuraEvent) => void>) {
  useSubscription<{
    alias: string | null
    host: string
    on: boolean
    bri: number
    color: [number, number, number]
  }>('wled', (d) => {
    setAuraRef.current?.({ alias: d.alias ?? null })
  })
}

/** Populate the satellite's WLED store from the host. The host's `wled` WS
 *  events are live per-device state only (no roster), so on every (re)connect
 *  we seed the full device list — incl. the point_at / aura_hand config the
 *  satellite has no other source for — from GET /api/wled/devices (the host's
 *  absolute path, not the /api/body prefix). Per-device WS pushes then keep
 *  live color + reachability current. Both the engine's lighting/aura overlays
 *  (which read `store.wled.devices`) and the Aim Points settings panel depend
 *  on this — without it the store stays empty (a gap left by the in-core
 *  extraction). Standalone SPA: the fetch 404s/throws → store stays empty. */
export function useBodyWledStoreBridge() {
  const seedWLED = useStore((s) => s.seedWLED)
  const applyWLEDEvent = useStore((s) => s.applyWLEDEvent)
  const { isConnected } = useWebSocket()
  useEffect(() => {
    if (!isConnected) return
    let cancelled = false
    fetch('/api/wled/devices')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (!cancelled && Array.isArray(d)) seedWLED(d)
      })
      .catch(() => {
        /* host has no /api/wled (standalone) — leave the store empty */
      })
    return () => {
      cancelled = true
    }
  }, [isConnected, seedWLED])
  useSubscription<WLEDEvent>('wled', (e) => applyWLEDEvent(e))
}

/** Stream TTS RMS into a ref the render loop polls each frame. Also
 *  subscribes/unsubscribes the high-frequency channel so we only pay for
 *  it while the dashboard is mounted. */
export function useBodyTtsLevelStream(): MutableRefObject<number> {
  const ttsRmsRef = useRef(0)
  useSubscription<{ rms: number }>('tts_level', (d) => {
    ttsRmsRef.current = d.rms
  })
  const { send, isConnected } = useWebSocket()
  useEffect(() => {
    if (!isConnected) return
    send({ type: 'subscribe_event', event_type: 'tts_level' })
    return () => {
      send({ type: 'unsubscribe_event', event_type: 'tts_level' })
    }
  }, [send, isConnected])
  return ttsRmsRef
}
