import * as THREE from 'three'

/** Arm bones we drive when pointing at a target. Two naming conventions:
 *  avatar1.glb-style unprefixed names + Mixamo-prefixed variants. Same
 *  pattern BodyAvatar uses for eye/head/jaw bone discovery. */
export const POINT_ARM_BONE_CANDIDATES = {
  rightArm:     ['RightArm', 'mixamorigRightArm', 'rightarm', 'Arm.R', 'arm_R'],
  rightForeArm: ['RightForeArm', 'mixamorigRightForeArm', 'rightforearm', 'ForeArm.R', 'forearm_R'],
  leftArm:      ['LeftArm', 'mixamorigLeftArm', 'leftarm', 'Arm.L', 'arm_L'],
  leftForeArm:  ['LeftForeArm', 'mixamorigLeftForeArm', 'leftforearm', 'ForeArm.L', 'forearm_L'],
} as const

/** Slight static elbow bend during the point — ~12°, enough so the arm
 *  doesn't read as a stick. Applied locally to the forearm bone around
 *  its bone-local X axis, scaled by the tween weight. */
export const POINT_ELBOW_BEND_RAD = 0.21
/** Default peak-hold duration when the caller doesn't override. */
export const POINT_DEFAULT_HOLD_MS = 1200
/** Default ease-in / ease-out duration when the caller doesn't override. */
export const POINT_DEFAULT_EASE_MS = 350

export interface PointBones {
  armR: THREE.Bone | null
  foreArmR: THREE.Bone | null
  armL: THREE.Bone | null
  foreArmL: THREE.Bone | null
  /** Forearm bind-pose quaternions, captured once at discovery. The
   *  elbow-bend step in `applyPointIK` slerps the forearm toward
   *  (restQuat * bend) — an ABSOLUTE target — so it converges to a
   *  stable pose. The previous multiplicative `forearm.quaternion *= bend`
   *  worked on the dashboard (where mixer.update reset the bone each
   *  frame) but caused unbounded rotation in mixer-free scenes like the
   *  locator preview, where the rotation just compounded. */
  foreArmRRest: THREE.Quaternion | null
  foreArmLRest: THREE.Quaternion | null
}

export function emptyPointBones(): PointBones {
  return {
    armR: null, foreArmR: null, armL: null, foreArmL: null,
    foreArmRRest: null, foreArmLRest: null,
  }
}

/** Walk `root` looking for the four arm bones by candidate name. Nulls
 *  for any not found — `applyPointIK` checks and no-ops if the arm
 *  side is missing. Cheap to call; safe to re-run on character swap. */
export function discoverPointBones(root: THREE.Object3D): PointBones {
  const out = emptyPointBones()
  const tryFind = (candidates: readonly string[]): THREE.Bone | null => {
    let hit: THREE.Bone | null = null
    root.traverse((o) => {
      if (hit) return
      if ((o as THREE.Bone).isBone && candidates.includes(o.name)) {
        hit = o as THREE.Bone
      }
    })
    return hit
  }
  out.armR     = tryFind(POINT_ARM_BONE_CANDIDATES.rightArm)
  out.foreArmR = tryFind(POINT_ARM_BONE_CANDIDATES.rightForeArm)
  out.armL     = tryFind(POINT_ARM_BONE_CANDIDATES.leftArm)
  out.foreArmL = tryFind(POINT_ARM_BONE_CANDIDATES.leftForeArm)
  // Capture forearm bind quats — discovery is called before any
  // animation runs (or in the locator's mixer-free case, the forearms
  // simply ARE at bind), so the live quaternion equals the bind pose.
  if (out.foreArmR) out.foreArmRRest = out.foreArmR.quaternion.clone()
  if (out.foreArmL) out.foreArmLRest = out.foreArmL.quaternion.clone()
  return out
}

/** Pick which arm to use for pointing at `target`. Explicit hint wins;
 *  'auto' (default) falls back to whichever shoulder is closer to the
 *  target — across-the-body reach reads as awkward, this avoids it. */
