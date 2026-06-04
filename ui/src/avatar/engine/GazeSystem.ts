import * as THREE from 'three'
import {
  GAZE_LERP,
  GAZE_PITCH_MAX,
  GAZE_YAW_MAX,
  HEAD_FALLBACK_SCALE,
  SACCADE_MAX_MS,
  SACCADE_MIN_MS,
} from '../avatarConstants'
import type { BoneBindings } from './BoneBindings'

interface GazeCtx {
  /** Cursor in canvas NDC: x/y in [-1, +1]. */
  cursorNdc: { x: number; y: number }
  /** Bone bindings — degrades to head fallback if eye bones absent,
   *  no-op if head bone is absent too. */
  bones: BoneBindings
  /** Master toggle. When false, gaze relaxes to forward and saccades decay. */
  eyeTrack: boolean
  /** Saccade jitter amplitude (head-local units). */
  saccadeAmplitude: number
}

/** Smooth-pursuit gaze + saccade jitter. Per-tick state machine that
 *  smoothly lerps eye/head rotation toward cursor + jitter targets. */
export class GazeSystem {
  private gazeYaw = 0
  private gazePitch = 0
  private saccadeYawOff = 0
  private saccadePitchOff = 0
  private nextSaccadeAt = performance.now() + 800
  private tmpEuler = new THREE.Euler()
  private tmpQuat = new THREE.Quaternion()

  step(now: number, ctx: GazeCtx): void {
    const { cursorNdc, bones, eyeTrack, saccadeAmplitude } = ctx
    if (eyeTrack && now > this.nextSaccadeAt) {
      this.saccadeYawOff = (Math.random() * 2 - 1) * saccadeAmplitude
      this.saccadePitchOff = (Math.random() * 2 - 1) * saccadeAmplitude * 0.6
      this.nextSaccadeAt = now + SACCADE_MIN_MS + Math.random() * (SACCADE_MAX_MS - SACCADE_MIN_MS)
    } else if (!eyeTrack) {
      // Decay so re-enabling doesn't snap from a frozen offset.
      this.saccadeYawOff *= 0.9
      this.saccadePitchOff *= 0.9
    }
    const targetYaw = eyeTrack
      ? THREE.MathUtils.clamp(
          cursorNdc.x * GAZE_YAW_MAX + this.saccadeYawOff,
          -GAZE_YAW_MAX,
          GAZE_YAW_MAX,
        )
      : 0
    const targetPitch = eyeTrack
      ? THREE.MathUtils.clamp(
          -cursorNdc.y * GAZE_PITCH_MAX + this.saccadePitchOff,
          -GAZE_PITCH_MAX,
          GAZE_PITCH_MAX,
        )
      : 0
    this.gazeYaw += (targetYaw - this.gazeYaw) * GAZE_LERP
    this.gazePitch += (targetPitch - this.gazePitch) * GAZE_LERP

    // Eye bones first; fall back to scaled head rotation. Both apply
    // relative to rest pose so animation curves don't fight us.
    if (bones.eyeL && bones.eyeRestL && bones.eyeR && bones.eyeRestR) {
      const q = this.tmpQuat.setFromEuler(this.tmpEuler.set(this.gazePitch, this.gazeYaw, 0, 'YXZ'))
      bones.eyeL.quaternion.copy(bones.eyeRestL).multiply(q)
      bones.eyeR.quaternion.copy(bones.eyeRestR).multiply(q)
    } else if (bones.headBone && bones.headRest) {
      const q = this.tmpQuat.setFromEuler(
        this.tmpEuler.set(
          this.gazePitch * HEAD_FALLBACK_SCALE,
          this.gazeYaw * HEAD_FALLBACK_SCALE,
          0,
          'YXZ',
        ),
      )
      bones.headBone.quaternion.copy(bones.headRest).multiply(q)
    }
  }
}
