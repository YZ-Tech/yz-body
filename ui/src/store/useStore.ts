import { create } from 'zustand'
import { combine, devtools, persist } from 'zustand/middleware'

import storeMode from './storeMode'
import storeWLED from './storeWLED'
import storeAccordions from './storeAccordions'
import storeBodyRuntime from './storeBodyRuntime'
import storeBodyOverlays from './storeBodyOverlays'
import storeBodyFlags from './storeBodyFlags'
import storeBodyPools from './storeBodyPools'
import storeBodyCameraPresets from './storeBodyCameraPresets'
import storeBodyBones from './storeBodyBones'
import storeBodyAppearance from './storeBodyAppearance'
import storeBodyBehavior from './storeBodyBehavior'
import storeBodyPalettes from './storeBodyPalettes'

/** Self-contained Zustand store for the body satellite UI.
 *
 *  Mirrors the host JarvYZ store's middleware stack
 *  (`devtools(persist(combine(...)))`) but composes ONLY the slices the
 *  3D avatar needs: the body UI-persist + runtime slices, plus lean
 *  `mode` and `wled` mirrors that the host feeds over the WS bridge.
 *
 *  The slices are copied verbatim from the host (each `set(producer,
 *  false, 'label')` call relies on the devtools middleware's 3-arg set),
 *  so this composition root must keep devtools in the stack.
 *
 *  Persisted under its OWN storage key (`yz-body-storage`) so it never
 *  collides with the host's `jarvis` key when both run same-origin. */

const useStore = create(
  devtools(
    persist(
      combine(
        {
          _body: true as const,
        },
        (set) => ({
          ...storeMode(set),
          ...storeWLED(set),
          ...storeAccordions(set),
          ...storeBodyRuntime(set),
          ...storeBodyOverlays(set),
          ...storeBodyFlags(set),
          ...storeBodyPools(set),
          ...storeBodyCameraPresets(set),
          ...storeBodyBones(set),
          ...storeBodyAppearance(set),
          ...storeBodyBehavior(set),
          ...storeBodyPalettes(set),
        }),
      ),
      {
        name: 'yz-body-storage',
        // Persist only the UI-persist slices. `mode` + `wled` + runtime
        // are ephemeral / host-fed and re-derived each session.
        partialize: (state) =>
          Object.fromEntries(
            Object.entries(state).filter(([key]) =>
              [
                'overlays',
                'bodyFlags',
                'bodyPools',
                'bodyCameraPresets',
                'bodyBones',
                'bodyAppearance',
                'bodyBehavior',
                'bodyPalettes',
              ].includes(key),
            ),
          ),
      },
    ),
    { name: 'yz-body' },
  ),
)

const _state = useStore.getState()
export type IStore = typeof _state

export default useStore
