// Semantic API contract for the body module.
//
// The body avatar is unusual among the satellites: almost all of its data
// access happens through `apiUrl()` (lib/assetBase) inside the data hooks +
// engine loaders, rather than through an injected api object. But the host's
// SatelliteDashboardLoader REQUIRES every satellite IIFE to export a
// `createSatelliteApi` factory (it loads that export first and renders a
// fallback if it's missing). So we ship a thin one: it carries the resolved
// apiBase + a couple of settings helpers, and — importantly — sets the
// module-level base so the hooks/loaders resolve correctly even before
// BodyDashboard's first render in unusual mount orders.

import { setApiBase } from './assetBase'


export interface SatelliteSettings {
  data_root: string
  assets_url: string
}


/** The (small) api surface the body module exposes to its host. */
export interface BodyApi {
  /** The base the module resolves all of its own fetches against. */
  readonly apiBase: string
  getSettings(): Promise<SatelliteSettings>
  patchSettings(patch: Partial<SatelliteSettings>): Promise<SatelliteSettings>
}


export class NotSupportedError extends Error {
  constructor(operation: string) {
    super(`Operation '${operation}' is not supported by this host`)
    this.name = 'NotSupportedError'
  }
}


/** Build the body api adapter. `apiBase` is '' for the standalone SPA and
 *  '/api/body' when embedded in JarvYZ (the host proxy prefix). */
export function createSatelliteApi({ apiBase = '' }: { apiBase?: string } = {}): BodyApi {
  // Normalise + publish the base so the data hooks (which read it lazily
  // via `apiUrl`) resolve correctly regardless of mount order.
  setApiBase(apiBase)
  const base = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase

  async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method }
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify(body)
    }
    const res = await fetch(base + path, init)
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`${method} ${base + path} -> ${res.status} ${detail}`)
    }
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  return {
    apiBase: base,
    getSettings: () => req<SatelliteSettings>('GET', '/settings'),
    patchSettings: (patch) => req<SatelliteSettings>('PATCH', '/settings', patch),
  }
}
