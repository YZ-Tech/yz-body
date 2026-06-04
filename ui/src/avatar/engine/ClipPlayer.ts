import * as THREE from 'three'
import type { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { MutableRefObject } from 'react'
import type { BodyBehaviorEffective } from '../../lib/body/behavior'
import type { BodyClipPools, BodyMode } from '../../hooks/useBodyClipPools'
import { animUrl } from '../avatarConstants'
import { normalizeClip } from '../../lib/body/normalizeClip'
import { sourceRigFor, type RigType } from './rigRemap'

// Cache-bust once per app boot, not once per request. The previous
// `?v=${Date.now()}` defeated browser cache + service worker + CDN on
// every load — meaning every cold session re-downloaded every FBX/GLB
// clip (1-10MB each, dozens of clips). Module-level eval pins this to
// a single value for the session; subsequent reloads pick up a new id
// and flush stale URLs after a rebake.
const SESSION_VERSION = `?v=${Date.now()}`

/** Owns the mixer + everything that drives clip playback:
 *  - clip cache + lazy loader (FBX / GLB)
 *  - base channel (mode-pool clips)
 *  - additive overlay channel (`builtin:` gestures)
 *  - motion sequence scheduler (lock + queue + post-speaking-hold)
 *  - per-tick mode-pool scheduler (mode change / re-pick / motion-end edges)
 *
 *  The scene effect's render-tick calls `stepTick(currentMode)` once per
 *  frame. Imperative `playClip` / `playMotion` come from React bridges
 *  (settings preview, Loom motion ui_commands). CharacterLoader calls
 *  `setMixer` / `resetForCharacterSwap` on character swap. */

export interface ClipPlayerDeps {
  gltfLoader: GLTFLoader
  fbxLoader: FBXLoader
  /** Live behavior (crossfadeS, repickAfterS) — read per-call so user
   *  edits propagate without recreating the player. */
  behaviorRef: MutableRefObject<BodyBehaviorEffective>
  /** Live clip pools per mode. */
  poolsRef: MutableRefObject<BodyClipPools>
  /** Per-clip gender (`male` / `female` / `neutral`). */
  clipGendersRef: MutableRefObject<Record<string, string>>
  /** Character gender — used to filter the pool. */
  activeGenderRef: MutableRefObject<'male' | 'female' | undefined>
  /** Bare-filename → folder-prefixed-path resolver. */
  clipBasenameMapRef: MutableRefObject<Record<string, string>>
  /** Active character's rig type — drives bone-name remapping on clip
   *  load so a Mixamo .fbx can drive a Quaternius mannequin and vice
   *  versa. Updated by Avatar.tsx on character swap. */
  targetRigRef: MutableRefObject<RigType>
  /** Store action: update the active-clip chip across the app. */
  setBodyCurrentClip: (name: string) => void
  /** Initial mode so `stepTick` can detect the first mode change. */
  initialMode: BodyMode
}

/** Walk an Object3D and return the first SkinnedMesh found, or null.
 *  Used to grab the source mesh from a freshly-loaded clip file and
 *  the target mesh from the active character — SkeletonUtils.retargetClip
 *  needs both to walk their skeletons + compute bind-pose deltas. */
function findFirstSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null
  root.traverse((o) => {
    if (!found && (o as THREE.SkinnedMesh).isSkinnedMesh) {
      found = o as THREE.SkinnedMesh
    }
  })
  return found
}

export class ClipPlayer {
  private deps: ClipPlayerDeps
  private mixer: THREE.AnimationMixer | null = null
  private clipCache = new Map<string, THREE.AnimationClip>()
  // Live target SkinnedMesh — kept for diagnostic logging on character
  // swap (so we know whether a SkinnedMesh was found). Cross-rig
  // retargeting is currently DISABLED so this is informational only;
  // see the comment in getClip for why.
  private retargetTargetMesh: THREE.SkinnedMesh | null = null

  // Base channel — full-body animation (idle / talking / etc.).
  private currentAction: THREE.AnimationAction | null = null
  private currentClipName: string | null = null
  private lastPickAt = performance.now()
  // Overlay channel — additive `builtin:` clips layered on top.
  private currentOverlayAction: THREE.AnimationAction | null = null

  // Motion sequence — suppresses pool reshuffles while a play_body_motion
  // sequence is in flight. mixer 'finished' advances the queue.
  private motionLocked = false
  private motionQueue: string[] = []
  // 'once'/'loop' applies only to the FINAL clip; intermediates play once.
  private motionFinalMode: 'once' | 'loop' = 'once'
  // Signals to stepTick that a sequence just ended — forces a re-pick
  // against CURRENT mode (which may have changed during the lock).
  private motionJustEnded = false
  // Motion finished while still 'speaking' — hold the clamped pose
  // until TTS ends rather than overwrite with a random talking-X clip.
  private motionPostHold = false

