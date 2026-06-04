import { Box, Paper } from '@mui/material'
import { useEffect, useMemo, useRef } from 'react'
import { useStore } from '../store'
import {
  useBodyCameraPresets,
  type BodyCameraPresets,
} from '../hooks/useBodyCameraPresets'
import { useBodyCharacterMeta } from '../hooks/useBodyCharacterMeta'
import { useBodyClips } from '../hooks/useBodyClips'
import { useBodyClipGenders } from '../hooks/useBodyClipGenders'
import { useBodyClipPools, type BodyMode } from '../hooks/useBodyClipPools'
import { useOverlayList } from '../hooks/useBodyOverlays'
import { BodySettings } from './Settings'
import { AvatarControls } from './AvatarControls'
import { AvatarStatusPill } from './AvatarStatusPill'
import { AvatarEngine } from './engine/AvatarEngine'
import { targetRigFor, type RigType } from './engine/rigRemap'
import type { BodyBehaviorEffective } from '../lib/body/behavior'
import { useBodyBehavior } from '../hooks/useBodyBehavior'
import {
  useBodyCharacterReloadBridge,
  useBodyModeBridge,
  useBodyMotionBridge,
  useBodyPointBridge,
  useBodyTtsLevelStream,
  useBodyWledAuraBridge,
  useBodyWledStoreBridge,
} from './avatarBridges'

/** Dashboard variant 13 — rigged Three.js character driven by per-mode
 *  animation clip pools, with live lipsync, blinks, gaze, body overlays,
 *  and a point-at IK system. */

type Mode = BodyMode

