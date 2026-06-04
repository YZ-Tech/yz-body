import { characterUrl } from './avatarConstants'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import ClearIcon from '@mui/icons-material/Clear'
import { IconBtn } from '../components/IconBtn'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useBodyFlags } from '../hooks/useBodyFlags'
import {
  applyPointIK,
  createPointScratch,
  discoverPointBones,
  emptyPointBones,
  pickPointArm,
  type PointBones,
} from '../lib/body/pointIK'
import type { Point3 } from '../api/types'

/** Click-to-locate dialog: renders the body character in a small isolated
 *  three.js scene, with an invisible "click sphere" surrounding her at
 *  roughly arm-reach radius. Clicking the canvas raycasts onto that sphere
 *  and parks a visible red marker at the hit point. The picked coord is
 *  returned via `onSave` (world-space, same coord system the live
 *  BodyAvatar uses for playPoint).
 *
 *  IK PREVIEW: this scene runs the SAME point-IK code as the dashboard
 *  BodyAvatar (shared via `lib/body/pointIK`). When the user picks a point,
 *  the dialog's character lifts her arm to point at it — so you can
 *  validate the gesture without flipping to the dashboard tab. No need
 *  for a separate "Test on live avatar" button anymore.
 *
 *  STATE MODEL: the scene's tick reads picked-state through a ref, NOT
 *  through React closures. This avoids the closure-staleness bug where
 *  the marker's setter captured `null` on first dialog open (because the
 *  scene effect ran in the same render as the picked-state seeder) and
 *  silently no-op'd when a saved point arrived. React state still drives
 *  Save-button enabled/disabled + the coord readout. */
/** Character is rendered at scale 100 (1 unit = 1 cm) to match the live
 *  BodyAvatar; coords saved here go through to the same math. */
const CHARACTER_SCALE = 100
/** Center + radius of the invisible "click sphere" used for raycasting.
 *  ~140 in world units puts the center around chest height; 250 radius
 *  is just beyond outstretched arm-reach, so picked points feel reachable
 *  in the resulting gesture. */
const CLICK_SPHERE_CENTER_Y = 140
const CLICK_SPHERE_RADIUS = 250
/** Diameter of the visible red marker (in world units; ~12cm at scale 100). */
const MARKER_SIZE = 12
/** Per-frame approach rate for the IK weight in the locator preview.
 *  Higher = faster lift. 0.15 → ~10 frames to ~80% (≈170ms at 60Hz). */
const PREVIEW_WEIGHT_LERP = 0.15

