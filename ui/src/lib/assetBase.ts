// Runtime base-path resolution for the body satellite UI.
//
// The avatar fetches two kinds of URLs:
//   - JSON API routes (clip/character listings, tags, beats, ...)
//   - raw asset bytes (.glb characters + .fbx/.glb animations)
//
// Both must work in two deploy targets:
//   - standalone SPA  -> base '' (the satellite serves both API + /assets
//     at its own origin, routes un-prefixed)
//   - embedded in JarvYZ -> base '/api/body' (the host proxies /api/body/*
//     to the satellite, stripping the prefix)
//
// `BodyDashboard` calls `setApiBase()` once with its `apiBase` prop before
// the avatar tree mounts. Engine loaders + data hooks read the current base
// lazily via these helpers, so the value is correct by the time any fetch
// or GLTF load fires (all of which happen post-mount).

let _base = ''

/** Set the API/asset base. Called once by BodyDashboard from its prop. */
export function setApiBase(base: string): void {
  // Normalise: drop a trailing slash so `apiUrl('/clips')` never doubles up.
  _base = base.endsWith('/') ? base.slice(0, -1) : base
}

/** Current base (possibly ''). */
export function apiBase(): string {
  return _base
}

/** Build a JSON-route URL. `path` starts with '/', e.g. apiUrl('/clips'). */
export function apiUrl(path: string): string {
  return _base + path
}

/** Build an asset-bytes URL under the satellite's /assets mount.
 *  `path` is relative, e.g. assetUrl('characters/Loom.glb'). */
export function assetUrl(path: string): string {
  return `${_base}/assets/${path}`
}