  // Tick scheduler — last mode we acted on. Drives mode-change pool picks.
  private lastObservedMode: BodyMode

  constructor(deps: ClipPlayerDeps) {
    this.deps = deps
    this.lastObservedMode = deps.initialMode
  }

  /** Called by CharacterLoader once the new mixer is constructed. */
  setMixer(mixer: THREE.AnimationMixer | null): void {
    this.mixer = mixer
    if (!mixer) return
    mixer.addEventListener('finished', this.onMixerFinished)
  }

  /** Per-frame mixer advance. Forwarded to `mixer.update(dt)`; no-op
   *  before a character has loaded. */
  update(dt: number): void {
    this.mixer?.update(dt)
  }

  /** Reset playback state on character swap. Clip cache is bound to the
   *  previous skeleton's track names so it has to clear. */
  resetForCharacterSwap(): void {
    this.clipCache.clear()
    this.currentAction = null
    this.currentClipName = null
    this.currentOverlayAction = null
    this.motionQueue = []
    this.motionLocked = false
    this.motionJustEnded = false
    this.motionPostHold = false
  }

  /** Pull a clip from the active mode pool (gender-filtered) and play
   *  it. Used by initial-load + the scheduler. */
  async playFromPool(m: BodyMode, force = false): Promise<void> {
    if (!this.mixer) return
    const rawPool = this.deps.poolsRef.current[m]
    if (!rawPool || rawPool.length === 0) return
    const ag = this.deps.activeGenderRef.current
    const cg = this.deps.clipGendersRef.current
    const pool = ag
      ? rawPool.filter((p) => {
          const g = cg[p] ?? 'neutral'
          return g === 'neutral' || g === ag
        })
      : rawPool
    const eligible = pool.length > 0 ? pool : rawPool
    if (!force && this.currentClipName && eligible.includes(this.currentClipName)) return
    // Avoid immediate replay of the same clip when possible.
    const candidates = eligible.filter((p) => p !== this.currentClipName)
    // No alternative available — the only eligible clip IS what's
    // already playing. Skip even on force: restarting the same clip
    // causes a fadeIn-from-0 flash to bind pose (T-pose on Quaternius
    // rigs). Bump lastPickAt so the scheduler waits another full
    // repickAfterS before trying again.
    if (candidates.length === 0) {
      this.lastPickAt = performance.now()
      return
    }
    const pick = candidates[Math.floor(Math.random() * candidates.length)]
    await this.playClip(pick)
  }

  /** Crossfade to a specific clip. `builtin:` routes to the overlay
   *  channel; everything else replaces the base channel. */
  async playClip(name: string): Promise<void> {
    if (!this.mixer) return
    if (name.startsWith('builtin:')) {
      await this.playOverlay(name)
      return
    }
    // Same-clip guard. playFromPool already short-circuits the timer
    // re-pick case, but playClip is also called from settings preview
    // and motion-side bridges. Restarting the same clip via reset() +
    // fadeIn() drops the action's weight to 0 and ramps it back to 1
    // over `xfade` seconds; with no other action covering, every bone
    // lerps toward its bind pose (T-pose on Quaternius rigs).
    if (name === this.currentClipName && this.currentAction) {
      this.lastPickAt = performance.now()
      return
    }
    const clip = await this.getClip(name)
    if (!clip || !this.mixer) return
    // ROOT-CAUSE GUARD: a motion may have landed during our getClip
    // await. The tick suppresses pool picks while motionLocked is set,
    // but a pick that began BEFORE the lock is still in flight here.
    // Same for motionPostHold (we hold the motion's final pose until
    // TTS ends; a late pool pick must not break that).
    if (this.motionLocked || this.motionPostHold) return
    const xfade = this.deps.behaviorRef.current.crossfadeS
    const next = this.mixer.clipAction(clip)
    next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(xfade).play()
    if (this.currentAction && this.currentAction !== next) {
      this.currentAction.fadeOut(xfade)
    }
    this.currentAction = next
    this.currentClipName = name
    this.deps.setBodyCurrentClip(name)
    this.lastPickAt = performance.now()
  }

  /** Play a sequence of clips back-to-back. First clip plays
   *  immediately; remainder queue and fire on `mixer.finished`.
   *  `mode` applies to the FINAL clip only — intermediates play once. */
  async playMotion(clips: string[], mode: 'once' | 'loop' = 'once'): Promise<void> {
    if (!this.mixer || clips.length === 0) return
    this.motionQueue = clips.slice(1)
    this.motionFinalMode = mode
    const firstMode: 'once' | 'loop' = clips.length === 1 ? mode : 'once'
    await this.playOneMotion(clips[0], firstMode)
  }

