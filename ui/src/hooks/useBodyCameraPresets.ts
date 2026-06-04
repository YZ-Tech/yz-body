import useStore from '../store/useStore'
import {
  Body_DEFAULT_CAMERA_PRESETS,
  type CameraPreset,
  type BodyCameraPresets,
} from '../store/storeBodyCameraPresets'

/** Compatibility shim — Body camera presets now live in the unified
 *  Zustand store (`ui-persist/storeBodyCameraPresets`). This hook stays
 *  for the existing consumer call sites; new code can subscribe to
 *  `useStore((s) => s.bodyCameraPresets.<key>)` directly for selector
 *  granularity. */

export { Body_DEFAULT_CAMERA_PRESETS, type CameraPreset, type BodyCameraPresets }

export function useBodyCameraPresets(): {
  presets: BodyCameraPresets
  setPreset: (key: keyof BodyCameraPresets, preset: CameraPreset) => void
  reset: () => void
} {
  const presets = useStore((s) => s.bodyCameraPresets)
  const setPreset = useStore((s) => s.setBodyCameraPreset)
  const reset = useStore((s) => s.resetBodyCameraPresets)
  return { presets, setPreset, reset }
}
