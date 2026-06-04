import * as THREE from 'three'
import { JAW_BONE_MAX_RAD, LIPSYNC_LERP } from '../avatarConstants'
import type { BoneBindings } from './BoneBindings'

interface LipsyncCtx {
  /** Whether the avatar is currently in `speaking` mode. */
  speaking: boolean
  /** Latest TTS audio RMS (0..1). */
  ttsRms: number
  /** Bone bindings — used for the morph-target list AND the jaw-bone
   *  fallback when no ARKit morph is present. */
  bones: BoneBindings
  /** RMS → morph weight gain. */
  lipsyncGain: number
  /** Cap on morph weight so peaks don't pop the jaw wide open. */
  lipsyncMax: number
}

/** Per-tick lipsync. Eases a smoothed jaw-open weight toward TTS RMS
 *  while speaking, decays to zero otherwise. Drives every face mesh
 *  with the configured jaw-open morph (face/head/teeth/eyes), or
 *  rotates the jaw bone if no morph is present. */
export class LipsyncSystem {
  private jawWeight = 0
  private tmpEuler = new THREE.Euler()
  private tmpQuat = new THREE.Quaternion()

  step(ctx: LipsyncCtx): void {
    const targetJaw = ctx.speaking
      ? THREE.MathUtils.clamp(ctx.ttsRms * ctx.lipsyncGain, 0, ctx.lipsyncMax)
      : 0
    this.jawWeight += (targetJaw - this.jawWeight) * LIPSYNC_LERP

    const { bones } = ctx
    if (bones.lipTargets.length > 0) {
      for (const { mesh, idx } of bones.lipTargets) {
        if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[idx] = this.jawWeight
      }
    } else if (bones.jawBone && bones.jawRest) {
      const q = this.tmpQuat.setFromEuler(
        this.tmpEuler.set(this.jawWeight * JAW_BONE_MAX_RAD, 0, 0, 'YXZ'),
      )
      bones.jawBone.quaternion.copy(bones.jawRest).multiply(q)
    }
  }
}
