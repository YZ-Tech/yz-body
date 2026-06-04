// Root component for dashboard variant 13 — the full-body 3D avatar.
//
// Shipped as a react-dynamic-module IIFE export (`window.YzBody.BodyDashboard`)
// loaded by JarvYZ's SatelliteDashboardLoader, and also rendered directly by
// the standalone SPA (src/App.tsx). The host passes the conventional
// satellite-UI prop shape: `theme` / `wsApi` / `api` / `capabilities`.
//
// React context can't cross the IIFE bundle boundary by identity, so the
// host's theme + WS values arrive as PROPS and we re-establish module-local
// providers here (the ledfx pattern, same as every other satellite UI). The
// avatar's Zustand store is a module-local singleton (imported directly by
// the avatar tree), so it needs no provider.

import { ThemeProvider, type Theme } from '@mui/material/styles'
import { useMemo } from 'react'
import { BodyAvatar } from './avatar/Avatar'
import { WSContext, type WSApi } from './lib/ws'
import { setApiBase } from './lib/assetBase'
import {
  CapabilitiesContext,
  DEFAULT_CAPABILITIES,
  type Capabilities,
} from './lib/capabilities'
import type { BodyApi } from './lib/api'

export interface BodyDashboardProps {
  /** MUI theme from the host (`useTheme()`), re-applied via our own
   *  ThemeProvider so MUI components inside the IIFE pick it up. */
  theme: Theme
  /** WS bridge from the host — drives mode/announce/wled/tts_level. */
  wsApi: WSApi
  /** The api adapter from `createSatelliteApi` (carries the apiBase). */
  api?: BodyApi
  /** Host capabilities; `capabilities.apiBase` is the proxy prefix. */
  capabilities?: Capabilities & { canSynthesize?: boolean }
}

export function BodyDashboard({ theme, wsApi, api, capabilities }: BodyDashboardProps) {
  // Resolve the API/asset base from whichever source the host provided.
  // Set it in the render body (not an effect) so it's current before any
  // child effect fires a fetch / GLTF load.
  const apiBase = capabilities?.apiBase ?? api?.apiBase ?? ''
  setApiBase(apiBase)

  const caps = useMemo<Capabilities>(
    () => capabilities ?? { ...DEFAULT_CAPABILITIES, apiBase },
    [capabilities, apiBase],
  )

  return (
    <ThemeProvider theme={theme}>
      <CapabilitiesContext.Provider value={caps}>
        <WSContext.Provider value={wsApi}>
          <BodyAvatar />
        </WSContext.Provider>
      </CapabilitiesContext.Provider>
    </ThemeProvider>
  )
}
