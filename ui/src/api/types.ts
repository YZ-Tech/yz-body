// Minimal type surface the body avatar needs from the host's API types.
// Copied (not imported) so the satellite UI bundle is self-contained.
// Kept structurally identical to the host's `frontend/src/api/types.ts`
// definitions so the WLED store events and point-at coords line up.

export interface Point3 {
  x: number
  y: number
  z: number
}

export interface WLEDDevice {
  alias: string
  host: string
  enabled: boolean
  category: string
  /** Optional world-space coord the body avatar points at when this device
   *  is controlled (configured via the click-to-locate dialog on the host's
   *  Devices page). `null` -> no point gesture fires. */
  point_at: Point3 | null
  /** Which avatar hand (if any) mirrors this device's color in its aura when
   *  controlled. "none" | "right" | "left" | "both". */
  aura_hand: 'none' | 'right' | 'left' | 'both'
  state: { on: boolean; bri: number; color: [number, number, number]; fx: number } | null
  reachable: boolean
}
