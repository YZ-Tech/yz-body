import { produce } from 'immer'
import type { IStore } from './useStore'

/** Ephemeral Body-avatar UI state. Lives in ui/ (not ui-persist/) since
 *  these are runtime values that should reset on reload:
 *
 *  - `bodyCurrentClip` — the clip name the avatar is currently playing.
 *    Written by Avatar's render loop on every pool pick + motion clip;
 *    read by AvatarStatusPill (bottom-left chip) and BodySettingsClips
 *    (active-clip chip in the section header).
 *  - `bodySettingsOpen` — drawer-style settings panel open/closed.
 *    Toggled by the gear icon in AvatarControls; rendered by BodySettings.
 *  - `bodyStatus` + `bodyErrorMsg` — character-load state for the bottom-
 *    left status pill. Written by Avatar's scene effect during load. */

export type BodyStatus = 'loading' | 'ready' | 'error'

const storeBodyRuntime = (set: any) => ({
  bodyCurrentClip: '',
  bodySettingsOpen: false,
  bodyStatus: 'loading' as BodyStatus,
  bodyErrorMsg: '',

  setBodyCurrentClip: (clip: string): void =>
    set(
      produce((s: IStore) => {
        s.bodyCurrentClip = clip
      }),
      false,
      'bodyRuntime/setCurrentClip',
    ),

  setBodySettingsOpen: (open: boolean): void =>
    set(
      produce((s: IStore) => {
        s.bodySettingsOpen = open
      }),
      false,
      'bodyRuntime/setSettingsOpen',
    ),

  setBodyStatus: (status: BodyStatus): void =>
    set(
      produce((s: IStore) => {
        s.bodyStatus = status
      }),
      false,
      'bodyRuntime/setStatus',
    ),

  setBodyErrorMsg: (msg: string): void =>
    set(
      produce((s: IStore) => {
        s.bodyErrorMsg = msg
      }),
      false,
      'bodyRuntime/setErrorMsg',
    ),
})

export default storeBodyRuntime
