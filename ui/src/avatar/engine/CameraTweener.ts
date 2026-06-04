import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CAMERA_TWEEN_MS } from '../avatarConstants'

/** Drives Home/Face camera reset animations. While a tween is active,
 *  `step(now)` lerps `camera.position` + `controls.target` from the
 *  captured start to the new end via easeInOutCubic. After the tween
 *  window expires, the next `step` snaps to the final pose (kills sub-
 *  pixel drift) and goes idle. */
export class CameraTweener {
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private startPos = new THREE.Vector3()
  private endPos = new THREE.Vector3()
  private startTarget = new THREE.Vector3()
  private endTarget = new THREE.Vector3()
  private animUntil = 0
  private animDuration = 0

  constructor(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
    this.camera = camera
    this.controls = controls
  }

  /** Capture current pose as the start, set the end pose, arm the tween. */
  startTween(
    endPos: [number, number, number],
    endTarget: [number, number, number],
  ): void {
    this.startPos.copy(this.camera.position)
    this.startTarget.copy(this.controls.target)
    this.endPos.set(...endPos)
    this.endTarget.set(...endTarget)
    this.animDuration = CAMERA_TWEEN_MS
    this.animUntil = performance.now() + CAMERA_TWEEN_MS
  }

  /** Per-frame advance. Call after `mixer.update(dt)`, before
   *  `controls.update()` — the latter picks up the new orbit target. */
  step(now: number): void {
    if (this.animUntil > now) {
      const remaining = this.animUntil - now
      const t = Math.min(1, 1 - remaining / this.animDuration)
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      this.camera.position.lerpVectors(this.startPos, this.endPos, eased)
      this.controls.target.lerpVectors(this.startTarget, this.endTarget, eased)
    } else if (this.animDuration > 0) {
      // Snap to final on the frame after expiry to kill sub-pixel drift.
      this.camera.position.copy(this.endPos)
      this.controls.target.copy(this.endTarget)
      this.animDuration = 0
    }
  }
}
