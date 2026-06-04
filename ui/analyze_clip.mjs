// Minimal clip analyzer — uses three's FBXLoader (already installed for
// the frontend) to load an FBX and emit a timeline. Pure Node, no
// browser shim needed because we read the file ourselves and pass the
// ArrayBuffer to loader.parse() (skipping fetch).
//
// Usage (from frontend/):
//   node analyze_clip.mjs <clip-relative-to-public/body/animations>
//   node analyze_clip.mjs --json <clip>     # machine-readable
//
// Or pass --path to provide an absolute path (used by the backend
// analyze endpoint, which already resolves the clip's real location
// — saves re-deriving from a relative one):
//   node analyze_clip.mjs --json --path Y:/.../shooting-gun.fbx
import { readFile } from 'node:fs/promises'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// ── argv parsing ──────────────────────────────────────────────────
const argv = process.argv.slice(2)
let jsonMode = false
let absPath = null
let clipName = null
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--json') jsonMode = true
  else if (a === '--path') absPath = argv[++i]
  else clipName = a
}
clipName = clipName || 'standing-arguing.fbx'
const path = absPath || `public/body/animations/${clipName}`
const isGltf = /\.(glb|gltf)$/i.test(path)
// Suppress the human-readable prints in JSON mode so stdout is parseable.
const log = jsonMode ? () => {} : console.log

const buf = await readFile(path)
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)

let clip = null
if (isGltf) {
  // GLTFLoader.parse needs a path arg for resource resolution — empty
  // is fine since we only care about animations[0], not textures.
  const gltf = await new Promise((resolve, reject) => {
    new GLTFLoader().parse(ab, '', resolve, reject)
  })
  clip = gltf.animations?.[0]
} else {
  const root = new FBXLoader().parse(ab, '')
  clip = root.animations[0]
}

if (!clip) {
  console.error('No animation in', clipName)
  process.exit(1)
}

log(`clip: ${clipName}`)
log(`duration: ${clip.duration.toFixed(3)}s`)
log(`tracks: ${clip.tracks.length}`)

// Per track: sample positions/rotations at fixed time points; compute
// magnitude of change between samples; collect "activity moments" where
// a bone moved significantly.
const SAMPLE_HZ = 10                              // 100ms granularity is plenty
const N = Math.ceil(clip.duration * SAMPLE_HZ) + 1
const times = []
for (let i = 0; i < N; i++) times.push(i / SAMPLE_HZ)

// Activity score per (bone, time) — Euclidean delta between this sample
// and the previous one in track's native value space.
const tmpA = []
const tmpB = []
function sampleTrack(track, t) {
  // Linear-sample the track at time t. We don't need perfect alignment;
  // this is for activity heuristics.
  const tArr = track.times
  const vArr = track.values
  const stride = track.getValueSize()
  if (t <= tArr[0]) return vArr.slice(0, stride)
  if (t >= tArr[tArr.length - 1]) return vArr.slice(-stride)
  // Binary search would be faster but the tracks aren't huge.
  let i = 0
  while (i < tArr.length - 1 && tArr[i + 1] < t) i++
  const t0 = tArr[i], t1 = tArr[i + 1]
  const f = (t - t0) / (t1 - t0)
  const out = new Array(stride)
  for (let k = 0; k < stride; k++) {
    out[k] = vArr[i * stride + k] * (1 - f) + vArr[(i + 1) * stride + k] * f
  }
  return out
}

function dist(a, b) {
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2
  return Math.sqrt(s)
}

// Bucket per-time activity by bone (track-name's prefix before '.').
// Track names look like "mixamorigHips.quaternion" or "mixamorig:Hips.quaternion"
// — match BodyAvatar's normalizeClip regex so bone names line up across both.
const boneActivity = new Map() // bone -> [{t, score}]
for (const track of clip.tracks) {
  const bone = track.name.split('.')[0].replace(/^mixamorig\d*:?/, '') || track.name
  if (!boneActivity.has(bone)) boneActivity.set(bone, [])
  let prev = sampleTrack(track, times[0])
  for (let i = 1; i < times.length; i++) {
    const cur = sampleTrack(track, times[i])
    const d = dist(prev, cur)
    boneActivity.get(bone).push({ t: times[i], score: d })
    prev = cur
  }
}

// Per bone, compute total activity. Bones contributing nothing get skipped.
const boneTotals = []
for (const [bone, samples] of boneActivity) {
  const total = samples.reduce((s, x) => s + x.score, 0)
  boneTotals.push({ bone, total })
}
boneTotals.sort((a, b) => b.total - a.total)

log('\ntop active bones (total motion score):')
for (const { bone, total } of boneTotals.slice(0, 12)) {
  log(`  ${bone.padEnd(25)} ${total.toFixed(3)}`)
}

// Per-timestep total activity across all bones — find peaks.
const stepTotals = []
for (let i = 0; i < times.length - 1; i++) {
  let total = 0
  for (const samples of boneActivity.values()) total += samples[i]?.score ?? 0
  stepTotals.push({ t: times[i + 1], total })
}

// Smooth a bit (3-step rolling mean).
const smoothed = stepTotals.map((s, i, a) => {
  const lo = Math.max(0, i - 1), hi = Math.min(a.length - 1, i + 1)
  const slice = a.slice(lo, hi + 1)
  const avg = slice.reduce((acc, x) => acc + x.total, 0) / slice.length
  return { t: s.t, total: avg }
})

const maxTotal = smoothed.reduce((m, s) => Math.max(m, s.total), 0)

log('\nactivity timeline (0-10 bar, smoothed):')
for (const s of smoothed) {
  const bar = '█'.repeat(Math.round((s.total / maxTotal) * 30))
  log(`  ${s.t.toFixed(2)}s  ${bar} ${s.total.toFixed(3)}`)
}

// Identify "peaks" — local maxima above 60% of overall max.
const threshold = maxTotal * 0.6
const peaks = []
for (let i = 1; i < smoothed.length - 1; i++) {
  const cur = smoothed[i]
  if (cur.total < threshold) continue
  if (cur.total < smoothed[i - 1].total || cur.total < smoothed[i + 1].total) continue
  const contribs = []
  for (const [bone, samples] of boneActivity) {
    const score = samples[i - 1]?.score ?? 0
    if (score > 0) contribs.push({ bone, score })
  }
  contribs.sort((a, b) => b.score - a.score)
  const topBones = contribs.slice(0, 4).map((c) => c.bone)
  peaks.push({ t: Number(cur.t.toFixed(2)), intensity: Number(cur.total.toFixed(3)), bones: topBones })
}

log('\npeak motion moments (>60% of max, local maxima):')
for (const p of peaks) {
  log(`  ${p.t.toFixed(2)}s  intensity=${p.intensity.toFixed(2)}  via: ${p.bones.join(', ')}`)
}

// JSON mode: emit a single line on stdout that the backend parses.
// peaks are pre-sorted by time; backend re-sorts by intensity if it
// wants top-K. Includes top_bones for the catalog's "via: ..." hint.
if (jsonMode) {
  const top_bones = boneTotals.slice(0, 6).map((b) => ({
    bone: b.bone,
    total: Number(b.total.toFixed(3)),
  }))
  process.stdout.write(
    JSON.stringify({
      clip: clipName,
      duration: Number(clip.duration.toFixed(3)),
      tracks: clip.tracks.length,
      max_intensity: Number(maxTotal.toFixed(3)),
      top_bones,
      peaks,
    }) + '\n',
  )
}