export function pickPointArm(
  bones: PointBones,
  target: THREE.Vector3,
  hint: 'auto' | 'left' | 'right' = 'auto',
): 'left' | 'right' {
  if (hint === 'left' || hint === 'right') return hint
  if (bones.armR && !bones.armL) return 'right'
  if (bones.armL && !bones.armR) return 'left'
  if (!bones.armR || !bones.armL) return 'right' // both null — caller no-ops anyway
  const sR = new THREE.Vector3()
  const sL = new THREE.Vector3()
  bones.armR.getWorldPosition(sR)
  bones.armL.getWorldPosition(sL)
  return sR.distanceTo(target) <= sL.distanceTo(target) ? 'right' : 'left'
}

/** Pre-allocated scratch space for one IK pass. Allocating Vector3s /
 *  Quaternions every frame would churn ~hundreds of objects/sec at
 *  60Hz — one set per caller, reused across frames. */
export interface PointScratch {
  vecA: THREE.Vector3
  vecB: THREE.Vector3
  vecC: THREE.Vector3
  vecD: THREE.Vector3
  quatA: THREE.Quaternion
  quatB: THREE.Quaternion
  quatC: THREE.Quaternion
  quatD: THREE.Quaternion
}

export function createPointScratch(): PointScratch {
  return {
    vecA: new THREE.Vector3(),
    vecB: new THREE.Vector3(),
    vecC: new THREE.Vector3(),
    vecD: new THREE.Vector3(),
    quatA: new THREE.Quaternion(),
    quatB: new THREE.Quaternion(),
    quatC: new THREE.Quaternion(),
    quatD: new THREE.Quaternion(),
  }
}

/** Apply pointing IK to the chosen arm. Single-bone aim: rotates the
 *  shoulder so the line shoulder→forearm aims at `target`, then adds a
 *  small static elbow bend. Both rotations are slerped from the bone's
 *  current local quaternion by `weight` — so weight=0 leaves the bone
 *  untouched (whatever owns it: animation, bind pose), weight=1 fully
 *  overrides.
 *
 *  Call this AFTER `mixer.update()` (or any other source of bone
 *  poses) — we slerp FROM the current bone state, so the result blends
 *  smoothly with whatever is driving the bone otherwise. Recomputes
 *  matrixWorld internally so getWorldPosition reads reflect this
 *  frame's pose. */
export function applyPointIK(
  rootForMatrixWorld: THREE.Object3D,
  bones: PointBones,
  arm: 'left' | 'right',
  target: THREE.Vector3,
  weight: number,
  s: PointScratch,
): void {
  if (weight <= 0) return
  const shoulder = arm === 'right' ? bones.armR : bones.armL
  const forearm = arm === 'right' ? bones.foreArmR : bones.foreArmL
  if (!shoulder || !forearm) return

  // matrixWorld is stale immediately after mixer.update — the renderer's
  // pre-render traversal is what normally refreshes it. We need it
  // current right now so getWorldPosition returns this frame's pose.
  rootForMatrixWorld.updateMatrixWorld(true)
  const S = shoulder.getWorldPosition(s.vecA)
  const E = forearm.getWorldPosition(s.vecB)
  const currentForwardWorld = s.vecC.copy(E).sub(S).normalize()
  const targetForwardWorld = s.vecD.copy(target).sub(S).normalize()
  if (targetForwardWorld.lengthSq() <= 1e-6) return

  // World-space delta quat: rotate currentForward → targetForward.
  s.quatA.setFromUnitVectors(currentForwardWorld, targetForwardWorld)
  shoulder.getWorldQuaternion(s.quatB)
  s.quatC.copy(s.quatA).multiply(s.quatB) // new desired world quat for shoulder
  const parent = shoulder.parent
  if (parent) {
    parent.getWorldQuaternion(s.quatD)
    s.quatD.invert().multiply(s.quatC) // → bone-local
    shoulder.quaternion.slerp(s.quatD, weight)
  }

  // Small elbow bend — slerp the forearm toward an ABSOLUTE target
  // (bind quat * fixed bend) by weight. Absolute baseline avoids the
  // unbounded-rotation bug a multiplicative approach has in mixer-free
  // scenes (locator preview), where each frame would compound the bend
  // because nothing else resets the forearm's quaternion. weight=0
  // leaves the bone untouched (slerp by 0 = no-op).
  const restQuat = arm === 'right' ? bones.foreArmRRest : bones.foreArmLRest
  if (restQuat) {
    s.quatA.setFromAxisAngle(s.vecA.set(1, 0, 0), POINT_ELBOW_BEND_RAD)
    s.quatB.copy(restQuat).multiply(s.quatA) // target = rest * bend
    forearm.quaternion.slerp(s.quatB, weight)
  }
}

