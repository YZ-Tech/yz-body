/** Per-character behavior overrides for BodyAvatar — split into two
 *  flavors:
 *
 *  - "Feel" knobs (blink interval, lipsync gain, etc.) — the user
 *    tunes these to make a character feel more/less alive.
 *  - "Rig compatibility" candidate lists (eye bone names, blink morph
 *    names, jaw morph names) — additive overrides that let the user
 *    teach the avatar new bone/morph naming conventions when a model
 *    ships with non-standard names (no source-code edit required).
 *
 *  All fields are optional; `effectiveBehavior(override)` merges with
 *  defaults at the boundary. Defaults live here so a missing override
 *  always falls back to the same baseline. */

export interface BodyEyeBoneCandidates {
  left?: string[]
  right?: string[]
  head?: string[]
  jaw?: string[]
}

export interface BodyBehavior {
  // ── Feel sliders ───────────────────────────────────────────────
  blinkIntervalMinMs?: number
  blinkIntervalMaxMs?: number
  saccadeAmplitude?: number
  lipsyncGain?: number
  lipsyncMax?: number
  repickAfterS?: number
  crossfadeS?: number
  // ── Rig compatibility ──────────────────────────────────────────
  eyeBoneCandidates?: BodyEyeBoneCandidates
  blinkMorphNames?: string[]
  jawMorphCandidates?: string[]
}

export const DEFAULT_Body_BEHAVIOR = {
  blinkIntervalMinMs: 2200,
  blinkIntervalMaxMs: 6000,
  saccadeAmplitude: 0.12,
  lipsyncGain: 2.5,
  lipsyncMax: 0.85,
  repickAfterS: 8,
  crossfadeS: 0.45,
  eyeBoneCandidates: {
    left:  ['LeftEye', 'mixamorigLeftEye', 'mixamorigLeye', 'lefteye', 'Eye.L', 'eye_L'],
    right: ['RightEye', 'mixamorigRightEye', 'mixamorigReye', 'righteye', 'Eye.R', 'eye_R'],
    head:  ['Head', 'mixamorigHead', 'head'],
    jaw:   ['Jaw', 'mixamorigJaw', 'jaw', 'Jaw.M'],
  },
  blinkMorphNames: ['eyeBlinkLeft', 'eyeBlinkRight'],
  jawMorphCandidates: [
    'jawOpen', 'JawOpen', 'jaw_open',
    'mouthOpen', 'MouthOpen', 'mouth_open',
    'viseme_aa', 'viseme_AA', 'viseme_A',
  ],
} as const

/** Fully-resolved behavior — every field guaranteed present. The render
 *  loop reads from this shape so it never has to fall back inline. */
export interface BodyBehaviorEffective {
  blinkIntervalMinMs: number
  blinkIntervalMaxMs: number
  saccadeAmplitude: number
  lipsyncGain: number
  lipsyncMax: number
  repickAfterS: number
  crossfadeS: number
  eyeBoneCandidates: {
    left: string[]
    right: string[]
    head: string[]
    jaw: string[]
  }
  blinkMorphNames: string[]
  jawMorphCandidates: string[]
}

/** Merge an optional per-character override on top of the defaults. */
export function effectiveBehavior(override?: BodyBehavior | null): BodyBehaviorEffective {
  const o = override ?? {}
  return {
    blinkIntervalMinMs: o.blinkIntervalMinMs ?? DEFAULT_Body_BEHAVIOR.blinkIntervalMinMs,
    blinkIntervalMaxMs: o.blinkIntervalMaxMs ?? DEFAULT_Body_BEHAVIOR.blinkIntervalMaxMs,
    saccadeAmplitude: o.saccadeAmplitude ?? DEFAULT_Body_BEHAVIOR.saccadeAmplitude,
    lipsyncGain: o.lipsyncGain ?? DEFAULT_Body_BEHAVIOR.lipsyncGain,
    lipsyncMax: o.lipsyncMax ?? DEFAULT_Body_BEHAVIOR.lipsyncMax,
    repickAfterS: o.repickAfterS ?? DEFAULT_Body_BEHAVIOR.repickAfterS,
    crossfadeS: o.crossfadeS ?? DEFAULT_Body_BEHAVIOR.crossfadeS,
    eyeBoneCandidates: {
      left:  o.eyeBoneCandidates?.left  ?? [...DEFAULT_Body_BEHAVIOR.eyeBoneCandidates.left],
      right: o.eyeBoneCandidates?.right ?? [...DEFAULT_Body_BEHAVIOR.eyeBoneCandidates.right],
      head:  o.eyeBoneCandidates?.head  ?? [...DEFAULT_Body_BEHAVIOR.eyeBoneCandidates.head],
      jaw:   o.eyeBoneCandidates?.jaw   ?? [...DEFAULT_Body_BEHAVIOR.eyeBoneCandidates.jaw],
    },
    blinkMorphNames: o.blinkMorphNames ?? [...DEFAULT_Body_BEHAVIOR.blinkMorphNames],
    jawMorphCandidates: o.jawMorphCandidates ?? [...DEFAULT_Body_BEHAVIOR.jawMorphCandidates],
  }
}
