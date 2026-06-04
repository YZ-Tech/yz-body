import * as THREE from 'three'
import type { WLEDDevice } from '../../api/types'

/** Body overlays — extract a subset of the character's mesh by bone-weight
 *  and render it on top with a configurable effect (wireframe / solid /
 *  hologram) driven by a configurable signal (WLED state / TTS amplitude /
 *  mode / static).
 *
 *  Why: once you know how to extract "the triangles weighted to these
 *  bones" you have a primitive that scales to any glow effect on any body
 *  part — hand wireframe is just one entry. Adding a new overlay is a
 *  config-array edit, no new render code.
 *
 *  Drivers are pure functions of (overlay, runtime context) → target color
 *  + intensity. The tick lerps current → target every frame and writes
 *  the result into the overlay's material. Spike-on-event flashes (used
 *  by the WLED driver to pop the moment-of-action) are tracked per
 *  overlay via spikeUntilMs.
 *
 *  Coord/scale conventions match BodyAvatar (character scaled 100×;
 *  geometry distances in character-local units = world cm / 100). */

export type BodyMode = 'idle' | 'listening' | 'thinking' | 'speaking' | 'boot'

/** Visual effect for an overlay mesh. The material is rebuilt when this
 *  changes. */
export type OverlayEffect = 'wireframe' | 'solid' | 'hologram'

/** Drivers compute (color, intensity) targets each frame from the runtime
 *  context (store state, mode, TTS amplitude). New drivers slot in here
 *  with a new switch case in `computeOverlayTarget`. */
export type OverlayDriver =
  /** Holds at baseColor + baseIntensity. */
  | { kind: 'static' }
  /** Mirrors any WLED device whose `aura_hand` setting includes the
   *  configured hand. Color = device RGB; intensity scales with device
   *  brightness. Last write wins if multiple devices map to the same
   *  hand. */
  | { kind: 'wled-hand'; hand: 'right' | 'left' | 'both' }
  /** Intensity follows `ttsRms * gain`, clamped to [0, 1], gated to
   *  `mode === 'speaking'`. Color stays at baseColor. */
  | { kind: 'tts-rms'; gain?: number }
  /** Soft sinusoidal pulse while `mode === <whenMode>`; zero otherwise. */
  | { kind: 'mode-pulse'; whenMode: BodyMode; max?: number; periodMs?: number }
  /** Brightens while `mode === <whenMode>`, holds steady; zero otherwise. */
  | { kind: 'mode-on'; whenMode: BodyMode; intensity?: number }

/** One overlay config — declarative, lives in DEFAULT_BODY_OVERLAYS below
 *  (or a future settings/localStorage source). Edit the array, rebuild,
 *  done. */
export interface BodyOverlayConfig {
  /** Stable id for logging + future settings UI. */
  id: string
  /** Toggle off without removing the entry. */
  enabled: boolean
  /** Bone names to include. Matched case-insensitively against the rig,
   *  with optional `mixamorig\d*` prefix + optional `_<n>` suffix (some
   *  GLBs duplicate bones for secondary skeletons). Whether their
   *  DESCENDANTS are included too depends on `includeChildren`. */
  bones: string[]
  /** When true (default), every bone descended from the named bones
   *  is included too — `['RightHand']` covers all 21 finger bones.
   *  When false, ONLY the literally-named bones contribute — use this
   *  for Spine2 (chest) since Spine2's children are the entire upper
   *  body (neck/head/arms), which is almost never what you want. */
  includeChildren?: boolean
  /** A vertex is kept if more than this fraction of its 4 skin weights
   *  falls into the matched bones. 0.5 is strict (no wrist bleed);
   *  0.3 catches more boundary verts at the cost of forearm spill. */
  weightThreshold: number
  /** Visual effect — see OverlayEffect. */
  effect: OverlayEffect
  /** Baseline color in 0..255 RGB. Used by static driver, mode-pulse
   *  (which only modulates intensity), and as fallback when WLED has
   *  no state cached yet. */
  baseColor: [number, number, number]
  /** Baseline opacity/intensity 0..1. Static = constant; others use it
   *  as the "off" level. */
  baseIntensity: number
  /** What drives the per-frame target. See OverlayDriver. */
  driver: OverlayDriver
  /** Attach a PointLight at the named bone for surface-tinting nearby
   *  geometry (the "glow emanates FROM the body part" look). Optional;
   *  helpful for hand-aura but noisy on chest/head overlays. */
  light?: { attachToBone: string; distance?: number; intensityScale?: number }
  /** Optional energy-flow effect — pulses a Gaussian bright spot along
   *  the chain defined by `bones` (in array order, treated as
   *  shoulder-to-fingertip). Each vertex's position along the chain is
   *  baked at extract time; the shader animates the pulse center. */
  flow?: {
    /** Time for the pulse center to travel from start (0) to end (1)
     *  of the chain. Lower = faster wave. Default 1800ms. */
    period_ms?: number
    /** Width of the Gaussian falloff in chain-fraction units. 0.2 is
     *  a soft band covering ~1/5 of the chain at any moment. 0.05 is
     *  a tight comet-tail. Default 0.2. */
    pulse_width?: number
  }
}

