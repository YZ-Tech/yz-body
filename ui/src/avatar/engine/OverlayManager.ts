import * as THREE from 'three'
import {
  buildOverlayLight,
  buildOverlayMesh,
  createOverlay,
  tickOverlay,
  triggerWLEDSpike,
  type BodyOverlay,
  type BodyOverlayConfig,
  type OverlayContext,
} from '../../lib/body/bodyOverlays'
import { registerLiveOverlayPatch } from '../../lib/body/liveOverlay'
import type { WLEDDevice } from '../../api/types'

/** Owns the body-overlay system:
 *  - active overlay list (one entry per enabled config)
 *  - cached body SkinnedMeshes (so live edits can re-extract without
 *    re-traversing the whole character)
 *  - per-frame driver tick (lerp current → target, apply to mesh + light)
 *  - WLED spike trigger on `wled` WS events
 *  - live-edit bypass (OverlayEditor mutates `ov.config` directly at 60Hz)
 *  - rebuild (shape change) + sync (value change) split that lets color
 *    drags + slider scrubs avoid mesh re-extraction
 *
 *  All overlay meshes are tagged with `userData.isBodyOverlay` (set by
 *  `buildOverlayMesh`) so RenderStyleManager.apply can skip them — see
 *  BUG.md for the regression that taught us this. */
export class OverlayManager {
  private overlays: BodyOverlay[] = []
  private cachedBodyMeshes: THREE.SkinnedMesh[] = []
  private scratch = { targetColor: new THREE.Color() }

  /** Register the live-edit bypass once the manager is constructed.
   *  Call this BEFORE rebuild so live patches landing during construction
   *  don't miss the manager. */
  installLivePatch(): void {
    registerLiveOverlayPatch((id, patch) => {
      const ov = this.overlays.find((o) => o.config.id === id)
      if (!ov) return
      const next = { ...ov.config, ...patch } as BodyOverlayConfig
      if (patch.flow !== undefined && patch.flow !== null) {
        next.flow = { ...(ov.config.flow ?? {}), ...patch.flow }
      }
      if (patch.driver !== undefined) {
        next.driver = { ...ov.config.driver, ...patch.driver } as BodyOverlayConfig['driver']
      }
      if (patch.light !== undefined && patch.light !== null) {
        next.light = {
          ...(ov.config.light ?? { attachToBone: '' }),
          ...patch.light,
        }
      }
      ov.config = next
    })
  }

  /** Full rebuild — used when shape-affecting fields change (bones,
   *  effect, weightThreshold, driver kind, light attach). Tears down
   *  existing meshes/lights, creates fresh overlays from configs, and
   *  attaches them if a character is already loaded. */
  rebuild(configs: BodyOverlayConfig[], character: THREE.Group | null): void {
    for (const o of this.overlays) {
      if (o.mesh) {
        o.mesh.parent?.remove(o.mesh)
        o.mesh.geometry?.dispose?.()
        const mat = o.mesh.material as THREE.Material | undefined
        mat?.dispose?.()
      }
      if (o.light) {
        o.light.parent?.remove(o.light)
      }
    }
    this.overlays = configs.filter((c) => c.enabled).map((c) => createOverlay(c))
    // If character is already loaded, build meshes immediately.
    // Otherwise extractFromCharacter (called by CharacterLoader) picks
    // this up.
    if (this.cachedBodyMeshes.length > 0 && character) {
      this.attachOverlays(character)
    }
  }

  /** Cheap counterpart to rebuild — re-points existing overlays at
   *  fresh configs so the next tick reads new color/driver values
   *  without rebuilding geometry. Used for color drags + slider scrubs. */
  sync(configs: BodyOverlayConfig[]): void {
    for (const c of configs) {
      const ov = this.overlays.find((o) => o.config.id === c.id)
      if (ov) ov.config = c
    }
  }

  /** Rediscover body SkinnedMeshes on the new character and re-attach
   *  overlays. Called by CharacterLoader after a character swap. */
  extractFromCharacter(character: THREE.Group): void {
    this.cachedBodyMeshes.length = 0
    character.traverse((o) => {
      const sm = o as THREE.SkinnedMesh
      if (sm.isSkinnedMesh && sm.geometry?.attributes?.skinIndex) {
        this.cachedBodyMeshes.push(sm)
      }
    })
    this.attachOverlays(character)
  }

  /** Null overlay mesh/light refs on character swap so the next
   *  extractFromCharacter rebuilds them on the new skeleton.
   *  DELIBERATELY don't reset target color/intensity — those reflect
   *  live driver signals and resetting them races with WLED store
   *  fetches that resolved before the character load finished. */
  resetForCharacterSwap(): void {
    for (const o of this.overlays) {
      o.mesh = null
      o.light = null
      o.spikeUntilMs = 0
    }
  }

  /** Per-frame: driver → target color/intensity, lerp, apply to mesh
   *  material + optional surface-tint light. */
  tick(ctx: OverlayContext): void {
    for (const o of this.overlays) tickOverlay(o, ctx, this.scratch)
  }

  /** Bump the spike timer for overlays whose driver matches this WLED
   *  device. Steady-state color + intensity come from the per-frame
   *  driver reading the store directly. */
  triggerSpike(device: WLEDDevice): void {
    triggerWLEDSpike(this.overlays, device, performance.now())
  }

  /** Tear down the live-edit hook on scene unmount. */
  dispose(): void {
    registerLiveOverlayPatch(null)
  }

  private attachOverlays(character: THREE.Group): void {
    for (const overlay of this.overlays) {
      const built = buildOverlayMesh(this.cachedBodyMeshes, overlay.config)
      if (!built) {
        console.warn(
          `[body] overlay ${overlay.config.id}: extraction failed (no matching triangles)`,
        )
        continue
      }
      overlay.mesh = built.mesh
      ;(built.fromBody.parent || character).add(built.mesh)
      console.log(
        `[body] overlay ${overlay.config.id}: ${built.tris} tris from ${built.fromBody.name || '(unnamed)'}`,
      )
      const lit = buildOverlayLight(built.fromBody.skeleton, overlay.config)
      if (lit) {
        overlay.light = lit.light
        lit.light.position.set(0, 0.08, 0)
        lit.bone.add(lit.light)
      }
    }
  }
}
