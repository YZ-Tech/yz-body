import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { MutableRefObject } from 'react'
import type { BodyCameraPresets } from '../../hooks/useBodyCameraPresets'
import type { BodyClipPools, BodyMode } from '../../hooks/useBodyClipPools'
import type { BodyFlags } from '../../hooks/useBodyFlags'
import type { BodyBehaviorEffective } from '../../lib/body/behavior'
import {
  type BodyOverlayConfig,
  type OverlayContext,
  type BodyMode as OverlayMode,
} from '../../lib/body/bodyOverlays'
import {
  advancePointTween,
  applyPointIK,
  createPointScratch,
  createPointTween,
  discoverPointBones,
  emptyPointBones,
  resetPointTween,
  startPointTween,
  type PointBones,
} from '../../lib/body/pointIK'
import useStore from '../../store/useStore'
import { BlinkSystem } from './BlinkSystem'
import { BoneBindings } from './BoneBindings'
import { CameraTweener } from './CameraTweener'
import { CharacterLoader } from './CharacterLoader'
import { ClipPlayer } from './ClipPlayer'
import type { RigType } from './rigRemap'
import { GazeSystem } from './GazeSystem'
import { LipsyncSystem } from './LipsyncSystem'
import type { VisemeController } from './VisemeController'
import { OverlayManager } from './OverlayManager'
import { RenderStyleManager } from './RenderStyleManager'
import { WledLightingSystem } from './WledLightingSystem'

export interface AvatarEngineDeps {
  // React refs — engine reads on every tick. Owned by Avatar.tsx so
  // toggles propagate without restarting the engine.
  modeRef: MutableRefObject<BodyMode>
  flagsRef: MutableRefObject<BodyFlags>
  behaviorRef: MutableRefObject<BodyBehaviorEffective>
  poolsRef: MutableRefObject<BodyClipPools>
  clipGendersRef: MutableRefObject<Record<string, string>>
  activeGenderRef: MutableRefObject<'male' | 'female' | undefined>
  clipBasenameMapRef: MutableRefObject<Record<string, string>>
  targetRigRef: MutableRefObject<RigType>
  ttsRmsRef: MutableRefObject<number>
  /** Neurosync lipsync controller (broadcast-audio clock + viseme track). Null
   *  until the bridge creates it; the tick reads currentFrame() and falls back
   *  to amplitude lipsync when it returns null. */
  visemeRef: MutableRefObject<VisemeController | null>
  cameraPresetsRef: MutableRefObject<BodyCameraPresets>
  // Initial overlay configs — subsequent edits come via
  // engine.rebuildOverlays / syncOverlayConfigs from Avatar's
  // overlayConfigs-watching useEffect.
  initialOverlayConfigs: BodyOverlayConfig[]
  // Store actions.
  setBodyCurrentClip: (clip: string) => void
  setBodyStatus: (status: 'loading' | 'ready' | 'error') => void
  setBodyErrorMsg: (msg: string) => void
}

/** Top-level orchestrator for the Body avatar. Owns scene/camera/renderer,
 *  lighting, loaders, and all the sub-system instances. `mount(container,
 *  canvas)` wires everything up and starts the render loop; `dispose()`
 *  tears it down on unmount.
 *
 *  Public methods (playClip, playMotion, etc.) are how the React side
 *  drives the engine — Avatar.tsx wires its imperative refs to these in
 *  the same effect that owns the engine. */
export class AvatarEngine {
  private deps: AvatarEngineDeps

  // Three.js core
  private scene = new THREE.Scene()
  private camera!: THREE.PerspectiveCamera
  private renderer!: THREE.WebGLRenderer
  private controls!: OrbitControls

  // Loaders
  private gltfLoader = new GLTFLoader()
  private fbxLoader = new FBXLoader()

  // Sub-systems
  private renderStyleManager = new RenderStyleManager()
  private cameraTweener!: CameraTweener
  private clipPlayer: ClipPlayer
  private overlayManager = new OverlayManager()
  private bones = new BoneBindings()
  private gazeSystem = new GazeSystem()
  private lipsyncSystem = new LipsyncSystem()
  private blinkSystem: BlinkSystem
  private characterLoader!: CharacterLoader
  private wledLighting: WledLightingSystem

  // Point-at IK — small enough to inline (no separate class).
  private pointBones: PointBones = emptyPointBones()
  private pointTween = createPointTween()
  private pointScratch = createPointScratch()