export function BodyAvatar() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const mode = useStore((s) => s.mode)
  const setBodyCurrentClip = useStore((s) => s.setBodyCurrentClip)
  const setBodyStatus = useStore((s) => s.setBodyStatus)
  const setBodyErrorMsg = useStore((s) => s.setBodyErrorMsg)
  const modeRef = useRef<Mode>(mode)
  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  // Behavior flags (eyeTracking etc.) — engine reads via ref, so Avatar
  // doesn't need to re-render on every flag toggle. Only `characterFile`
  // drives React-side logic here (character swap), so we select that
  // narrowly; the rest of the slice flows through a direct store
  // subscription into `flagsRef`. The Settings dialogs subscribe to the
  // whole slice via `useBodyFlags()` as before — they're the editors and
  // legitimately re-render on every change.
  const characterFile = useStore((s) => s.bodyFlags.characterFile)
  const flagsRef = useRef(useStore.getState().bodyFlags)
  useEffect(
    () =>
      useStore.subscribe((state, prev) => {
        if (state.bodyFlags !== prev.bodyFlags) {
          flagsRef.current = state.bodyFlags
        }
      }),
    [],
  )

  // Imperative handles assigned by the Three.js effect — refs so React-side
  // event bridges + the settings dialog can drive the render loop without
  // restarting it.
  const playClipRef = useRef<(name: string) => void>(() => {})
  const playMotionRef = useRef<(clips: string[], mode?: 'once' | 'loop') => void>(() => {})
  const playPointRef = useRef<
    (
      target: [number, number, number],
      opts?: { hold_ms?: number; ease_ms?: number; arm?: 'auto' | 'left' | 'right' },
    ) => void
  >(() => {})
  const resetCameraRef = useRef<(mode: 'home' | 'face') => void>(() => {})
  const getCameraStateRef = useRef<() => {
    pos: [number, number, number]
    target: [number, number, number]
  }>(() => ({ pos: [0, 0, 0], target: [0, 0, 0] }))
  const loadCharacterRef = useRef<(file: string, force?: boolean) => void>(() => {})
  const setAuraRef = useRef<(s: { alias: string | null }) => void>(() => {})
  // Re-walks the loaded character to re-discover bones/morphs. Called
  // when the user edits the rig-compatibility candidate lists.
  const rediscoverBonesRef = useRef<() => void>(() => {})

  // Camera presets — localStorage-backed. Left-click button = tween to
  // preset; right-click on the topbar buttons = save current view.
  const cameraPresetsApi = useBodyCameraPresets()
  const cameraPresetsRef = useRef<BodyCameraPresets>(cameraPresetsApi.presets)
  useEffect(() => {
    cameraPresetsRef.current = cameraPresetsApi.presets
  }, [cameraPresetsApi.presets])

  // Body-overlay configs + shape-key. Shape change = full rebuild; value
  // change (color drag etc.) = cheap sync. Without this split, dragging
  // the color picker re-extracted every overlay mesh per pixel of drag.
  const overlayConfigs = useOverlayList()
  const rebuildOverlaysRef = useRef<(configs: typeof overlayConfigs) => void>(() => {})
  const syncOverlayConfigsRef = useRef<(configs: typeof overlayConfigs) => void>(() => {})
  const prevShapeKeyRef = useRef<string>('')
  useEffect(() => {
    const shapeKey = JSON.stringify(
      overlayConfigs.map((c) => ({
        id: c.id,
        enabled: c.enabled,
        bones: c.bones,
        includeChildren: c.includeChildren ?? true,
        weightThreshold: c.weightThreshold,
        effect: c.effect,
        flow: c.flow ?? null,
        lightAttach: c.light?.attachToBone ?? null,
        driverKind: c.driver.kind,
      })),
    )
    if (shapeKey !== prevShapeKeyRef.current) {
      prevShapeKeyRef.current = shapeKey
      rebuildOverlaysRef.current?.(overlayConfigs)
    } else {
      syncOverlayConfigsRef.current?.(overlayConfigs)
    }
  }, [overlayConfigs])

  // Live clip roster — basename → fullpath resolver for LLM-facing APIs
  // that ship bare filenames (MOTION_CATALOG_BLOCK, canned replies).
  const clipRoster = useBodyClips()
  const clipBasenameMapRef = useRef<Record<string, string>>({})
  useEffect(() => {
    const m: Record<string, string> = {}
    for (const c of clipRoster.clips) {
      if (!(c.file in m)) m[c.file] = c.path
    }
    clipBasenameMapRef.current = m
  }, [clipRoster.clips])

  // Active rig — drives cross-rig bone-name remap inside ClipPlayer so
  // a Mixamo .fbx clip can drive a Quaternius mannequin (and vice versa).
  // Updated on every characterFile change; ClipPlayer reads via ref so
  // the engine doesn't restart.
  const targetRigRef = useRef<RigType>(targetRigFor(characterFile))
  useEffect(() => {
    targetRigRef.current = targetRigFor(characterFile)
  }, [characterFile])

  // Per-clip + per-character gender — runtime filter for the mode pool.
  const clipGendersApi = useBodyClipGenders()
  const charMetaApi = useBodyCharacterMeta()
  const clipGendersRef = useRef<Record<string, string>>({})
  useEffect(() => {
    clipGendersRef.current = clipGendersApi.genders
  }, [clipGendersApi.genders])
  const activeGender = charMetaApi.genderOf(characterFile)
  const activeGenderRef = useRef<'male' | 'female' | undefined>(activeGender)
  useEffect(() => {
    activeGenderRef.current = activeGender
  }, [activeGender])

  // Clip pools — per-character, gender-seeded.
  const [pools] = useBodyClipPools(characterFile, activeGender)
  const poolsRef = useRef(pools)
  useEffect(() => {
    poolsRef.current = pools
  }, [pools])

  // Per-character behavior overrides (feel sliders + rig-compatibility
  // candidate lists). Render loop reads from behaviorRef every frame,
  // so the values propagate without restarting the scene effect.
  const behaviorApi = useBodyBehavior(characterFile)
  const behaviorRef = useRef<BodyBehaviorEffective>(behaviorApi.effective)
  useEffect(() => {
    behaviorRef.current = behaviorApi.effective
  }, [behaviorApi.effective])

  // When the rig-compatibility candidate lists change (or the character
  // swaps), re-walk the loaded skeleton to rebind eye/head/jaw bones
  // and lipsync/blink morphs. Cheap — no GLB re-fetch.
  // Memoized so the JSON.stringify only re-runs when `effective` actually
  // changes (useBodyBehavior now returns a stable reference between
  // edits); without this the stringify fired on every Avatar render.
  const rigShapeKey = useMemo(
    () =>
      JSON.stringify({
        eye: behaviorApi.effective.eyeBoneCandidates,
        blink: behaviorApi.effective.blinkMorphNames,
        jaw: behaviorApi.effective.jawMorphCandidates,
      }),
    [behaviorApi.effective],
  )
  useEffect(() => {
    rediscoverBonesRef.current?.()
  }, [rigShapeKey])

  // Character swap — re-fires loadCharacter through the ref so the
  // scene effect doesn't have to restart on every settings change.
  useEffect(() => {
    loadCharacterRef.current?.(characterFile)
  }, [characterFile])

  // External event/WS bridges.
  useBodyModeBridge(modeRef)
  useBodyMotionBridge(playMotionRef)
  useBodyPointBridge(playPointRef)
  useBodyCharacterReloadBridge(loadCharacterRef, flagsRef)
  useBodyWledAuraBridge(setAuraRef)
  useBodyWledStoreBridge()
  const ttsRmsRef = useBodyTtsLevelStream()

  // ── AvatarEngine: owns scene, camera, renderer, controls, lights,
  //    loaders, and every sub-system. Mount-once: wire imperative refs
  //    to engine methods + return engine.dispose() for cleanup.
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const engine = new AvatarEngine({
      modeRef,
      flagsRef,
      behaviorRef,
      poolsRef,
      clipGendersRef,
      activeGenderRef,
      clipBasenameMapRef,
      targetRigRef,
      ttsRmsRef,
      cameraPresetsRef,
      initialOverlayConfigs: overlayConfigs,
      setBodyCurrentClip,
      setBodyStatus,
      setBodyErrorMsg,
    })
    engine.mount(container, canvas)

    // Wire imperative refs that React-side bridges + JSX consume.
    playClipRef.current = (name) => engine.playClip(name)
    playMotionRef.current = (clips, mode) => engine.playMotion(clips, mode)
    playPointRef.current = (target, opts) => engine.playPoint(target, opts)
    resetCameraRef.current = (mode) => engine.resetCamera(mode)
    getCameraStateRef.current = () => engine.getCameraState()
    loadCharacterRef.current = (file, force) => engine.loadCharacter(file, !!force)
    setAuraRef.current = (s) => engine.triggerWledSpike(s.alias)
    rediscoverBonesRef.current = () => engine.rediscoverBones()
    rebuildOverlaysRef.current = (configs) => engine.rebuildOverlays(configs)
    syncOverlayConfigsRef.current = (configs) => engine.syncOverlays(configs)

    if (import.meta.env.DEV) {
      ;(window as unknown as {
        __body_inspect?: () => { clip: string; weight: number; running: boolean }[]
      }).__body_inspect = () => engine.inspect()
    }

    return () => engine.dispose()
    // Mount-once. Live overlay edits flow through rebuildOverlaysRef /
    // syncOverlayConfigsRef in the top-level effect, not by re-running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Paper
      ref={containerRef}
      sx={{
        p: 0,
        bgcolor: '#04060e',
        borderRadius: 2,
        overflow: 'hidden',
        position: 'relative',
        // CSS `:fullscreen` pseudo-class handles the layout swap so we
        // don't need React state for it. The fullscreen API already
        // sizes the Paper to fill the viewport; we just drop the
        // rounded corners and re-size the canvas Box to match.
        '&:fullscreen': {
          borderRadius: 0,
          '& .body-canvas-box': { height: '100vh' },
        },
      }}
    >
      <Box
        className="body-canvas-box"
        sx={{
          position: 'relative',
          width: '100%',
          height: { xs: 'calc(100dvh - 200px)', md: 'calc(100dvh - 120px)' },
        }}
      >
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      </Box>

      <AvatarStatusPill />

      <AvatarControls
        containerRef={containerRef}
        resetCameraRef={resetCameraRef}
        getCameraStateRef={getCameraStateRef}
      />

      <BodySettings onPreview={(clip) => playClipRef.current?.(clip)} />
    </Paper>
  )
}
