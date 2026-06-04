import * as THREE from 'three'
import type { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { characterUrl, CHARACTER_SCALE } from '../avatarConstants'
import type { ClipPlayer } from './ClipPlayer'
import type { OverlayManager } from './OverlayManager'

interface CharacterLoaderDeps {
  scene: THREE.Scene
  gltfLoader: GLTFLoader
  fbxLoader: FBXLoader
  clipPlayer: ClipPlayer
  overlayManager: OverlayManager
  /** Store action — `'loading' | 'ready' | 'error'`. */
  setBodyStatus: (status: 'loading' | 'ready' | 'error') => void
  setBodyErrorMsg: (msg: string) => void
  /** Fires BEFORE the old character is removed from the scene. Avatar
   *  uses this to drop in-flight point-at IK + reset the render-style
   *  sentinel so the next frame re-applies on the new meshes. */
  onBeforeTeardown: () => void
  /** Fires AFTER the new character is in the scene + mixer is wired,
   *  AFTER overlayManager + bones have re-discovered. Avatar uses this
   *  to kick off the initial playFromPool against the current mode. */
  onCharacterReady: (character: THREE.Group) => void
  /** Re-binds bones + morphs on the new skeleton + rebuilds overlays
   *  from cached body meshes. */
  rediscoverBones: () => void
}

/** Owns the character load lifecycle:
 *  - `loadCharacter(filename, force)` is the entrypoint. Dedupes
 *    against last-loaded + currently-loading filenames; `force`
 *    bypasses the dedupe for the Appearance Apply flow (same-named
 *    `_custom.glb` with new bytes).
 *  - Dispatches by extension (`.fbx` vs `.glb` / `.gltf`).
 *  - Tears down the old character (scene.remove + geometry dispose)
 *    AND drives every system that holds character-bound state to
 *    reset (clip cache, motion lock, point-at, overlays).
 *  - After load: scales (GLB 100× into cm-space, FBX stays at 1),
 *    strips `mixamorig\d*` from bone names, wires a fresh
 *    AnimationMixer, calls rediscoverBones + onCharacterReady. */
export class CharacterLoader {
  private deps: CharacterLoaderDeps
  private _character: THREE.Group | null = null
  private lastLoadedFile = ''
  private loadingFile = ''
  private cancelled = false

  constructor(deps: CharacterLoaderDeps) {
    this.deps = deps
  }

  /** Currently-loaded character group (or null before first load). */
  get character(): THREE.Group | null {
    return this._character
  }

  /** Stop accepting new loads + ignore in-flight ones. Called from
   *  the scene-effect cleanup on unmount. */
  cancel(): void {
    this.cancelled = true
  }

  /** Load (or swap to) a character. `force=true` bypasses the dedupe. */
  async loadCharacter(filename: string, force = false): Promise<void> {
    if (this.cancelled) return
    if (!force && filename === this.lastLoadedFile) return
    if (!force && filename === this.loadingFile) return
    this.loadingFile = filename
    this.deps.setBodyStatus('loading')

    let newRoot: THREE.Group
    try {
      const lower = filename.toLowerCase()
      // Cache-bust: same-named `_custom.glb` can have new bytes after
      // an appearance Apply.
      const cb = `?v=${Date.now()}`
      if (lower.endsWith('.fbx')) {
        newRoot = await this.deps.fbxLoader.loadAsync(characterUrl(`${filename}${cb}`))
      } else {
        const gltf = await this.deps.gltfLoader.loadAsync(characterUrl(`${filename}${cb}`))
        newRoot = gltf.scene
      }
      // Source animations intentionally ignored — Streamoji GLBs ship
      // hand-pose clips on a secondary `_N` skeleton (redirecting
      // breaks finger bind orientations); FBX chars ship T-pose/idle
      // we don't need. The Mixamo clip pool drives motion instead.
    } catch (e) {
      if (this.cancelled) return
      console.error('[body] character load failed:', filename, e)
      this.deps.setBodyErrorMsg(`${filename}: ${e}`)
      this.deps.setBodyStatus('error')
      this.loadingFile = ''
      return
    }
    if (this.cancelled) return

    // Tear down old character — drop from scene + free geometry buffers.
    // Materials are deliberately left alone (GLTFLoader-created PBR
    // materials may share textures with other parts of the same load).
    if (this._character) {
      this.deps.scene.remove(this._character)
      this._character.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
      })
    }
    // Cascade resets — clip cache + motion state, overlays, and any
    // Avatar-side state (point-at IK, render-style sentinel).
    this.deps.clipPlayer.resetForCharacterSwap()
    this.deps.overlayManager.resetForCharacterSwap()
    this.deps.onBeforeTeardown()

    this._character = newRoot
    this._character.position.set(0, 0, 0)
    // GLB = 1 unit/meter → scale 100× into cm-space to match Mixamo
    // animation tracks. FBX (xbot.fbx) is already Mixamo-native cm.
    const isFbx = filename.toLowerCase().endsWith('.fbx')
    this._character.scale.setScalar(isFbx ? 1 : CHARACTER_SCALE)

    // Strip `mixamorig\d*` from every bone so animation track names
    // (which we also strip in normalizeClip) bind correctly. No-op on
    // already-unprefixed rigs.
    this._character.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        const renamed = o.name.replace(/^mixamorig\d*/, '')
        if (renamed.length > 0) o.name = renamed
      }
    })

    this.deps.scene.add(this._character)
    this.deps.clipPlayer.setMixer(new THREE.AnimationMixer(this._character))
    // Register the active character as the retarget target so cross-rig
    // clips (Mixamo .fbx on a Quaternius mannequin, etc.) can be
    // rewritten via SkeletonUtils.retargetClip against this skeleton's
    // bind pose. setRetargetTarget also clears the clip cache so stale
    // pre-swap retargetings don't leak.
    this.deps.clipPlayer.setRetargetTarget(this._character)

    // Re-bind bones + morphs + rebuild overlays on the new skeleton.
    this.deps.rediscoverBones()

    this.deps.setBodyStatus('ready')
    this.deps.setBodyErrorMsg('')
    this.lastLoadedFile = filename
    this.loadingFile = ''

    this.deps.onCharacterReady(this._character)
  }
}