/** Tween state for an "ease-in → hold → ease-out" pointing gesture used
 *  by BodyAvatar's dashboard rendering. The locator preview uses a
 *  simpler smoothed-approach-weight model instead (no fixed hold), so
 *  this struct + its helpers only matter for the time-bounded dashboard
 *  case. */
export interface PointTween {
  target: THREE.Vector3 | null
  weight: number
  phase: 'idle' | 'easeIn' | 'hold' | 'easeOut'
  phaseStartedAt: number
  holdMs: number
  easeMs: number
  arm: 'left' | 'right'
}

export function createPointTween(): PointTween {
  return {
    target: null,
    weight: 0,
    phase: 'idle',
    phaseStartedAt: 0,
    holdMs: POINT_DEFAULT_HOLD_MS,
    easeMs: POINT_DEFAULT_EASE_MS,
    arm: 'right',
  }
}

/** Kick off a fresh point. Replaces any in-flight tween — the new aim
 *  wins immediately (no blending of stacked points). Caller passes
 *  target as [x, y, z] world-space coords. */
export function startPointTween(
  tween: PointTween,
  bones: PointBones,
  target: [number, number, number],
  opts: { hold_ms?: number; ease_ms?: number; arm?: 'auto' | 'left' | 'right' } = {},
): void {
  const tv = new THREE.Vector3(target[0], target[1], target[2])
  tween.target = tv
  tween.holdMs = Math.max(0, opts.hold_ms ?? POINT_DEFAULT_HOLD_MS)
  tween.easeMs = Math.max(50, opts.ease_ms ?? POINT_DEFAULT_EASE_MS)
  tween.arm = pickPointArm(bones, tv, opts.arm)
  tween.phase = 'easeIn'
  tween.phaseStartedAt = performance.now()
}

/** Reset a tween mid-flight (e.g., on character swap). Drops the target
 *  and returns the tween to idle without running ease-out. */
export function resetPointTween(tween: PointTween): void {
  tween.target = null
  tween.weight = 0
  tween.phase = 'idle'
}

/** Advance the tween's weight + phase based on wall-clock `now`. Returns
 *  whether the tween is currently active (true if non-idle, false if
 *  settled to idle). easeInOutCubic for both directions — gives a soft
 *  S-curve that reads as natural muscle motion. */
export function advancePointTween(tween: PointTween, now: number): boolean {
  if (tween.phase === 'idle') return false
  const elapsed = now - tween.phaseStartedAt
  if (tween.phase === 'easeIn') {
    const t = Math.min(1, elapsed / tween.easeMs)
    tween.weight = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    if (t >= 1) {
      tween.weight = 1
      tween.phase = 'hold'
      tween.phaseStartedAt = now
    }
  } else if (tween.phase === 'hold') {
    tween.weight = 1
    if (elapsed >= tween.holdMs) {
      tween.phase = 'easeOut'
      tween.phaseStartedAt = now
    }
  } else if (tween.phase === 'easeOut') {
    const t = Math.min(1, elapsed / tween.easeMs)
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    tween.weight = 1 - eased
    if (t >= 1) {
      tween.weight = 0
      tween.phase = 'idle'
      tween.target = null
    }
  }
  return true
}
