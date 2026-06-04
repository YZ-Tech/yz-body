// STRICT-LINE POLICY: cross-rig clip playback is intentionally NOT
// supported. Each character only plays clips authored for its own rig:
//   - Loom / Yeon (Mixamo-rigged Streamoji avatars): private Mixamo
//     .fbx clips under _private_assets/animations/
//   - BotM / BotF (Quaternius UAL mannequins): Quaternius .glb clips
//     under web/static/body/animations/ at the public groups
//
// Multiple runtime retargeting approaches were attempted (simple name
// remap, pelvis 90° offset, SkeletonUtils.retargetClip, full bind-pose
// conjugation) plus offline Blender retargeting (Copy Rotation WORLD,
// LOCAL_WITH_PARENT, hybrid skip-clavicles). None produced acceptable
// results because Mixamo (identity-rest) and Quaternius (rest-baked
// coordinate convention) rigs are too different to reconcile without
// professional retargeting tools (Auto-Rig Pro, Reallusion ActorCore).
//
// The dictionary + RigType + sourceRigFor/targetRigFor helpers remain
// so the cross-rig detection diagnostic in ClipPlayer can fire (warning
// the user when a clip wouldn't drive the active character).

/** Source/target rig types we know how to translate between. Mixamo is
 *  the legacy Loom/Yeon rig (Streamoji-derived, Mixamo-bone-compatible);
 *  Quaternius is the new BotM/BotF rig from Universal Animation Library.
 *  Both are T-pose, Y-up, ~65-bone standard humanoids. */
export type RigType = 'mixamo' | 'quaternius'

/** Mixamo standard humanoid bone names → Quaternius UAL bone names.
 *  Conceptually 1:1: both rigs have the same 3-segment spine, 3-segment
 *  finger chains + leaf tips, and matching arm/leg topology. The `Head`
 *  bone is literally identical (same word) — a hint that conventions
 *  overlap. `HeadTop_End` has no Quaternius equivalent and drops; the
 *  AnimationMixer silently skips tracks targeting bones it can't find. */
export const MIXAMO_TO_QUATERNIUS: Record<string, string> = {
  Hips: 'pelvis',
  Spine: 'spine_01',
  Spine1: 'spine_02',
  Spine2: 'spine_03',
  Neck: 'neck_01',
  Head: 'Head',

  // Left arm chain
  LeftShoulder: 'clavicle_l',
  LeftArm: 'upperarm_l',
  LeftForeArm: 'lowerarm_l',
  LeftHand: 'hand_l',

  // Left fingers — Mixamo 1..3 + tip-4 → Quaternius 01..03 + 04_leaf
  LeftHandThumb1: 'thumb_01_l',
  LeftHandThumb2: 'thumb_02_l',
  LeftHandThumb3: 'thumb_03_l',
  LeftHandThumb4: 'thumb_04_leaf_l',
  LeftHandIndex1: 'index_01_l',
  LeftHandIndex2: 'index_02_l',
  LeftHandIndex3: 'index_03_l',
  LeftHandIndex4: 'index_04_leaf_l',
  LeftHandMiddle1: 'middle_01_l',
  LeftHandMiddle2: 'middle_02_l',
  LeftHandMiddle3: 'middle_03_l',
  LeftHandMiddle4: 'middle_04_leaf_l',
  LeftHandRing1: 'ring_01_l',
  LeftHandRing2: 'ring_02_l',
  LeftHandRing3: 'ring_03_l',
  LeftHandRing4: 'ring_04_leaf_l',
  LeftHandPinky1: 'pinky_01_l',
  LeftHandPinky2: 'pinky_02_l',
  LeftHandPinky3: 'pinky_03_l',
  LeftHandPinky4: 'pinky_04_leaf_l',

  // Right arm chain (mirror left)
  RightShoulder: 'clavicle_r',
  RightArm: 'upperarm_r',
  RightForeArm: 'lowerarm_r',
  RightHand: 'hand_r',

  // Right fingers
  RightHandThumb1: 'thumb_01_r',
  RightHandThumb2: 'thumb_02_r',
  RightHandThumb3: 'thumb_03_r',
  RightHandThumb4: 'thumb_04_leaf_r',
  RightHandIndex1: 'index_01_r',
  RightHandIndex2: 'index_02_r',
  RightHandIndex3: 'index_03_r',
  RightHandIndex4: 'index_04_leaf_r',
  RightHandMiddle1: 'middle_01_r',
  RightHandMiddle2: 'middle_02_r',
  RightHandMiddle3: 'middle_03_r',
  RightHandMiddle4: 'middle_04_leaf_r',
  RightHandRing1: 'ring_01_r',
  RightHandRing2: 'ring_02_r',
  RightHandRing3: 'ring_03_r',
  RightHandRing4: 'ring_04_leaf_r',
  RightHandPinky1: 'pinky_01_r',
  RightHandPinky2: 'pinky_02_r',
  RightHandPinky3: 'pinky_03_r',
  RightHandPinky4: 'pinky_04_leaf_r',

  // Left leg chain
  LeftUpLeg: 'thigh_l',
  LeftLeg: 'calf_l',
  LeftFoot: 'foot_l',
  LeftToeBase: 'ball_l',
  LeftToe_End: 'ball_leaf_l',

  // Right leg chain
  RightUpLeg: 'thigh_r',
  RightLeg: 'calf_r',
  RightFoot: 'foot_r',
  RightToeBase: 'ball_r',
  RightToe_End: 'ball_leaf_r',
}

