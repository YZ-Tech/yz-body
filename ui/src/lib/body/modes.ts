import type { BodyMode } from '../../store/storeBodyPools'

/** UI-facing label + description for each body runtime mode. Used by
 *  BodySettings for the clip-pool grid column headers AND by
 *  OverlayEditor for the driver `whenMode` Select options. */
export const MODES: { key: BodyMode; label: string; desc: string }[] = [
  { key: 'idle', label: 'Idle', desc: 'Plays when waiting — ambient' },
  { key: 'listening', label: 'Listening', desc: "While she's hearing you out" },
  { key: 'thinking', label: 'Thinking', desc: 'During LLM call / tool hop' },
  { key: 'speaking', label: 'Speaking', desc: 'TTS playback in progress' },
  { key: 'boot', label: 'Boot', desc: 'One-shot when body first mounts' },
]
