import * as THREE from 'three'
import { JAW_BONE_MAX_RAD, LIPSYNC_LERP } from '../avatarConstants'
import type { BoneBindings } from './BoneBindings'
import type { VisemeFrame } from './VisemeController'

interface LipsyncCtx {
  /** Whether the avatar is currently in `speaking` mode. */
  speaking: boolean
  /** Latest TTS audio RMS (0..1). */
  ttsRms: number
  /** Bone bindings — morph-target lists + the jaw-bone fallback. */
  bones: BoneBindings
  /** RMS → morph weight gain. */
  lipsyncGain: number
  /** Cap on morph weight so peaks don't pop the jaw wide open. */
  lipsyncMax: number
  /** Current neurosync ARKit mouth frame (indices lo..hi), or null to use the
   *  amplitude (RMS→jaw) path. Present only when a viseme track is playing AND
   *  the backend lipsync engine is `neurosync`. */
  visemeFrame: VisemeFrame | null
}

/** Per-tick lipsync. Two modes, auto-selected by track presence:
 *   • neurosync — a real ARKit mouth track is playing → ease every bound mouth
 *     morph (14..40) toward the track frame (sample-synced to the broadcast audio).
 *   • amplitude — no track → ease a single jaw-open weight toward TTS RMS while
 *     speaking, decaying to zero otherwise (the original behaviour), and release
 *     any leftover viseme shape back to neutral. */
export class LipsyncSystem {
  private jawWeight = 0
  // Smoothed per-ARKit-index viseme weights (index → current value).
  private visemeCur = new Float32Array(64)
  private tmpEuler = new THREE.Euler()
  private tmpQuat = new THREE.Quaternion()

  step(ctx: LipsyncCtx): void {
    const { bones } = ctx

    if (ctx.visemeFrame && bones.visemeByIndex.size > 0) {
      this.applyVisemes(ctx.visemeFrame, bones)
      return
    }

    // No track this frame — release any neurosync mouth shape back to neutral so
    // the mouth doesn't freeze in the last viseme when the utterance ends.
    if (bones.visemeByIndex.size > 0) {
      for (const [idx, targets] of bones.visemeByIndex) {
        if (this.visemeCur[idx] <= 0.001) continue
        const v = this.visemeCur[idx] * (1 - LIPSYNC_LERP)
        this.visemeCur[idx] = v
        for (const { mesh, idx: mi } of targets) {
          if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[mi] = v
        }
      }
    }

    // Amplitude fallback: RMS → jaw-open morph (or jaw-bone rotation).
    const targetJaw = ctx.speaking
      ? THREE.MathUtils.clamp(ctx.ttsRms * ctx.lipsyncGain, 0, ctx.lipsyncMax)
      : 0
    this.jawWeight += (targetJaw - this.jawWeight) * LIPSYNC_LERP

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

  private applyVisemes(frame: VisemeFrame, bones: BoneBindings): void {
    const { lo, hi, weights } = frame
    for (let idx = lo; idx <= hi; idx++) {
      const target = weights[idx - lo] ?? 0
      const cur = this.visemeCur[idx]
      const v = cur + (target - cur) * LIPSYNC_LERP
      this.visemeCur[idx] = v
      const targets = bones.visemeByIndex.get(idx)
      if (!targets) continue
      for (const { mesh, idx: mi } of targets) {
        if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[mi] = v
      }
    }
  }
}
