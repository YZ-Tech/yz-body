import { produce } from 'immer'
import type { IStore } from './useStore'

/** Two named camera presets — Home (full-body) and Face (close
 *  portrait). Replaces the standalone useBodyCameraPresets hook.
 *
 *  Left-click on each preset's button in BodyAvatar tweens to it;
 *  right-click overwrites the preset with the user's current view. */

export interface CameraPreset {
  pos: [number, number, number]
  target: [number, number, number]
}

export interface BodyCameraPresets {
  home: CameraPreset
  face: CameraPreset
}

export const Body_DEFAULT_CAMERA_PRESETS: BodyCameraPresets = {
  // Full-body framing — camera back, looking at mid-body. The avatar
  // is at scale 100 (GLB) or scale 1 (FBX, same ~170 unit height),
  // so feet-to-head span is roughly y=0..170 either way.
  home: { pos: [0, 110, 350], target: [0, 90, 0] },
  // Close portrait — eye level, just head + shoulders in frame.
  face: { pos: [0, 165, 110], target: [0, 158, 0] },
}

const LEGACY_KEY = 'body.cameraPresets'

const isVec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number')

const seedFromLegacy = (): BodyCameraPresets => {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return Body_DEFAULT_CAMERA_PRESETS
    const parsed = JSON.parse(raw)
    const merged: BodyCameraPresets = { ...Body_DEFAULT_CAMERA_PRESETS }
    for (const key of ['home', 'face'] as const) {
      const entry = parsed?.[key]
      if (entry && isVec3(entry.pos) && isVec3(entry.target)) merged[key] = entry
    }
    return merged
  } catch {
    return Body_DEFAULT_CAMERA_PRESETS
  }
}

const storeBodyCameraPresets = (set: any) => ({
  bodyCameraPresets: seedFromLegacy(),

  setBodyCameraPreset: (key: keyof BodyCameraPresets, preset: CameraPreset): void =>
    set(
      produce((s: IStore) => {
        s.bodyCameraPresets[key] = preset
      }),
      false,
      'bodyCameraPresets/setOne',
    ),

  resetBodyCameraPresets: (): void =>
    set(
      produce((s: IStore) => {
        s.bodyCameraPresets = Body_DEFAULT_CAMERA_PRESETS
      }),
      false,
      'bodyCameraPresets/reset',
    ),
})

export default storeBodyCameraPresets
