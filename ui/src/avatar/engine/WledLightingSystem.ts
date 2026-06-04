import * as THREE from 'three'

import type { WLEDDevice } from '../../api/types'
import type { BodyRoomLighting } from '../../store/storeBodyFlags'

/** Per-mode tuning for the spatial WLED lighting subsystem.
 *
 *  Values picked against character scale ≈ 100, point_at coords typically
 *  ±200-400. Tuned for realistic render style — wireframe and hologram
 *  pass through with whatever Three.js gives them by default
 *  (see memory: feedback_body_render_style_priority). */
interface ModeProfile {
  /** Sphere radius for the visible marker, in scene units. */
  markerRadius: number
  /** Marker opacity when the device is ON + reachable. OFF state dims this
   *  by 0.2×; unreachable devices show a faint constant glow. */
  markerOpacityOn: number
  /** PointLight intensity multiplier applied to (bri / 255). Three.js
   *  inverse-square falloff means meaningful illumination at ~200 unit
   *  distance needs intensity in the hundreds-to-thousands range. */
  lightIntensityScale: number
  /** PointLight `distance` parameter — soft cap on the light's reach. */
  lightDistance: number
}

const PROFILES: Record<BodyRoomLighting, ModeProfile> = {
  off: {
    markerRadius: 0,
    markerOpacityOn: 0,
    lightIntensityScale: 0,
    lightDistance: 0,
  },
  subtle: {
    markerRadius: 5,
    markerOpacityOn: 0.55,
    lightIntensityScale: 400,
    lightDistance: 700,
  },
  full: {
    markerRadius: 9,
    markerOpacityOn: 0.95,
    lightIntensityScale: 1800,
    lightDistance: 1200,
  },
}

/** Baseline radius the sphere geometry is created at. Scale.setScalar()
 *  multiplies by `mode.markerRadius / BASE_RADIUS` so we don't have to
 *  dispose+recreate the geometry on every mode change. */
const BASE_RADIUS = 5

interface LightEntry {
  light: THREE.PointLight
  marker: THREE.Mesh
  markerMat: THREE.MeshBasicMaterial
}

/** Spatial WLED visualization — one PointLight + emissive marker per
 *  enabled `category:"light"` device with a configured `point_at` coord.
 *  Driven by the Zustand `wled` slice (color, brightness, on/off,
 *  reachable) so device state changes propagate live without per-frame
 *  store reads.
 *
 *  Lifecycle:
 *  - `rebuild(devices)` creates/updates/removes entries based on the
 *    device list. Call on engine mount and whenever the device set
 *    changes (settings UI add/remove/point_at edit).
 *  - `updateState(devices)` applies live color/intensity from the wled
 *    slice. Call from the engine's wled.devices store subscription.
 *  - `setMode(mode)` switches between off / subtle / full — cheap, no
 *    geometry recreation.
 *  - `dispose()` removes everything from the scene and frees materials. */
export class WledLightingSystem {
  private scene: THREE.Scene
  private entries = new Map<string, LightEntry>()
  private mode: BodyRoomLighting = 'off'

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  /** Reconcile the entry map against the configured device list. Reuses
   *  existing entries by alias to avoid the shader-recompile cost of
   *  adding new PointLights at runtime (Three.js recompiles every
   *  responsive material on light count change).
   *
   *  Devices skipped: `enabled === false`, `category !== "light"`, or
   *  `point_at === null`. */
  rebuild(devices: Record<string, WLEDDevice>): void {
    const seen = new Set<string>()
    for (const d of Object.values(devices)) {
      if (!d.enabled || d.category !== 'light' || !d.point_at) continue
      seen.add(d.alias)
      let entry = this.entries.get(d.alias)
      if (!entry) {
        entry = this.createEntry()
        this.entries.set(d.alias, entry)
      }
      entry.light.position.set(d.point_at.x, d.point_at.y, d.point_at.z)
      entry.marker.position.set(d.point_at.x, d.point_at.y, d.point_at.z)
    }
    for (const alias of [...this.entries.keys()]) {
      if (!seen.has(alias)) this.removeEntry(alias)
    }
    this.applyMode()
    this.updateState(devices)
  }

