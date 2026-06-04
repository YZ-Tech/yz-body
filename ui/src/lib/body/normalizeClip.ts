import * as THREE from 'three'

/** Normalize a Mixamo / glTF animation clip so its tracks bind to our
 *  character.
 *  - Drop position tracks: Mixamo authors them in cm, we scale GLB
 *    characters 100×, so applied positions yeet the hip offscreen.
 *  - Drop scale tracks: hand-pose / eye-idle clips ship spurious
 *    bone-scale tracks that explode geometry under additive blend.
 *  - Strip the `mixamorig\d*:?` prefix and the `_\d+` suffix some
 *    GLB exporters add (Streamoji clips bound to `Hips_1` etc.).
 *
 *  `retargeted` flag: pass `true` for clips that already went through
 *  SkeletonUtils.retargetClip — their track names are clean target-bone
 *  names (e.g. Quaternius `spine_01.quaternion`), and the `_\d+`
 *  suffix stripper would corrupt them into `spine.quaternion` (which
 *  collides with `spine_02`/`spine_03` and yields PropertyBinding
 *  "No target node" warnings since no `spine` bone exists in the target
 *  skeleton). The filter step (dropping .position/.scale) is still
 *  safe and runs unconditionally — Quaternius hip positions would yeet
 *  the character just like Mixamo's.
 *
 *  Tracks with no matching bone are silently dropped by Three.js. */
export function normalizeClip(clip: THREE.AnimationClip, retargeted = false): void {
  clip.tracks = clip.tracks.filter(
    (t) => !t.name.endsWith('.position') && !t.name.endsWith('.scale'),
  )
  if (retargeted) return
  for (const t of clip.tracks) {
    t.name = t.name
      .replace(/^mixamorig\d*:?/, '')
      // Streamoji's `Hips_1`-style single-digit suffix gets stripped.
      // Quaternius uses two-digit zero-padded names like `spine_01`,
      // `neck_01` as REAL bone names — the previous broader `_\d+`
      // pattern mangled those into `spine`/`neck` (which don't exist
      // on the rig) and produced PropertyBinding warnings. Restrict to
      // single-digit to catch only the Streamoji case.
      .replace(/^([^.]+?)_\d(\.)/, '$1$2')
  }
}
