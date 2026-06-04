import * as THREE from 'three'
import type { BodyEyeBoneCandidates } from '../../lib/body/behavior'

/** Walks a loaded character and binds the eye/head/jaw bones plus the
 *  lipsync (jaw-open) and blink (eyeBlink) morph targets that the gaze,
 *  lipsync, and blink systems read each frame.
 *
 *  All fields are public + nullable so the per-tick systems can degrade
 *  gracefully on rigs missing a bone or morph. */
export class BoneBindings {
  eyeL: THREE.Bone | null = null
  eyeR: THREE.Bone | null = null
  headBone: THREE.Bone | null = null
  jawBone: THREE.Bone | null = null

  // Rest-pose quaternions captured at discovery time. Gaze/lipsync
  // apply RELATIVE to rest so animation curves on the same bone don't
  // fight us.
  eyeRestL: THREE.Quaternion | null = null
  eyeRestR: THREE.Quaternion | null = null
  headRest: THREE.Quaternion | null = null
  jawRest: THREE.Quaternion | null = null

  /** Lipsync targets — every mesh that has one of the jaw-open morph
   *  candidates (first hit per mesh). ARKit shapes typically live on
   *  multiple face meshes (face / head / teeth / eyes) so we drive
   *  every mesh that has the morph. */
  lipTargets: { mesh: THREE.Mesh; idx: number }[] = []
  /** Blink targets — same multi-mesh pattern, one entry per (mesh,
   *  morph) pair across both eyeBlinkLeft AND eyeBlinkRight. */
  blinkTargets: { mesh: THREE.Mesh; idx: number }[] = []

  /** Clear everything. Called before re-discovery (character swap or
   *  user editing the rig-compatibility candidate lists). */
  reset(): void {
    this.eyeL = this.eyeR = this.headBone = this.jawBone = null
    this.eyeRestL = this.eyeRestR = this.headRest = this.jawRest = null
    this.lipTargets.length = 0
    this.blinkTargets.length = 0
  }

  /** Find eye/head/jaw bones via the candidate name lists and capture
   *  their rest-pose local quaternions. */
  discoverBones(character: THREE.Object3D, candidates: BodyEyeBoneCandidates): void {
    const findBone = (names: string[] | undefined): THREE.Bone | null => {
      if (!names) return null
      let hit: THREE.Bone | null = null
      character.traverse((o) => {
        if (hit) return
        if ((o as THREE.Bone).isBone && names.includes(o.name)) {
          hit = o as THREE.Bone
        }
      })
      return hit
    }
    this.eyeL = findBone(candidates.left)
    this.eyeR = findBone(candidates.right)
    this.headBone = findBone(candidates.head)
    this.jawBone = findBone(candidates.jaw)
    if (this.eyeL) this.eyeRestL = this.eyeL.quaternion.clone()
    if (this.eyeR) this.eyeRestR = this.eyeR.quaternion.clone()
    if (this.headBone) this.headRest = this.headBone.quaternion.clone()
    if (this.jawBone) this.jawRest = this.jawBone.quaternion.clone()
  }

  /** Find the first jaw-morph hit per mesh and ALL blink-morph hits
   *  across the character. */
  discoverMorphs(
    character: THREE.Object3D,
    jawMorphCandidates: string[],
    blinkMorphNames: string[],
  ): void {
    character.traverse((o) => {
      const mesh = o as THREE.Mesh
      const dict = mesh.morphTargetDictionary
      if (!dict) return
      for (const name of jawMorphCandidates) {
        if (name in dict) {
          this.lipTargets.push({ mesh, idx: dict[name] })
          break
        }
      }
      for (const name of blinkMorphNames) {
        if (name in dict) this.blinkTargets.push({ mesh, idx: dict[name] })
      }
    })
  }
}
