import * as THREE from 'three'
import type { BodyRenderStyle } from '../../hooks/useBodyFlags'

/** Owns the shared Wireframe + Hologram materials and the `apply()`
 *  swap. Single shared material instance keeps the look cohesive (same
 *  cyan tone everywhere) and minimizes draw-state changes. For
 *  Realistic we restore each mesh's original (PBR) material — captured
 *  lazily on first apply per mesh into `mesh.userData.bodyOriginalMaterial`. */
export class RenderStyleManager {
  private wireMat: THREE.MeshBasicMaterial
  private holoMat: THREE.MeshStandardMaterial

  constructor() {
    this.wireMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      wireframe: true,
    })
    this.holoMat = new THREE.MeshStandardMaterial({
      color: 0x00ccff,
      emissive: 0x00aaff,
      emissiveIntensity: 0.55,
      metalness: 0.1,
      roughness: 0.5,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      // Prevents self-occlusion artifacts on the translucent body.
      depthWrite: false,
    })
  }

  /** Apply the chosen style across every body mesh of `character`.
   *  Overlay meshes (tagged with `userData.isBodyOverlay`) are skipped
   *  — they live inside the character group too, but each carries its
   *  own per-overlay material that the tick loop mutates every frame;
   *  if we replaced theirs with our shared wireMat/holoMat, the next
   *  tick would mutate the shared instance and break the style for
   *  every body mesh that points at it. */
  apply(character: THREE.Group | null, style: BodyRenderStyle): void {
    if (!character) return
    character.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      if (mesh.userData.isBodyOverlay) return
      if (!mesh.userData.bodyOriginalMaterial) {
        mesh.userData.bodyOriginalMaterial = mesh.material
      }
      if (style === 'realistic') {
        mesh.material = mesh.userData.bodyOriginalMaterial
      } else if (style === 'wireframe') {
        mesh.material = this.wireMat
      } else if (style === 'hologram') {
        mesh.material = this.holoMat
      }
    })
  }

  dispose(): void {
    this.wireMat.dispose()
    this.holoMat.dispose()
  }
}