/** Runtime overlay — the extracted mesh + lerp state. Created per
 *  config entry on character load. Tick mutates currentColor/Intensity. */
export interface BodyOverlay {
  config: BodyOverlayConfig
  /** Skinned overlay mesh bound to the body's skeleton. Null if
   *  extraction failed (no matching bones, no triangles passed
   *  threshold). */
  mesh: THREE.SkinnedMesh | null
  /** Optional surface-tint light parented to the configured bone. */
  light: THREE.PointLight | null
  targetColor: THREE.Color
  targetIntensity: number
  currentColor: THREE.Color
  currentIntensity: number
  /** Wall-clock ms — spike adds extra intensity while now < this.
   *  Set by event sources (e.g. WLED WS events trigger a spike on the
   *  hand-aura overlays). Tick decays naturally past the deadline. */
  spikeUntilMs: number
}

/** Runtime context fed to every driver each frame. */
export interface OverlayContext {
  wledDevices: Record<string, WLEDDevice>
  ttsRms: number
  mode: BodyMode
  now: number
}

// ── Defaults — edit this array to add/disable overlays ─────────────────
// Add new entries to enable. Rebuilds pick up changes. To make these
// user-editable from the UI later, mirror them into a localStorage or
// settings-backed source — the runtime is decoupled from the source.

export const DEFAULT_BODY_OVERLAYS: BodyOverlayConfig[] = [
  {
    id: 'right-hand-aura',
    enabled: true,
    bones: ['RightHand'],
    weightThreshold: 0.5,
    effect: 'wireframe',
    baseColor: [125, 211, 252], // sky-300, faint cyan (no-device fallback)
    baseIntensity: 1.0, // ceiling — scales WLED brightness 0..1
    driver: { kind: 'wled-hand', hand: 'right' },
    light: { attachToBone: 'RightHand', distance: 0.5, intensityScale: 2.2 },
  },
  {
    id: 'left-hand-aura',
    enabled: true,
    bones: ['LeftHand'],
    weightThreshold: 0.5,
    effect: 'wireframe',
    baseColor: [125, 211, 252],
    baseIntensity: 1.0, // ceiling — scales WLED brightness 0..1
    driver: { kind: 'wled-hand', hand: 'left' },
    light: { attachToBone: 'LeftHand', distance: 0.5, intensityScale: 2.2 },
  },
  {
    // Chest TTS pulse — pulses with her speech amplitude during speaking
    // mode. Quiet when she's not talking. The "arc reactor" look.
    // includeChildren OFF — Spine2's descendants (Neck → Head → eyes
    // and both Shoulders → arms) would bleed the overlay across the
    // entire upper body. Just the chest triangles.
    id: 'chest-tts-pulse',
    enabled: true,
    bones: ['Spine2'],
    includeChildren: false,
    // 0.3 catches a sternum-sized patch around Spine2; 0.45 was too
    // strict and left only a sliver at the top of the collar. Lower
    // still (0.2) would start bleeding into the neck.
    weightThreshold: 0.3,
    effect: 'solid',
    baseColor: [0, 220, 255],
    baseIntensity: 0,
    driver: { kind: 'tts-rms', gain: 3 },
  },
  {
    // Head halo during thinking — soft purple pulse while she's
    // composing a reply. Zero opacity at idle/listening/speaking.
    id: 'head-thinking-halo',
    enabled: true,
    bones: ['Head', 'Neck'],
    weightThreshold: 0.4,
    effect: 'hologram',
    baseColor: [180, 130, 255],
    baseIntensity: 0,
    driver: { kind: 'mode-pulse', whenMode: 'thinking', max: 0.55, periodMs: 1400 },
  },
]

