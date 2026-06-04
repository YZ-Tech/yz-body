import { BLINK_DURATION_MS } from '../avatarConstants'
import type { BoneBindings } from './BoneBindings'

interface BlinkCtx {
  /** Master toggle. When false, the schedule resets so re-enabling
   *  waits a natural interval rather than firing immediately. */
  enabled: boolean
  bones: BoneBindings
  blinkIntervalMinMs: number
  blinkIntervalMaxMs: number
}

/** Per-tick blink scheduler. Tent function 0→1→0 over BLINK_DURATION_MS;
 *  intervals randomized between the configured min/max. Writes the
 *  computed weight to every (mesh, morph) pair in `bones.blinkTargets`. */
export class BlinkSystem {
  private blinkStartedAt = 0
  private nextBlinkAt: number

  constructor(initialIntervalMinMs: number) {
    this.nextBlinkAt = performance.now() + initialIntervalMinMs
  }

  step(now: number, ctx: BlinkCtx): void {
    let blinkWeight = 0
    if (ctx.enabled && ctx.bones.blinkTargets.length > 0) {
      if (this.blinkStartedAt === 0 && now >= this.nextBlinkAt) {
        this.blinkStartedAt = now
      }
      if (this.blinkStartedAt > 0) {
        const t = (now - this.blinkStartedAt) / BLINK_DURATION_MS
        if (t >= 1) {
          this.blinkStartedAt = 0
          this.nextBlinkAt = now +
            ctx.blinkIntervalMinMs +
            Math.random() * (ctx.blinkIntervalMaxMs - ctx.blinkIntervalMinMs)
        } else {
          blinkWeight = 1 - Math.abs(t * 2 - 1)
        }
      }
    } else {
      this.blinkStartedAt = 0
      this.nextBlinkAt = now + ctx.blinkIntervalMinMs
    }
    for (const { mesh, idx } of ctx.bones.blinkTargets) {
      if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[idx] = blinkWeight
    }
  }
}