  /** Push live WLED state into the lights/markers. Cheap — just mutates
   *  color + intensity, no scene reflows. */
  updateState(devices: Record<string, WLEDDevice>): void {
    const profile = PROFILES[this.mode]
    for (const [alias, entry] of this.entries) {
      const d = devices[alias]
      if (!d) {
        entry.light.intensity = 0
        entry.markerMat.opacity = 0
        continue
      }
      const state = d.state
      const reachable = d.reachable
      const isOn = !!state?.on
      const bri = state?.bri ?? 0
      const rgb = state?.color ?? [255, 255, 255]
      // sRGB → linear so the rendered hue matches what the user sees on
      // the physical WLED. Three.js works in linear internally.
      const color = new THREE.Color()
        .setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
        .convertSRGBToLinear()
      entry.light.color.copy(color)
      entry.markerMat.color.copy(color)

      const briFraction = isOn ? bri / 255 : 0
      entry.light.intensity = profile.lightIntensityScale * briFraction
      if (!reachable) {
        // Unreachable — faint constant glow so the user can still see
        // where the device is, but no illumination contribution.
        entry.markerMat.opacity = profile.markerOpacityOn * 0.15
      } else if (!isOn) {
        // Off — dim marker so position is discoverable but unobtrusive.
        entry.markerMat.opacity = profile.markerOpacityOn * 0.2
      } else {
        entry.markerMat.opacity = profile.markerOpacityOn
      }
    }
  }

  /** Switch visual mode. Markers + lights resize / re-intensity but
   *  geometry + materials stay (no shader recompile, no GC churn).
   *  Defensively coerces unknown values to `'off'` — protects against
   *  stale persisted state arriving before the store migration runs
   *  (Zustand `persist` does a shallow merge that drops new field
   *  defaults; the migration in store/migrate.ts covers it but this
   *  belt-and-braces means a missing field can't crash the engine). */
  setMode(mode: BodyRoomLighting): void {
    const safe: BodyRoomLighting = mode in PROFILES ? mode : 'off'
    if (this.mode === safe) return
    this.mode = safe
    this.applyMode()
  }

  /** Remove every entry from the scene and free GPU resources. Called
   *  from AvatarEngine.dispose(). */
  dispose(): void {
    for (const alias of [...this.entries.keys()]) this.removeEntry(alias)
  }

  private applyMode(): void {
    const profile = PROFILES[this.mode]
    const visible = this.mode !== 'off'
    for (const entry of this.entries.values()) {
      entry.light.visible = visible
      entry.light.distance = profile.lightDistance
      entry.marker.visible = visible
      entry.marker.scale.setScalar(profile.markerRadius / BASE_RADIUS)
      // intensity + opacity get re-applied by updateState() — the caller
      // is expected to invoke updateState() after a mode change to refresh
      // the visuals. AvatarEngine does this inline.
    }
  }

  private createEntry(): LightEntry {
    // Start invisible + zero-intensity — applyMode() + updateState()
    // bring them up on the next pass. distance 700 is a sane default for
    // the subtle mode; setMode() updates this.
    const light = new THREE.PointLight(0xffffff, 0, 700, 2)
    light.visible = false
    this.scene.add(light)

    const geom = new THREE.SphereGeometry(BASE_RADIUS, 16, 12)
    // MeshBasicMaterial is unlit — markers don't get illuminated by the
    // PointLights themselves (avoids feedback loops + simplifies the
    // visual story: the orb IS the source, not a lit-up object).
    // `fog: false` so markers stay vivid even if a future scene adds
    // distance fog.
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      fog: false,
      depthWrite: false,
    })
    const marker = new THREE.Mesh(geom, mat)
    marker.visible = false
    marker.renderOrder = 998 // draw before overlay meshes (renderOrder 999)
    this.scene.add(marker)

    return { light, marker, markerMat: mat }
  }

  private removeEntry(alias: string): void {
    const entry = this.entries.get(alias)
    if (!entry) return
    this.scene.remove(entry.light)
    this.scene.remove(entry.marker)
    entry.marker.geometry.dispose()
    entry.markerMat.dispose()
    this.entries.delete(alias)
  }
}