// ── Construction ───────────────────────────────────────────────────────

export function createOverlay(config: BodyOverlayConfig): BodyOverlay {
  const c = new THREE.Color(
    config.baseColor[0] / 255,
    config.baseColor[1] / 255,
    config.baseColor[2] / 255,
  )
  return {
    config,
    mesh: null,
    light: null,
    targetColor: c.clone(),
    targetIntensity: config.baseIntensity,
    currentColor: c.clone(),
    currentIntensity: config.baseIntensity,
    spikeUntilMs: 0,
  }
}

function buildMaterial(effect: OverlayEffect, color: THREE.Color, opacity: number): THREE.Material {
  // depthTest:true means the body mesh occludes the overlay when the
  // hand passes behind the torso (no more "aura shines through body").
  // depthWrite:false so the overlay doesn't itself block transparent
  // surfaces. polygonOffset biases the overlay slightly toward the
  // camera to avoid z-fighting with the body's hand mesh — they share
  // identical geometry (the overlay is extracted body triangles), so
  // depth equality would otherwise flicker.
  const occlusionGuards = {
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }
  switch (effect) {
    case 'wireframe':
      return new THREE.MeshBasicMaterial({
        color: color.clone(),
        wireframe: true,
        transparent: true,
        opacity,
        ...occlusionGuards,
      })
    case 'solid':
      return new THREE.MeshBasicMaterial({
        color: color.clone(),
        transparent: true,
        opacity,
        ...occlusionGuards,
      })
    case 'hologram':
      return new THREE.MeshStandardMaterial({
        color: color.clone(),
        emissive: color.clone(),
        emissiveIntensity: 0.6,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        ...occlusionGuards,
      })
  }
}

/** Build a bone-index → chain-progress map. Chain progress is 0 at the
 *  first bone in `chainTokens`, 1 at the last. Bones in the skeleton
 *  that DON'T appear in the chain get the nearest chain-ancestor's
 *  progress — so finger sub-bones (which descend from `RightHand`)
 *  inherit RightHand's progress, putting the pulse's "end" naturally
 *  at the fingertips when RightHand is the last chain entry.
 *
 *  Returns a Map<boneIndex, progress>. Bone indices not in the map
 *  have no chain ancestor — caller treats them as undefined. */
function buildChainProgress(skeleton: THREE.Skeleton, chainTokens: string[]): Map<number, number> {
  // First pass: resolve each chain token to its bone index. Tokens
  // that match no bone are skipped silently.
  const chainBoneIndices: number[] = []
  for (const token of chainTokens) {
    for (let i = 0; i < skeleton.bones.length; i++) {
      if (matchBoneName(skeleton.bones[i].name, token)) {
        chainBoneIndices.push(i)
        break
      }
    }
  }
  if (chainBoneIndices.length < 2) {
    // Degenerate chain — single bone gets progress 0 and no pulse.
    const out = new Map<number, number>()
    if (chainBoneIndices.length === 1) out.set(chainBoneIndices[0], 0)
    return out
  }
  const progressByChainBone = new Map<number, number>()
  for (let i = 0; i < chainBoneIndices.length; i++) {
    progressByChainBone.set(chainBoneIndices[i], i / (chainBoneIndices.length - 1))
  }
  // Second pass: every other bone climbs to its nearest ancestor in
  // the chain set. Cached so common ancestors aren't re-walked.
  const out = new Map(progressByChainBone)
  for (let i = 0; i < skeleton.bones.length; i++) {
    if (out.has(i)) continue
    let cur: THREE.Object3D | null = skeleton.bones[i]
    while (cur) {
      const idx = skeleton.bones.indexOf(cur as THREE.Bone)
      if (idx >= 0 && progressByChainBone.has(idx)) {
        out.set(i, progressByChainBone.get(idx)!)
        break
      }
      cur = cur.parent
    }
  }
  return out
}

