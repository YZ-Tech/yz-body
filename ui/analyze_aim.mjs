// Aim analyzer — sister to analyze_clip.mjs, but answers the spatial
// question instead of the temporal one: at each motion peak, where is
// the right hand in world space, and which direction is the aim vector
// pointing (shoulder → hand)?
//
// Run from frontend/:
//   node analyze_aim.mjs <clip-relative-to-public/body/animations>
//
// Coord conventions (Mixamo bind, no character-scale applied):
//   +X = character's LEFT  (camera right when she faces camera)
//   -X = character's RIGHT
//   +Y = up
//   +Z = behind her (Mixamo characters face +Z in bind; the BodyAvatar
//        scene's camera sits at +Z looking toward origin, so she ends
//        up facing the camera)
//   -Z = in front of her (the direction she's looking)
//
// So an aim with negative Z and small X is "pointing forward toward
// camera", positive X+ negative Z is "forward-and-slightly-to-her-left
// (camera-right)", etc.
import { readFile } from 'node:fs/promises'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import * as THREE from 'three'

const clipName = process.argv[2]
if (!clipName) {
  console.error('Usage: node analyze_aim.mjs <clip.fbx>')
  process.exit(1)
}

const path = `public/body/animations/${clipName}`
const buf = await readFile(path)
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
const root = new FBXLoader().parse(ab, '')
const clip = root.animations[0]
if (!clip) {
  console.error('No animation in', clipName)
  process.exit(1)
}

// Drop position + scale tracks for the same reason BodyAvatar does —
// position tracks in Mixamo cm units would yeet the hips offscreen, and
// scale tracks on the hand-pose clips bring spurious deformations.
clip.tracks = clip.tracks.filter(
  (t) => !t.name.endsWith('.position') && !t.name.endsWith('.scale'),
)

// Find bones — raw FBX keeps the mixamorig prefix, so match accordingly.
let rightHand = null, rightShoulder = null
let leftHand = null,  leftShoulder = null
root.traverse((o) => {
  if (!o.isBone) return
  if      (/RightHand$/i.test(o.name))      rightHand = o
  else if (/RightArm$/i.test(o.name))       rightShoulder = o
  else if (/LeftHand$/i.test(o.name))       leftHand = o
  else if (/LeftArm$/i.test(o.name))        leftShoulder = o
})
if (!rightHand || !rightShoulder || !leftHand || !leftShoulder) {
  console.error('Missing arm bones — found:', {
    rightHand: rightHand?.name, rightShoulder: rightShoulder?.name,
    leftHand:  leftHand?.name,  leftShoulder:  leftShoulder?.name,
  })
  process.exit(1)
}

console.log(`clip: ${clipName}`)
console.log(`duration: ${clip.duration.toFixed(3)}s`)

const mixer = new THREE.AnimationMixer(root)
const action = mixer.clipAction(clip)
action.setLoop(THREE.LoopOnce, 1)
action.clampWhenFinished = true
action.play()

// Sample at 0.2s intervals — coarse enough to skim, fine enough to catch
// the aim hold + transitions.
/** Sample one arm over the clip; return per-step world positions + aim
 *  vectors (shoulder→hand) for that side. */
function sampleArm(label, shoulder, hand) {
  const samples = []
  for (let t = 0; t <= clip.duration + 1e-3; t += 0.2) {
    mixer.setTime(t)
    root.updateMatrixWorld(true)
    const handPos = hand.getWorldPosition(new THREE.Vector3())
    const shoulderPos = shoulder.getWorldPosition(new THREE.Vector3())
    const aim = handPos.clone().sub(shoulderPos)
    const reach = aim.length()
    aim.divideScalar(reach || 1)
    samples.push({ t, handPos, shoulderPos, aim, reach, label })
  }
  return samples
}

/** Pretty-print the most-extended frame and its plain-English direction. */
function reportPeak(samples, label) {
  const sorted = [...samples].sort((a, b) => b.reach - a.reach)
  const peak = sorted[0]
  const handToHips = peak.handPos.y // approximate; not subtracting hips world Y
  const desc = []
  // Three.js coord interp for raw Mixamo FBX in our scene:
  //   +Z = in front of character (BodyAvatar's camera sits at +Z looking
  //        toward origin, so the character ends up facing the camera)
  //   -Z = behind her
  //   +X = her LEFT side (camera-right)  /  -X = her RIGHT (camera-left)
  //   +Y = up
  if (peak.aim.z > 0.3) desc.push('forward (toward camera)')
  else if (peak.aim.z < -0.3) desc.push('backward (away from camera)')
  if (peak.aim.x > 0.3) desc.push("to her left (camera-right)")
  else if (peak.aim.x < -0.3) desc.push("to her right (camera-left)")
  if (peak.aim.y > 0.3) desc.push('upward')
  else if (peak.aim.y < -0.3) desc.push('downward')
  console.log(
    `  ${label}: peak @ t=${peak.t.toFixed(2)}s ` +
    `hand=(${peak.handPos.x.toFixed(0)}, ${peak.handPos.y.toFixed(0)}, ${peak.handPos.z.toFixed(0)}) ` +
    `aim=(${peak.aim.x.toFixed(2)}, ${peak.aim.y.toFixed(2)}, ${peak.aim.z.toFixed(2)}) ` +
    `reach=${peak.reach.toFixed(0)} y=${handToHips.toFixed(0)}cm  → ${desc.join(', ') || 'roughly level'}`,
  )
}

const rSamples = sampleArm('R', rightShoulder, rightHand)
const lSamples = sampleArm('L', leftShoulder, leftHand)

console.log('\nfull-extension snapshots (>90% of max reach), both arms:')
const topR = Math.max(...rSamples.map((s) => s.reach))
const topL = Math.max(...lSamples.map((s) => s.reach))
for (let i = 0; i < rSamples.length; i++) {
  const r = rSamples[i], l = lSamples[i]
  if (r.reach < topR * 0.9 && l.reach < topL * 0.9) continue
  const rMarker = r.reach >= topR * 0.9 ? 'R' : '·'
  const lMarker = l.reach >= topL * 0.9 ? 'L' : '·'
  console.log(
    `  t=${r.t.toFixed(2)}s  ` +
    `${rMarker} hand=(${r.handPos.x.toFixed(0).padStart(4)}, ${r.handPos.y.toFixed(0).padStart(4)}, ${r.handPos.z.toFixed(0).padStart(4)}) ` +
    `${lMarker} hand=(${l.handPos.x.toFixed(0).padStart(4)}, ${l.handPos.y.toFixed(0).padStart(4)}, ${l.handPos.z.toFixed(0).padStart(4)})`,
  )
}

// Inter-hand vector at peak — for two-handed grips this gives the gun's
// long axis (left hand on barrel forend → right hand on grip).
const peakIdx = rSamples
  .map((r, i) => ({ i, sum: r.reach + lSamples[i].reach }))
  .sort((a, b) => b.sum - a.sum)[0].i
const peakR = rSamples[peakIdx], peakL = lSamples[peakIdx]
const inter = peakL.handPos.clone().sub(peakR.handPos)
const interLen = inter.length()
inter.divideScalar(interLen || 1)
console.log(`\npeak summary @ t=${peakR.t.toFixed(2)}s:`)
reportPeak(rSamples, 'right arm')
reportPeak(lSamples, 'left arm ')
console.log(
  `  hand-to-hand: ${interLen.toFixed(0)}cm apart, vector R→L = ` +
  `(${inter.x.toFixed(2)}, ${inter.y.toFixed(2)}, ${inter.z.toFixed(2)})`,
)