  /** Per-frame scheduler. Suppressed during motionLocked (sequence
   *  playing) and motionPostHold (motion ended while still speaking —
   *  hold the clamped pose until TTS finishes). */
  stepTick(currentMode: BodyMode): void {
    if (this.motionJustEnded) {
      this.motionJustEnded = false
      if (currentMode === 'speaking') {
        this.motionPostHold = true
      } else {
        this.lastObservedMode = currentMode
        void this.playFromPool(this.lastObservedMode, true)
      }
    } else if (this.motionPostHold && currentMode !== 'speaking') {
      this.motionPostHold = false
      this.lastObservedMode = currentMode
      void this.playFromPool(this.lastObservedMode, true)
    } else if (currentMode !== this.lastObservedMode) {
      this.lastObservedMode = currentMode
      if (!this.motionLocked && !this.motionPostHold) {
        void this.playFromPool(this.lastObservedMode, true)
      }
    } else if (
      !this.motionLocked &&
      !this.motionPostHold &&
      performance.now() - this.lastPickAt > this.deps.behaviorRef.current.repickAfterS * 1000
    ) {
      void this.playFromPool(this.lastObservedMode, true)
    }
  }

  /** Dev-only introspection used by the Playwright race spec. Lists every
   *  active mixer action with its effective weight + running state. */
  inspect(): { clip: string; weight: number; running: boolean }[] {
    if (!this.mixer) return []
    const actions = (this.mixer as unknown as { _actions: THREE.AnimationAction[] })._actions
    return actions.map((a) => ({
      clip: a.getClip().name,
      weight: a.getEffectiveWeight(),
      running: a.isRunning(),
    }))
  }

  // ── Internals ──────────────────────────────────────────────────────

  /** Fetch + cache a clip by name. Resolves bare filenames (canned
   *  replies, MOTION_CATALOG_BLOCK) via the basename map. `builtin:`
   *  clips live in the GLB and are registered at character load (not
   *  currently used). Cache-busts on first load to dodge stale URLs
   *  after re-bakes. */
  private async getClip(name: string): Promise<THREE.AnimationClip | null> {
    if (name.startsWith('builtin:')) {
      const cachedBuiltin = this.clipCache.get(name)
      if (cachedBuiltin) return cachedBuiltin
      console.warn(`[body] builtin clip not found on current character: ${name}`)
      return null
    }
    const resolved = name.includes('/')
      ? name
      : (this.deps.clipBasenameMapRef.current[name] ?? name)
    // Cache key includes target rig — the same source clip is remapped
    // differently for a Mixamo vs Quaternius character, so we can't
    // reuse one cached AnimationClip across rig types.
    const tgtRig = this.deps.targetRigRef.current
    const cacheKey = `${resolved}@${tgtRig}`
    const cached = this.clipCache.get(cacheKey)
    if (cached) return cached
    try {
      let clip: THREE.AnimationClip | undefined
      if (resolved.toLowerCase().endsWith('.glb') || resolved.toLowerCase().endsWith('.gltf')) {
        const gltf = await this.deps.gltfLoader.loadAsync(animUrl(`${resolved}${SESSION_VERSION}`))
        clip = gltf.animations[0]
      } else {
        const fbx = await this.deps.fbxLoader.loadAsync(animUrl(`${resolved}${SESSION_VERSION}`))
        clip = fbx.animations[0]
      }
      if (!clip) return null
      // Cross-rig retargeting — SkeletonUtils.retargetClip rewrites the
      // clip relative to the TARGET skeleton's bind pose. This handles
      // per-bone rest-pose differences (twisted spine, slouched arms,
      // tilted head) that a pure name swap can't fix. Skips silently
      // when same-rig, when no target SkinnedMesh is registered yet,
      // or when the source GLB has no SkinnedMesh (e.g. our mesh-
      // stripped Quaternius extractions used on a Mixamo character —
      // rare path; the clip falls back to name-matched apply).
      // Cross-rig retargeting is DISABLED. We had multiple attempts
      // (simple name remap, name remap + pelvis 90° hack, SkeletonUtils
      // .retargetClip, full bind-pose conjugation formula) — each
      // produced a visually wrong result (tipped, folded, inverted, or
      // disappeared) because Quaternius and Mixamo have incompatible
      // bind poses (Quaternius bakes coordinate convention into bone
      // rest rotations: -90°X root, +104°X pelvis, +166°X thighs;
      // Mixamo uses identity rests). No runtime math can perfectly
      // reconcile this; the proper fix is offline pre-baked retargeting
      // (Blender), an asset re-rig, or using each rig's native clips.
      // For now: cross-rig clips play as-is — the mixer silently drops
      // tracks whose bones don't exist on the target, so the character
      // stays at its rest pose for those bones. BotM effectively only
      // plays Quaternius UAL clips; Loom/Yeon only play Mixamo clips.
      const srcRig = sourceRigFor(resolved)
      const didRetarget = false
      if (srcRig !== tgtRig) {
        console.warn(
          `[body] cross-rig clip ${resolved} (src=${srcRig} tgt=${tgtRig}) — retargeting disabled; tracks targeting missing bones will be dropped by the mixer`,
        )
      }
      normalizeClip(clip, didRetarget)
      clip.name = resolved
      this.clipCache.set(cacheKey, clip)
      return clip
    } catch (e) {
      console.warn(`[body] failed to load anim ${resolved}:`, e)
      return null
    }
  }