/** Compute the per-vertex chain-progress attribute. Each vertex's
 *  value is the weighted average of its 4 skin-bones' chain progress
 *  (so triangles near a joint smoothly interpolate). Returns a
 *  Float32Array sized vCount. Vertices whose bones are entirely
 *  outside the chain get 0. */
function computeArmDistances(
  skinIdxAttr: THREE.BufferAttribute,
  skinWeightAttr: THREE.BufferAttribute,
  progressByBone: Map<number, number>,
): Float32Array {
  const vCount = skinIdxAttr.count
  const out = new Float32Array(vCount)
  for (let v = 0; v < vCount; v++) {
    let wSum = 0
    let pSum = 0
    for (let k = 0; k < 4; k++) {
      const bi = skinIdxAttr.getComponent(v, k)
      const p = progressByBone.get(bi)
      if (p === undefined) continue
      const w = skinWeightAttr.getComponent(v, k)
      pSum += w * p
      wSum += w
    }
    out[v] = wSum > 0 ? pSum / wSum : 0
  }
  return out
}

/** Patch a material to add an animated Gaussian pulse along the
 *  `aArmDist` attribute. Stores the shader's uniforms on
 *  `mat.userData.flowUniforms` so the tick loop can advance uPhase.
 *  Reads aArmDist (BufferAttribute) per-vertex, passes as varying,
 *  multiplies final alpha by exp(-(d/w)^2) where d = vArmDist - uPhase. */
