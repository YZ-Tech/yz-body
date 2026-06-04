/** Appearance customizer — palette + preset constants, plus the
 *  shared types describing per-character customization state.
 *
 *  These ship as `DEFAULT_*` so a future "Palettes" UI section can
 *  layer user overrides on top (same pattern as the rest of the
 *  store): defaults live here, the override map lives in the store,
 *  read selectors merge the two. For now there's no UI editing yet —
 *  BodySettings consumes the DEFAULTS directly. */

// ── Types ─────────────────────────────────────────────────────────
// Re-exported from `store/ui-persist/storeBodyAppearance` so the store
// and the UI module see the same shape. Single canonical home for
// these types is here; the store imports them from this module.

export interface SkinCust {
  preset: string
  tone: number
  color: string | null
}

export interface ColorCust {
  color: string | null
}

export interface AppearanceCust {
  skin?: SkinCust
  top?: ColorCust
  bottom?: ColorCust
  footwear?: ColorCust
  hair?: ColorCust
  iris?: ColorCust
}

// ── Skin presets ──────────────────────────────────────────────────
// Each preset's `color` is what the user SEES on the chip; the
// actual filter math (LAB-shift) lives in tools/texture_filters.py
// keyed by `key`. Adding a new preset here also requires a backend
// entry in that Python module — see the comment on `applyAppearance`
// in BodySettings.

export interface SkinPreset {
  key: string
  label: string
  color: string
}

export const DEFAULT_SKIN_PRESETS: readonly SkinPreset[] = [
  { key: 'fair', label: 'Fair', color: '#F4D1AE' },
  { key: 'light', label: 'Light', color: '#E2B48A' },
  { key: 'medium', label: 'Medium', color: '#C39979' },
  { key: 'olive', label: 'Olive', color: '#9C7B5E' },
  { key: 'brown', label: 'Brown', color: '#6B4A33' },
  { key: 'deep', label: 'Deep', color: '#3D2718' },
] as const

// ── Region palettes ───────────────────────────────────────────────
// Plain sRGB color lists for the quick-pick chips next to each
// per-region custom color input. No backend coupling — pure UI.

export const DEFAULT_CLOTHING_PALETTE: readonly string[] = [
  '#FFFFFF',
  '#222222',
  '#CC2222',
  '#226BCC',
  '#22A555',
  '#CC7700',
  '#FFD700',
  '#8B00FF',
  '#FF1493',
  '#00CED1',
  '#8B4513',
  '#808080',
]

export const DEFAULT_HAIR_PALETTE: readonly string[] = [
  '#0a0a0a',
  '#3d2417',
  '#6e3c1c',
  '#a06820',
  '#e3c084',
  '#cccccc',
  '#f5f5f5',
  '#a52a2a',
  '#ff69b4',
  '#4169e1',
  '#9400d3',
  '#228b22',
]

export const DEFAULT_IRIS_PALETTE: readonly string[] = [
  '#3d2417',
  '#6e3c1c',
  '#2c5f1c',
  '#4169e1',
  '#1e3a5f',
  '#9bb1c4',
  '#e3c084',
  '#a52a2a',
  '#000000',
  '#9400d3',
  '#ffd700',
  '#7ee8fa',
]