/** Lazy inverse map for the reverse direction (Quaternius clip on a
 *  Mixamo character). We don't ship that combo today, but the system
 *  is rig-agnostic so future-Yeon doesn't need to revisit this code
 *  when a third rig shows up. */
let QUATERNIUS_TO_MIXAMO: Record<string, string> | null = null

function inverseMap(): Record<string, string> {
  if (!QUATERNIUS_TO_MIXAMO) {
    QUATERNIUS_TO_MIXAMO = Object.fromEntries(
      Object.entries(MIXAMO_TO_QUATERNIUS).map(([m, q]) => [q, m]),
    )
  }
  return QUATERNIUS_TO_MIXAMO
}

/** Target's pelvis-equivalent bone name per rig. SkeletonUtils.retarget's
 *  `hip` option uses this to special-case the root translation track. */
export const HIP_BONE_OF: Record<RigType, string> = {
  mixamo: 'Hips',
  quaternius: 'pelvis',
}

/** Build the SkeletonUtils.retargetClip `names` option for a given
 *  (source, target) rig pair. SkeletonUtils keys this map by TARGET
 *  bone name → SOURCE bone name (it walks the target skeleton and asks
 *  "which source bone provides my data?"). For mixamo→quaternius the
 *  target is Quaternius, so we hand back the INVERSE of MIXAMO_TO_QUATERNIUS.
 *  Returns null for same-rig (no retargeting needed). */
export function retargetNamesFor(
  src: RigType,
  tgt: RigType,
): Record<string, string> | null {
  if (src === tgt) return null
  if (src === 'mixamo' && tgt === 'quaternius') return inverseMap()
  if (src === 'quaternius' && tgt === 'mixamo') return MIXAMO_TO_QUATERNIUS
  return null
}

/** Derive target rig from the active character's filename. Heuristic:
 *  BotM/BotF are the Quaternius UAL mannequins. Anything else (Loom,
 *  Yeon, private characters) uses the Mixamo / Streamoji-compatible
 *  rig. Move to per-character metadata if a third rig joins. */
export function targetRigFor(characterFile: string): RigType {
  const stem = characterFile.split('/').pop() ?? characterFile
  if (stem.startsWith('BotM') || stem.startsWith('BotF')) return 'quaternius'
  return 'mixamo'
}

/** Derive source rig from the clip's path. Heuristic: clips under
 *  `private/` are Mixamo .fbx (auto-mirrored from _private_assets/);
 *  public clips at /body/animations/<Group>/ are Quaternius UAL
 *  extractions. */
export function sourceRigFor(clipPath: string): RigType {
  if (clipPath.startsWith('private/')) return 'mixamo'
  return 'quaternius'
}


// retargetClipTracks() and TargetBoneBind have been removed. Cross-rig
// retargeting was attempted multiple ways (simple name remap, name
// remap + pelvis 90° hack, SkeletonUtils.retargetClip, full bind-pose
// conjugation formula) and none produced a visually correct result
// because Mixamo and Quaternius have incompatible bind poses that
// runtime math can't fully reconcile.
//
// If reviving: the proper fix is offline pre-baked retargeting (open
// each clip in Blender, retarget once with calibration, re-export as
// target-rig native). Then runtime plays them as same-rig and no
// cross-rig math is needed.