function applyFlowShader(mat: THREE.Material, pulseWidth: number): void {
  // Flag so the tick loop knows this overlay wants per-frame phase
  // updates even before the shader has compiled (deferred until first
  // render); the actual uniforms ref is set inside onBeforeCompile.
  mat.userData.flowEnabled = true
  mat.userData.flowPulseWidth = pulseWidth
  mat.userData.flowUniforms = null
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPhase = { value: 0 }
    shader.uniforms.uPulseWidth = { value: pulseWidth }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aArmDist;
varying float vArmDist;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vArmDist = aArmDist;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uPhase;
uniform float uPulseWidth;
varying float vArmDist;`,
      )
      .replace(
        '#include <output_fragment>',
        `#include <output_fragment>
float _flowD = vArmDist - uPhase;
float _flowGauss = exp(-(_flowD * _flowD) / (uPulseWidth * uPulseWidth));
gl_FragColor.a *= _flowGauss;`,
      )
    mat.userData.flowUniforms = shader.uniforms
  }
}

/** Match a bone by name against a config token, tolerating Mixamo prefix
 *  + numeric suffix variants. */
function matchBoneName(boneName: string, token: string): boolean {
  const re = new RegExp(`^(mixamorig\\d*)?${escapeRe(token)}(_\\d+)?$`, 'i')
  return re.test(boneName)
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Collect the bone indices of every bone in `bones[]` (and optionally
 *  their descendants), mapped into `skeleton.bones[]`. */
function collectBoneIndices(
  skeleton: THREE.Skeleton,
  boneTokens: string[],
  includeChildren: boolean,
): Set<number> {
  const wanted = new Set<number>()
  for (const token of boneTokens) {
    for (let i = 0; i < skeleton.bones.length; i++) {
      const b = skeleton.bones[i]
      if (matchBoneName(b.name, token)) {
        if (includeChildren) {
          b.traverse((o) => {
            if ((o as THREE.Bone).isBone) {
              const idx = skeleton.bones.indexOf(o as THREE.Bone)
              if (idx >= 0) wanted.add(idx)
            }
          })
        } else {
          wanted.add(i)
        }
      }
    }
  }
  return wanted
}

/** Find the first bone matching `token` (case-insensitive, prefix-tolerant)
 *  in the skeleton. Used by the optional surface-light to know where to
 *  parent the PointLight. */
function findBone(skeleton: THREE.Skeleton, token: string): THREE.Bone | null {
  for (const b of skeleton.bones) {
    if (matchBoneName(b.name, token)) return b
  }
  return null
}

/** Try to extract a SkinnedMesh overlay for this overlay's bones from
 *  any body SkinnedMesh on the character. Returns the first successful
 *  build. Skips silently (returns null) if no bones match, no
 *  triangles pass the weight threshold, or the body mesh lacks skin
 *  attributes. */
export function buildOverlayMesh(
  bodyMeshes: THREE.SkinnedMesh[],
  config: BodyOverlayConfig,
): { mesh: THREE.SkinnedMesh; tris: number; fromBody: THREE.SkinnedMesh } | null {
  for (const bodyMesh of bodyMeshes) {
    const skeleton = bodyMesh.skeleton
    const wantedBones = collectBoneIndices(
      skeleton,
      config.bones,
      config.includeChildren !== false, // default true for backward-compat
    )
    if (wantedBones.size === 0) continue

    const geom = bodyMesh.geometry
    const posAttr = geom.attributes.position as THREE.BufferAttribute
    const skinIdxAttr = geom.attributes.skinIndex as THREE.BufferAttribute
    const skinWeightAttr = geom.attributes.skinWeight as THREE.BufferAttribute
    if (!posAttr || !skinIdxAttr || !skinWeightAttr) continue

    const vCount = posAttr.count
    const vertMatch = new Uint8Array(vCount)
    for (let v = 0; v < vCount; v++) {
      let w = 0
      for (let k = 0; k < 4; k++) {
        const bi = skinIdxAttr.getComponent(v, k)
        if (wantedBones.has(bi)) w += skinWeightAttr.getComponent(v, k)
      }
      if (w > config.weightThreshold) vertMatch[v] = 1
    }
    const idx = geom.index
    const kept: number[] = []
    if (idx) {
      const idxArr = idx.array as ArrayLike<number>
      for (let t = 0; t < idxArr.length; t += 3) {
        const a = idxArr[t],
          b = idxArr[t + 1],
          c = idxArr[t + 2]
        if (vertMatch[a] && vertMatch[b] && vertMatch[c]) kept.push(a, b, c)
      }
    } else {
      for (let v = 0; v < vCount; v += 3) {
        if (vertMatch[v] && vertMatch[v + 1] && vertMatch[v + 2]) {
          kept.push(v, v + 1, v + 2)
        }
      }
    }
    if (kept.length === 0) continue

    const overlayGeom = new THREE.BufferGeometry()
    overlayGeom.setAttribute('position', posAttr)
    overlayGeom.setAttribute('skinIndex', skinIdxAttr)
    overlayGeom.setAttribute('skinWeight', skinWeightAttr)
    if (geom.attributes.normal) overlayGeom.setAttribute('normal', geom.attributes.normal)
    overlayGeom.setIndex(kept)

    // Flow effect: bake per-vertex chain-progress as `aArmDist` so the
    // shader can animate a Gaussian pulse along the bone chain. We
    // attach the same attribute the body uses (full vertex array,
    // not the kept subset) because the index buffer remaps everything;
    // unreferenced vertices simply aren't touched.
    if (config.flow) {
      const progressByBone = buildChainProgress(skeleton, config.bones)
      if (progressByBone.size > 0) {
        const distArr = computeArmDistances(skinIdxAttr, skinWeightAttr, progressByBone)
        overlayGeom.setAttribute('aArmDist', new THREE.BufferAttribute(distArr, 1))
      }
    }

    const baseColor = new THREE.Color(
      config.baseColor[0] / 255,
      config.baseColor[1] / 255,
      config.baseColor[2] / 255,
    )
    const mat = buildMaterial(config.effect, baseColor, config.baseIntensity)
    if (config.flow && overlayGeom.attributes.aArmDist) {
      applyFlowShader(mat, config.flow.pulse_width ?? 0.2)
    }
    const overlay = new THREE.SkinnedMesh(overlayGeom, mat)
    overlay.bind(skeleton, bodyMesh.bindMatrix)
    overlay.bindMode = bodyMesh.bindMode
    overlay.renderOrder = 999
    // RenderStyleManager.apply traverses the character group to swap
    // materials per render-style. Overlay meshes live in that
    // hierarchy too, so without this flag they'd get their per-overlay
    // material replaced by the shared wireMat/holoMat — and the next
    // tickOverlay would mutate those shared instances, breaking the
    // body's render style for every other mesh.
    overlay.userData.isBodyOverlay = true
    return { mesh: overlay, tris: kept.length / 3, fromBody: bodyMesh }
  }
  return null
}

/** Attach an optional PointLight to the named bone on the matched body
 *  mesh's skeleton. Returns null if the bone isn't found. Caller is
 *  responsible for adding it to the scene/parent. */
export function buildOverlayLight(
  skeleton: THREE.Skeleton,
  config: BodyOverlayConfig,
): { light: THREE.PointLight; bone: THREE.Bone } | null {
  if (!config.light) return null
  const bone = findBone(skeleton, config.light.attachToBone)
  if (!bone) return null
  const light = new THREE.PointLight(
    new THREE.Color(
      config.baseColor[0] / 255,
      config.baseColor[1] / 255,
      config.baseColor[2] / 255,
    ).getHex(),
    config.baseIntensity * (config.light.intensityScale ?? 2.0),
    config.light.distance ?? 0.5,
    2.0,
  )
  return { light, bone }
}

// ── Driver evaluation ──────────────────────────────────────────────────

/** Spike duration — flash on driver events (e.g. WLED state push) decays
 *  over this many ms. */
export const OVERLAY_SPIKE_MS = 300

/** Compute target color + intensity (+ spike bonus) for an overlay this
 *  frame, based on its driver and the runtime context. Pure-ish — only
 *  reads from ctx; doesn't mutate the overlay. */
export function computeOverlayTarget(
  overlay: BodyOverlay,
  ctx: OverlayContext,
  /** Pre-allocated scratch — caller owns lifetime to avoid per-frame alloc. */
  out: { color: THREE.Color },
): { intensity: number; spike: number } {
  const cfg = overlay.config
  const baseR = cfg.baseColor[0] / 255
  const baseG = cfg.baseColor[1] / 255
  const baseB = cfg.baseColor[2] / 255

  let spike = 0
  if (overlay.spikeUntilMs > ctx.now) {
    spike = Math.min(1, (overlay.spikeUntilMs - ctx.now) / OVERLAY_SPIKE_MS) * 0.5
  }

  switch (cfg.driver.kind) {
    case 'static':
      out.color.setRGB(baseR, baseG, baseB)
      return { intensity: cfg.baseIntensity, spike }
    case 'wled-hand': {
      // Find a device whose aura_hand routes to this hand.
      const want = cfg.driver.hand
      for (const dev of Object.values(ctx.wledDevices)) {
        if (!dev.state) continue
        const has = (dev.aura_hand || 'none').toLowerCase()
        const match =
          (want === 'right' && (has === 'right' || has === 'both')) ||
          (want === 'left' && (has === 'left' || has === 'both')) ||
          (want === 'both' && has !== 'none')
        if (!match) continue
        out.color.setRGB(
          dev.state.color[0] / 255,
          dev.state.color[1] / 255,
          dev.state.color[2] / 255,
        )
        // baseIntensity acts as the CEILING — multiplied by the device
        // brightness so baseIntensity=1 + bri=255 = full glow (same as
        // the prior behavior at bri=255), while baseIntensity=0.5 caps
        // the max at half no matter how bright the lamp is. When the
        // device is off → 0; the absent glow communicates "off" more
        // clearly than a residual floor would.
        const intensity = dev.state.on ? (dev.state.bri / 255) * cfg.baseIntensity : 0
        return { intensity, spike }
      }
      // No matching device — fall back to baseline (no scaling; the
      // baseIntensity acts as a static glow when no device is routed).
      out.color.setRGB(baseR, baseG, baseB)
      return { intensity: cfg.baseIntensity, spike }
    }
    case 'tts-rms': {
      out.color.setRGB(baseR, baseG, baseB)
      const gain = cfg.driver.gain ?? 3
      const intensity = ctx.mode === 'speaking' ? Math.min(1, ctx.ttsRms * gain) : 0
      return { intensity, spike }
    }
    case 'mode-pulse': {
      out.color.setRGB(baseR, baseG, baseB)
      if (ctx.mode !== cfg.driver.whenMode) return { intensity: 0, spike }
      const period = cfg.driver.periodMs ?? 1500
      const max = cfg.driver.max ?? 0.7
      const phase = (ctx.now / period) * Math.PI * 2
      const pulse = (Math.sin(phase) + 1) / 2 // 0..1
      return { intensity: pulse * max, spike }
    }
    case 'mode-on': {
      out.color.setRGB(baseR, baseG, baseB)
      if (ctx.mode !== cfg.driver.whenMode) return { intensity: 0, spike }
      return { intensity: cfg.driver.intensity ?? 0.6, spike }
    }
  }
}

/** Trigger a spike flash on overlays whose driver matches the given
 *  WLED event (used when a `wled` WS event arrives). Looks up each
 *  overlay's `wled-hand` driver against the device's aura_hand. */
export function triggerWLEDSpike(overlays: BodyOverlay[], device: WLEDDevice, now: number): void {
  const has = (device.aura_hand || 'none').toLowerCase()
  if (has === 'none') return
  for (const o of overlays) {
    if (o.config.driver.kind !== 'wled-hand') continue
    const want = o.config.driver.hand
    const match =
      (want === 'right' && (has === 'right' || has === 'both')) ||
      (want === 'left' && (has === 'left' || has === 'both')) ||
      (want === 'both' && has !== 'none')
    if (match) o.spikeUntilMs = now + OVERLAY_SPIKE_MS
  }
}

/** Per-frame application: lerp current → target, write to the mesh
 *  material + light. Caller passes the scratch + ctx. */
export function tickOverlay(
  overlay: BodyOverlay,
  ctx: OverlayContext,
  scratch: { targetColor: THREE.Color },
  lerpRate = 0.12,
): void {
  if (!overlay.mesh) return
  const { intensity: targetI, spike } = computeOverlayTarget(overlay, ctx, {
    color: scratch.targetColor,
  })
  // Lerp current toward target.
  overlay.currentColor.lerp(scratch.targetColor, lerpRate)
  overlay.currentIntensity += (targetI - overlay.currentIntensity) * lerpRate
  const rendered = Math.min(1, overlay.currentIntensity + spike)
  // Material write — different shape depending on effect.
  const mat = overlay.mesh.material as THREE.MeshBasicMaterial | THREE.MeshStandardMaterial
  mat.color.copy(overlay.currentColor)
  mat.opacity = rendered * 0.75
  if ('emissive' in mat) {
    mat.emissive.copy(overlay.currentColor)
  }
  if (overlay.light) {
    overlay.light.color.copy(overlay.currentColor)
    overlay.light.intensity = rendered * (overlay.config.light?.intensityScale ?? 2.0)
  }
  // Flow shader uPhase advance. Each tick walks the pulse center
  // along [0, 1] then wraps back to 0 — a continuous chain-traveling
  // bright spot. Skipped silently when the shader hasn't compiled yet
  // (first frame) or the overlay has no flow config.
  if (mat.userData.flowEnabled) {
    const uniforms = mat.userData.flowUniforms as {
      uPhase: { value: number }
      uPulseWidth: { value: number }
    } | null
    if (uniforms) {
      const periodMs = overlay.config.flow?.period_ms ?? 1800
      const t = (ctx.now / periodMs) % 1
      // Extend the phase range slightly past [0,1] so the pulse fades
      // out fully before snapping back to the start. Using [-w, 1+w]
      // means the Gaussian tail has room to decay.
      const w = (mat.userData.flowPulseWidth as number) ?? 0.2
      uniforms.uPhase.value = -w + t * (1 + 2 * w)
    }
  }
}