  // Tick + scene state
  private clock = new THREE.Clock()
  private lastRenderStyle: BodyRenderStyleOrEmpty = ''
  private lastRoomLighting: BodyFlags['roomLighting'] | '' = ''
  private cursorNdc = { x: 0, y: 0 }
  private cancelled = false
  private cleanupFns: (() => void)[] = []

  // Cached WLED devices snapshot, kept current via a store subscription
  // set up in mount(). Avoids hitting `useStore.getState()` inside the
  // per-frame tick loop.
  private wledDevices: OverlayContext['wledDevices'] = {}
  // Mutable per-frame overlay ctx — reused across frames so we don't
  // mint a fresh object literal at 60Hz. tick() writes every field
  // before handing it to overlayManager.
  private overlayCtx: OverlayContext = {
    wledDevices: {},
    ttsRms: 0,
    mode: 'idle' as OverlayMode,
    now: 0,
  }

  constructor(deps: AvatarEngineDeps) {
    this.deps = deps
    this.scene.background = new THREE.Color(0x04060e)

    const draco = new DRACOLoader()
    draco.setDecoderPath('/draco/')
    this.gltfLoader.setDRACOLoader(draco)

    this.clipPlayer = new ClipPlayer({
      gltfLoader: this.gltfLoader,
      fbxLoader: this.fbxLoader,
      behaviorRef: deps.behaviorRef,
      poolsRef: deps.poolsRef,
      clipGendersRef: deps.clipGendersRef,
      activeGenderRef: deps.activeGenderRef,
      clipBasenameMapRef: deps.clipBasenameMapRef,
      targetRigRef: deps.targetRigRef,
      setBodyCurrentClip: deps.setBodyCurrentClip,
      initialMode: deps.modeRef.current,
    })

    this.blinkSystem = new BlinkSystem(deps.behaviorRef.current.blinkIntervalMinMs)
    this.wledLighting = new WledLightingSystem(this.scene)
  }

  /** Set up Three.js bound to `canvas` inside `container`, start the
   *  render loop, and kick off the initial character load. Returns
   *  nothing; cleanup happens via `dispose()`. */
  mount(container: HTMLElement, canvas: HTMLCanvasElement): void {
    // Camera + first-mount framing from the presets hook.
    this.camera = new THREE.PerspectiveCamera(
      30,
      container.clientWidth / container.clientHeight,
      0.1,
      1000,
    )
    const homeInit = this.deps.cameraPresetsRef.current.home
    this.camera.position.set(...homeInit.pos)
    this.camera.lookAt(...homeInit.target)

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight, false)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    // Image-based lighting: a neutral procedural room gives every PBR
    // material soft ambient + spec reflections — far less flat than the
    // directional-only rig. No external HDRI file needed.
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environment = envTex
    this.scene.environmentIntensity = 0.6
    pmrem.dispose()
    this.cleanupFns.push(() => {
      this.scene.environment = null
      envTex.dispose()
    })

    // OrbitControls: wheel zoom, left-drag rotate, right-drag pan.
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.target.set(...homeInit.target)
    this.controls.enablePan = true
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.panSpeed = 0.8
    this.controls.screenSpacePanning = true
    this.controls.minDistance = 80
    this.controls.maxDistance = 600
    this.controls.minPolarAngle = Math.PI * 0.20
    this.controls.maxPolarAngle = Math.PI * 0.75
    this.controls.update()

    this.cameraTweener = new CameraTweener(this.camera, this.controls)