export function BodyPointLocator({
  open,
  onClose,
  onSave,
  initial,
  deviceLabel,
}: {
  open: boolean
  onClose: () => void
  onSave: (p: Point3) => void
  initial?: Point3 | null
  /** Optional name shown in the dialog title (e.g. WLED alias). */
  deviceLabel?: string
}) {
  // CALLBACK REF instead of useRef — MUI Dialog's Fade transition mounts
  // children on a tick AFTER React's initial commit, so a useRef'd
  // canvas is still `null` when the scene useEffect first fires.
  // A callback ref bound to setState triggers a re-render once the
  // canvas actually mounts, and the scene useEffect re-runs with it
  // in its dep array. (Verified diagnostically: console showed
  // `canvasRef.current= null` at scene-effect entry under useRef.)
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null)
  const [flags] = useBodyFlags()
  // Picked target — dual storage: useState for React UI (readout +
  // Save-button enabled state) and useRef for the tick's per-frame
  // read. The combined setter writes both atomically so the tick sees
  // the new value on its NEXT frame, no useEffect-sync race window.
  const [picked, setPickedState] = useState<Point3 | null>(null)
  const pickedRef = useRef<Point3 | null>(null)
  const setPicked = (p: Point3 | null) => {
    pickedRef.current = p
    setPickedState(p)
  }
  // Re-seed from `initial` only on the open=false→true transition.
  // `initial` is a prop derived from the parent's state and CAN be a
  // fresh reference on every parent re-render (device-list refetch
  // re-allocates the underlying object, `?? null` makes a literal
  // each time it returns null, etc.). Depending on `initial` directly
  // would call setPicked on every parent render → infinite re-render
  // loop (React error #185). The `lastOpenRef` pattern triggers seed
  // exactly once per open.
  const lastOpenRef = useRef(open)
  useEffect(() => {
    if (open && !lastOpenRef.current) {
      setPicked(initial ?? null)
    }
    lastOpenRef.current = open
  }, [open, initial])

  // Scene effect — recreated each open. Tearing down on close avoids
  // leaking a WebGL context behind a closed dialog.
  useEffect(() => {
    if (!open) return
    const canvas = canvasEl
    if (!canvas) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x04060e)

    // Fallback dimensions if the canvas hasn't laid out yet (MUI Dialog
    // mounts the content during a transition; the canvas may briefly be
    // 0×0 when this effect first runs, which would init the renderer at
    // 0×0 and produce a black-on-black canvas until the resize observer
    // happens to fire). ResizeObserver below corrects to actual size as
    // soon as layout settles.
    const initialW = canvas.clientWidth || 800
    const initialH = canvas.clientHeight || 480
    const camera = new THREE.PerspectiveCamera(35, initialW / initialH, 1, 2000)
    camera.position.set(0, 170, 320)
    camera.lookAt(0, 140, 0)

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(initialW, initialH, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping

    const controls = new OrbitControls(camera, canvas)
    controls.target.set(0, 140, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 120
    controls.maxDistance = 700

    // Lights — mirrors the dashboard BodyAvatar so the character reads
    // the same here as it does in the live preview.
    scene.add(new THREE.AmbientLight(0xffffff, 0.5))
    const key = new THREE.DirectionalLight(0xffffff, 1.0)
    key.position.set(150, 250, 200)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0x9eb5ff, 0.4)
    fill.position.set(-200, 150, 100)
    scene.add(fill)

    // Faint floor disc — gives the user a sense of "where the ground is"
    // when placing low targets (desk lamps, etc.).
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(280, 48),
      new THREE.MeshBasicMaterial({ color: 0x12182a, side: THREE.DoubleSide }),
    )
    floor.rotation.x = -Math.PI / 2
    scene.add(floor)
    // Three thin height-rings for vertical reference (ankle / waist /
    // shoulder). Subtle — they shouldn't fight the character visually.
    for (const y of [10, 90, 160]) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(CLICK_SPHERE_RADIUS - 1, CLICK_SPHERE_RADIUS, 64),
        new THREE.MeshBasicMaterial({
          color: 0x2a3550,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.35,
        }),
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.y = y
      scene.add(ring)
    }

    // Invisible-ish click sphere — the actual raycast target. Slight
    // opacity (0.05) so the user understands "you're picking ON this
    // sphere" without it dominating the scene.
    const clickSphere = new THREE.Mesh(
      new THREE.SphereGeometry(CLICK_SPHERE_RADIUS, 48, 32),
      new THREE.MeshBasicMaterial({
        color: 0x4a6090,
        transparent: true,
        opacity: 0.05,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    clickSphere.position.y = CLICK_SPHERE_CENTER_Y
    scene.add(clickSphere)

    // Visible target marker — small red sphere placed at the picked
    // point. Emissive material so it pops against the dark background
    // even at low light intensities.
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(MARKER_SIZE, 16, 12),
      new THREE.MeshStandardMaterial({
        color: 0xff3344,
        emissive: 0xff2233,
        emissiveIntensity: 0.6,
      }),
    )
    marker.visible = false
    scene.add(marker)

    // Faint dashed line from chest pivot to marker — helps the user
    // read direction at a glance ("she'd point THAT way").
    const lineMat = new THREE.LineDashedMaterial({
      color: 0xff6677,
      dashSize: 8,
      gapSize: 4,
      transparent: true,
      opacity: 0.7,
    })
    const lineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, CLICK_SPHERE_CENTER_Y, 0),
      new THREE.Vector3(0, CLICK_SPHERE_CENTER_Y, 0),
    ])
    const line = new THREE.Line(lineGeom, lineMat)
    line.computeLineDistances()
    line.visible = false
    scene.add(line)

    // Character — load asynchronously; the scene renders fine before it
    // arrives (just the floor + sphere + marker), and the load-finished
    // re-render adds the character on top.
    let character: THREE.Group | null = null
    let bones: PointBones = emptyPointBones()
    let armSide: 'left' | 'right' = 'right'
    const scratch = createPointScratch()
    let cancelled = false
    const loader = new GLTFLoader()
    loader
      .loadAsync(characterUrl(flags.characterFile))
      .then((gltf) => {
        if (cancelled) return
        character = gltf.scene
        character.scale.setScalar(CHARACTER_SCALE)
        scene.add(character)
        bones = discoverPointBones(character)
        console.log('[body-locator] character loaded, bones:',
          'armR=', bones.armR?.name ?? 'null',
          'armL=', bones.armL?.name ?? 'null')
      })
      .catch((e) => {
        console.warn('[body-locator] failed to load character', e)
      })

    // Raycast on click: hit the click sphere, set picked via React
    // state. The tick will pick up the new pickedRef.current next frame
    // and update marker + IK.
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let dragStart = { x: 0, y: 0 }
    let dragMoved = false
    const onPointerDown = (e: PointerEvent) => {
      dragStart = { x: e.clientX, y: e.clientY }
      dragMoved = false
    }
    const onPointerMove = (e: PointerEvent) => {
      if ((e.buttons & 1) === 0 && (e.buttons & 2) === 0) return
      const dx = e.clientX - dragStart.x
      const dy = e.clientY - dragStart.y
      // 8px threshold (squared = 64). Cleaner mouse clicks have 2-5px
      // jitter between down/up; 4px was too tight and killed clicks.
      if (dx * dx + dy * dy > 64) dragMoved = true
    }
    const onPointerUp = (e: PointerEvent) => {
      console.log('[body-locator] onPointerUp dragMoved=', dragMoved, 'button=', e.button)
      // Ignore clicks that are part of an OrbitControls drag.
      if (dragMoved) return
      const rect = canvas.getBoundingClientRect()
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObject(clickSphere)
      console.log('[body-locator] raycast hits=', hits.length, 'pointer=', pointer.x.toFixed(2), pointer.y.toFixed(2))
      if (hits.length === 0) return
      // raycaster sorts by distance ascending; front face is hits[0].
      const p = hits[0].point
      const next = { x: p.x, y: p.y, z: p.z }
      setPicked(next)
      // Re-pick arm at the moment of click — using the just-clicked
      // point, not a stale previous one. Bones are guaranteed by now
      // for any user that's clicked (the load resolves long before).
      if (bones.armR || bones.armL) {
        armSide = pickPointArm(bones, new THREE.Vector3(next.x, next.y, next.z), 'auto')
      }
    }
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)

    // Resize.
    const onResize = () => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(canvas)

    // Render loop. Reads `pickedRef.current` each frame so state changes
    // flow in without re-running the scene effect. Smooths the IK weight
    // toward 1 when something is picked and toward 0 when not — gives a
    // nice lift-up / lower-down animation on pick / clear.
    let smoothedWeight = 0
    // The "last applied target" — used for the easeOut frames after
    // pickedRef goes null. Without this, the arm would snap to its
    // unanimated bind pose mid-easeOut.
    const lingerTarget = new THREE.Vector3()
    let hasLingerTarget = false
    const targetVec = new THREE.Vector3()
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const p = pickedRef.current
      // Marker + line update — runs every frame so any pick / clear is
      // reflected on the next paint.
      if (p) {
        marker.position.set(p.x, p.y, p.z)
        marker.visible = true
        const positions = line.geometry.attributes.position as THREE.BufferAttribute
        positions.setXYZ(1, p.x, p.y, p.z)
        positions.needsUpdate = true
        line.computeLineDistances()
        line.visible = true
      } else {
        marker.visible = false
        line.visible = false
      }
      // IK: aim the chosen arm at the picked point. Weight smooths
      // toward 1 (when picked) or 0 (when not) for a natural raise /
      // lower motion. Re-pick the arm if we got bones AFTER the user
      // already had a pick (handles the load-after-pick edge case).
      if (p && (bones.armR || bones.armL)) {
        if (!hasLingerTarget) {
          armSide = pickPointArm(bones, targetVec.set(p.x, p.y, p.z), 'auto')
        }
        lingerTarget.set(p.x, p.y, p.z)
        hasLingerTarget = true
      }
      const wantWeight = p ? 1 : 0
      smoothedWeight += (wantWeight - smoothedWeight) * PREVIEW_WEIGHT_LERP
      if (character && hasLingerTarget && smoothedWeight > 0.01) {
        applyPointIK(character, bones, armSide, lingerTarget, smoothedWeight, scratch)
      } else if (smoothedWeight <= 0.01 && !p) {
        // Arm has fully relaxed — drop the linger so the next pick
        // re-discovers the arm side from scratch.
        hasLingerTarget = false
      }
      controls.update()
      renderer.render(scene, camera)
    }
    tick()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      if (character) scene.remove(character)
      scene.clear()
    }
  }, [open, canvasEl, flags.characterFile])

  const clear = () => setPicked(null)
  const save = () => {
    if (!picked) {
      onClose()
      return
    }
    onSave(picked)
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        Locate {deviceLabel ? <code>{deviceLabel}</code> : 'device'}
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Click anywhere in the scene to place a target point — the avatar
          lifts her arm to point at it so you can see how the gesture will
          look. Orbit with left-drag, zoom with wheel. The red dot is your
          pick; the same coord is what fires when the device is controlled.
        </Typography>
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            height: 480,
            bgcolor: '#04060e',
            borderRadius: 1,
            overflow: 'hidden',
          }}
        >
          <canvas
            ref={setCanvasEl}
            style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
          />
          {picked && (
            <Stack
              direction="row"
              sx={{
                position: 'absolute',
                top: 8,
                right: 8,
                bgcolor: 'rgba(4, 6, 14, 0.7)',
                backdropFilter: 'blur(4px)',
                borderRadius: 1,
                px: 1,
                py: 0.5,
                gap: 1,
                alignItems: 'center',
              }}
            >
              <Typography
                variant="caption"
                sx={{ fontFamily: 'ui-monospace, monospace', color: '#cfd6e6' }}
              >
                ({picked.x.toFixed(0)}, {picked.y.toFixed(0)}, {picked.z.toFixed(0)})
              </Typography>
              <IconBtn label="Clear pick" onClick={clear} sx={{ color: '#cfd6e6' }} icon={<ClearIcon />} />
            </Stack>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={!picked}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