  /** Called by CharacterLoader after a character swap. We hold a
   *  reference to the active character's SkinnedMesh so cross-rig
   *  retargeting can compute bind-pose-correct track values against
   *  the target skeleton. Clearing the cache is required — cached
   *  clips were retargeted for the PREVIOUS target. */
  setRetargetTarget(target: THREE.Object3D | null): void {
    this.retargetTargetMesh = target ? findFirstSkinnedMesh(target) : null
    console.log(
      `[body] setRetargetTarget: ${
        this.retargetTargetMesh
          ? `found SkinnedMesh "${this.retargetTargetMesh.name}" (skeleton bones=${this.retargetTargetMesh.skeleton.bones.length})`
          : 'no SkinnedMesh in character'
      }`,
    )
    this.clipCache.clear()
  }

  /** Crossfade an additive (`builtin:`) clip on the overlay channel. */
  private async playOverlay(name: string): Promise<void> {
    if (!this.mixer) return
    const clip = await this.getClip(name)
    if (!clip || !this.mixer) return
    const xfade = this.deps.behaviorRef.current.crossfadeS
    const next = this.mixer.clipAction(clip)
    next.blendMode = THREE.AdditiveAnimationBlendMode
    next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(xfade).play()
    if (this.currentOverlayAction && this.currentOverlayAction !== next) {
      this.currentOverlayAction.fadeOut(xfade)
    }
    this.currentOverlayAction = next
    this.deps.setBodyCurrentClip(name)
    this.lastPickAt = performance.now()
  }

  /** Crossfade one motion clip, configure looping, take the motion lock.
   *  Used by both the sequence entrypoint and the chaining handler. */
  private async playOneMotion(name: string, mode: 'once' | 'loop'): Promise<void> {
    if (!this.mixer) return
    const clip = await this.getClip(name)
    if (!clip || !this.mixer) {
      if (!clip) console.warn(`[body] motion clip not found: ${name}`)
      return
    }
    // Diagnostic: track count + first track name pinpoints prefix /
    // naming mismatches when a clip plays as a silent no-op.
    console.log(
      `[body] motion ${name} → ${clip.tracks.length} tracks, dur=${clip.duration.toFixed(2)}s, sample:`,
      clip.tracks[0]?.name,
    )
    const xfade = this.deps.behaviorRef.current.crossfadeS
    const next = this.mixer.clipAction(clip)
    if (mode === 'once') {
      next.setLoop(THREE.LoopOnce, 1)
      next.clampWhenFinished = true
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity)
      next.clampWhenFinished = false
    }
    next.reset().fadeIn(xfade).play()
    if (this.currentAction && this.currentAction !== next) {
      this.currentAction.fadeOut(xfade)
    }
    this.currentAction = next
    this.currentClipName = name
    this.deps.setBodyCurrentClip(`${name} ⚡`)
    this.lastPickAt = performance.now()
    this.motionLocked = true
  }

  /** Bound handler for `mixer.finished`. On motion clip end, advance
   *  the queue, or release the lock + signal stepTick to re-pick from
   *  the CURRENT mode (which may have changed mid-motion while the lock
   *  silently absorbed events). */
  private onMixerFinished = (e: { action?: THREE.AnimationAction }): void => {
    console.log(
      `[body] mixer 'finished' on ${e?.action?.getClip()?.name ?? '?'} (locked=${this.motionLocked})`,
    )
    if (!this.motionLocked) return
    if (this.motionQueue.length > 0) {
      const next = this.motionQueue.shift()!
      const nextMode: 'once' | 'loop' =
        this.motionQueue.length === 0 ? this.motionFinalMode : 'once'
      void this.playOneMotion(next, nextMode)
      return
    }
    this.motionLocked = false
    this.motionJustEnded = true
  }
}