    // Three-point lighting: key (front-right, shadow-casting), fill
    // (left), rim (back). Ambient is low now that IBL provides the fill.
    const ambient = new THREE.AmbientLight(0xffffff, 0.15)
    this.scene.add(ambient)
    const key = new THREE.DirectionalLight(0xffffff, 1.0)
    key.position.set(150, 250, 200)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 1
    key.shadow.camera.far = 900
    key.shadow.camera.left = -220
    key.shadow.camera.right = 220
    key.shadow.camera.top = 320
    key.shadow.camera.bottom = -120
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 1.2
    key.shadow.radius = 4
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0x9eb5ff, 0.45)
    fill.position.set(-200, 150, 100)
    this.scene.add(fill)
    const rim = new THREE.DirectionalLight(0xffd29e, 0.4)
    rim.position.set(0, 200, -200)
    this.scene.add(rim)

    // Transparent ground that renders ONLY the contact shadow — grounds
    // the figure without drawing a visible floor.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.ShadowMaterial({ opacity: 0.32 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = 0
    ground.receiveShadow = true
    this.scene.add(ground)
    this.cleanupFns.push(() => {
      this.scene.remove(ground)
      ground.geometry.dispose()
      ;(ground.material as THREE.Material).dispose()
    })

    // Overlay manager wires the live-edit bypass + initial config.
    this.overlayManager.installLivePatch()
    this.overlayManager.rebuild(this.deps.initialOverlayConfigs, null)

    // Character loader cascades resets into clipPlayer + overlayManager
    // on swap; we plug Avatar-side concerns (point-at IK + render-style
    // sentinel reset, initial pool pick) in via callbacks.
    this.characterLoader = new CharacterLoader({
      scene: this.scene,
      gltfLoader: this.gltfLoader,
      fbxLoader: this.fbxLoader,
      clipPlayer: this.clipPlayer,
      overlayManager: this.overlayManager,
      setBodyStatus: this.deps.setBodyStatus,
      setBodyErrorMsg: this.deps.setBodyErrorMsg,
      onBeforeTeardown: () => {
        resetPointTween(this.pointTween)
        this.pointBones = emptyPointBones()
        this.lastRenderStyle = ''
      },
      rediscoverBones: () => this.discoverBonesAndMorphs(),
      onCharacterReady: (character: THREE.Group) => {
        // Self-shadowing: nose on cheek, hair on shoulders, arms on torso.
        character.traverse((o) => {
          const m = o as THREE.Mesh
          if (m.isMesh) {
            m.castShadow = true
            m.receiveShadow = true
          }
        })
        void this.clipPlayer.playFromPool(this.deps.modeRef.current, true)
      },
    })
    // Kick off the initial load. Dedupe inside characterLoader guards
    // against re-entry from Avatar's character-swap useEffect.
    void this.characterLoader.loadCharacter(this.deps.flagsRef.current.characterFile)

    // Canvas pointermove → cursor NDC for the gaze controller.
    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      this.cursorNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      this.cursorNdc.y = ((e.clientY - rect.top) / rect.height) * 2 - 1
    }
    canvas.addEventListener('pointermove', onPointerMove)
    this.cleanupFns.push(() => canvas.removeEventListener('pointermove', onPointerMove))

    // Resize observer keeps renderer + camera aspect in sync.
    const onResize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(w, h, false)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(container)
    this.cleanupFns.push(() => ro.disconnect())

    // Cache wled.devices on the engine + keep it in sync via a store
    // subscription so the per-frame tick doesn't touch useStore. The
    // reference-equality check inside the listener fires only when the
    // wled slice actually changes (Zustand mutates via immer so the
    // top-level devices ref changes only on real updates). The same
    // change is forwarded into the WLED lighting subsystem — both the
    // device-set reconciliation (point_at edits, add/remove) and the
    // live-state update (color, bri, on, reachable) ride this single
    // subscription.
    this.wledDevices = useStore.getState().wled.devices
    this.wledLighting.rebuild(this.wledDevices)
    const unsubWled = useStore.subscribe((state, prev) => {
      if (state.wled.devices !== prev.wled.devices) {
        this.wledDevices = state.wled.devices
        // Rebuild handles both topology (new/removed/moved devices) and
        // pushes the latest state via its internal updateState() call.
        // Cheap when the alias set hasn't changed (entries reused).
        this.wledLighting.rebuild(this.wledDevices)
      }
    })
    this.cleanupFns.push(unsubWled)

    this.tick()
  }

  /** Stop the tick loop + release all three.js resources. Called from
   *  the React useEffect cleanup. */
  dispose(): void {
    this.cancelled = true
    this.characterLoader?.cancel()
    for (const fn of this.cleanupFns) fn()
    this.cleanupFns.length = 0
    this.controls?.dispose()
    this.renderer?.dispose()
    this.renderStyleManager.dispose()
    this.wledLighting.dispose()
    this.scene.clear()
    this.overlayManager.dispose()
  }

  // ── Public API — wired to React refs in Avatar.tsx ──────────────────

  playClip(name: string): void {
    void this.clipPlayer.playClip(name)
  }

  playMotion(clips: string[], mode: 'once' | 'loop' = 'once'): void {
    void this.clipPlayer.playMotion(clips, mode)
  }

  playPoint(
    target: [number, number, number],
    opts?: { hold_ms?: number; ease_ms?: number; arm?: 'auto' | 'left' | 'right' },
  ): void {
    startPointTween(this.pointTween, this.pointBones, target, opts)
  }

  /** Tween the camera to a saved preset. Reads presets per-call so
   *  right-click "save preset" takes effect without re-mount. */
  resetCamera(mode: 'home' | 'face'): void {
    const p = this.deps.cameraPresetsRef.current[mode]
    this.cameraTweener.startTween(p.pos, p.target)
  }

  /** Snapshot the current camera pose for the right-click "save preset"
   *  flow. */
  getCameraState(): {
    pos: [number, number, number]
    target: [number, number, number]
  } {
    return {
      pos: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      target: [this.controls.target.x, this.controls.target.y, this.controls.target.z],
    }
  }

  loadCharacter(file: string, force = false): void {
    void this.characterLoader.loadCharacter(file, force)
  }

  /** Bump the WLED spike timer for overlays matching this alias. */
  triggerWledSpike(alias: string | null): void {
    if (!alias) return
    const device = useStore.getState().wled.devices[alias]
    if (!device) return
    this.overlayManager.triggerSpike(device)
  }

  /** Re-walk the loaded character. Called when the user edits the
   *  rig-compatibility candidate lists. */
  rediscoverBones(): void {
    this.discoverBonesAndMorphs()
  }

  /** Full rebuild — used when shape-affecting overlay fields change. */
  rebuildOverlays(configs: BodyOverlayConfig[]): void {
    this.overlayManager.rebuild(configs, this.characterLoader?.character ?? null)
  }

  /** Cheap counterpart — re-points existing overlays at fresh configs. */
  syncOverlays(configs: BodyOverlayConfig[]): void {
    this.overlayManager.sync(configs)
  }

  /** Dev/test introspection used by the Playwright race spec. */
  inspect(): { clip: string; weight: number; running: boolean }[] {
    return this.clipPlayer.inspect()
  }

  // ── Internals ──────────────────────────────────────────────────────

  private discoverBonesAndMorphs(): void {
    const character = this.characterLoader.character
    if (!character) return
    this.bones.reset()
    this.bones.discoverBones(character, this.deps.behaviorRef.current.eyeBoneCandidates)
    this.pointBones = discoverPointBones(character)
    this.overlayManager.extractFromCharacter(character)

    console.log('[body] bones:',
      'eyeL=', this.bones.eyeL?.name ?? 'null',
      'eyeR=', this.bones.eyeR?.name ?? 'null',
      'head=', this.bones.headBone?.name ?? 'null',
      'jaw=', this.bones.jawBone?.name ?? 'null',
      'armR=', this.pointBones.armR?.name ?? 'null',
      'foreArmR=', this.pointBones.foreArmR?.name ?? 'null',
      'armL=', this.pointBones.armL?.name ?? 'null',
      'foreArmL=', this.pointBones.foreArmL?.name ?? 'null')

    // Diagnostic dump + store publish — BodySettings Autocompletes read
    // from these slices so their dropdowns reflect the live model.
    const allBones: string[] = []
    const allMorphs: { mesh: string; names: string[] }[] = []
    character.traverse((o) => {
      if ((o as THREE.Bone).isBone) allBones.push(o.name)
      const sm = o as THREE.SkinnedMesh
      if (sm.morphTargetDictionary) {
        allMorphs.push({ mesh: o.name, names: Object.keys(sm.morphTargetDictionary) })
      }
    })
    console.log(`[body] bones (${allBones.length}):`, allBones)
    console.log(`[body] morph dicts (${allMorphs.length}):`, allMorphs)
    try {
      useStore.getState().setBodyBones(allBones)
      const morphSet = new Set<string>()
      for (const m of allMorphs) for (const n of m.names) morphSet.add(n)
      useStore.getState().setBodyMorphs(Array.from(morphSet).sort())
    } catch {
      /* store unavailable — autocomplete falls back to a static list. */
    }

    this.bones.discoverMorphs(
      character,
      this.deps.behaviorRef.current.jawMorphCandidates,
      this.deps.behaviorRef.current.blinkMorphNames,
    )
    if (this.bones.lipTargets.length === 0) {
      console.warn('[body] no jaw/mouth morph found on character — lipsync disabled.',
        'Expected one of:', this.deps.behaviorRef.current.jawMorphCandidates)
    } else {
      console.log(`[body] lipsync targets:`,
        this.bones.lipTargets.map((t) => `${t.mesh.name}[${t.idx}]`))
    }
    console.log(`[body] neurosync viseme morphs bound: ${this.bones.visemeByIndex.size} (need ~27 ARKit mouth shapes)`)
    if (this.bones.blinkTargets.length === 0) {
      console.warn('[body] no eyeBlink morphs found — blinking disabled.')
    } else {
      console.log(`[body] blink targets (${this.bones.blinkTargets.length} pairs):`,
        this.bones.blinkTargets.map((t) => `${t.mesh.name}[${t.idx}]`))
    }
  }

  /** Per-frame orchestrator — mixer update, render-style poll,
   *  mode-pool scheduler, gaze/lipsync/blink, overlays, point-at IK,
   *  camera tween, controls update, render. */
  private tick = (): void => {
    if (this.cancelled) return
    const dt = this.clock.getDelta()
    this.clipPlayer.update(dt)

    // Render-style swap on flag change.
    if (this.deps.flagsRef.current.renderStyle !== this.lastRenderStyle) {
      this.lastRenderStyle = this.deps.flagsRef.current.renderStyle
      this.renderStyleManager.apply(this.characterLoader.character, this.lastRenderStyle)
    }

    // Room-lighting mode swap on flag change. Refresh state right after
    // so the new mode's intensity/opacity is reflected before the frame.
    // Designed for `realistic` render style (the main mode); other styles
    // get whatever Three.js gives them by default — no special-casing.
    if (this.deps.flagsRef.current.roomLighting !== this.lastRoomLighting) {
      this.lastRoomLighting = this.deps.flagsRef.current.roomLighting
      this.wledLighting.setMode(this.lastRoomLighting)
      this.wledLighting.updateState(this.wledDevices)
    }

    // Mode-pool scheduler (motion-lock / post-speaking-hold / mode-change
    // / periodic re-pick) is internal to the player.
    this.clipPlayer.stepTick(this.deps.modeRef.current)

    const now = performance.now()
    this.gazeSystem.step(now, {
      cursorNdc: this.cursorNdc,
      bones: this.bones,
      eyeTrack: this.deps.flagsRef.current.eyeTracking,
      saccadeAmplitude: this.deps.behaviorRef.current.saccadeAmplitude,
    })
    this.lipsyncSystem.step({
      speaking: this.deps.modeRef.current === 'speaking',
      ttsRms: this.deps.ttsRmsRef.current,
      bones: this.bones,
      lipsyncGain: this.deps.behaviorRef.current.lipsyncGain,
      lipsyncMax: this.deps.behaviorRef.current.lipsyncMax,
      visemeFrame: this.deps.visemeRef.current?.currentFrame() ?? null,
    })

    // Body overlays — driver → target color/intensity, lerp, apply.
    // Reuse the mutable ctx field; wledDevices is kept fresh by the
    // store subscription installed in mount().
    this.overlayCtx.wledDevices = this.wledDevices
    this.overlayCtx.ttsRms = this.deps.ttsRmsRef.current
    this.overlayCtx.mode = this.deps.modeRef.current as OverlayMode
    this.overlayCtx.now = now
    this.overlayManager.tick(this.overlayCtx)

    // Point-at IK composes on top of any base/overlay/motion clip.
    const character = this.characterLoader.character
    const pointActive = advancePointTween(this.pointTween, now)
    if (pointActive && this.pointTween.target && character) {
      applyPointIK(
        character,
        this.pointBones,
        this.pointTween.arm,
        this.pointTween.target,
        this.pointTween.weight,
        this.pointScratch,
      )
    }

    this.blinkSystem.step(now, {
      enabled: this.deps.flagsRef.current.eyeBlink,
      bones: this.bones,
      blinkIntervalMinMs: this.deps.behaviorRef.current.blinkIntervalMinMs,
      blinkIntervalMaxMs: this.deps.behaviorRef.current.blinkIntervalMaxMs,
    })

    this.cameraTweener.step(now)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
    requestAnimationFrame(this.tick)
  }
}

// Small local alias — BodyRenderStyle is the union, '' is the
// not-yet-applied sentinel.
type BodyRenderStyleOrEmpty = '' | 'realistic' | 'wireframe' | 'hologram'
