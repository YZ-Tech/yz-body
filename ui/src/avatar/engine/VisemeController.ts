import { AudioBroadcastPlayer } from './AudioBroadcastPlayer'

export interface VisemeTrack {
  id: number
  fps: number
  lo: number
  hi: number
  frames: number[][] // T x (hi-lo+1), ARKit mouth weights for indices lo..hi
}

export interface VisemeFrame {
  lo: number
  hi: number
  weights: Float32Array // one value per ARKit index lo..hi
}

/** Produces the current interpolated ARKit mouth weights for the avatar.
 *
 *  Timing: the backend emits `tts_visemes` immediately BEFORE it starts TTS
 *  playback, so the event's arrival ≈ audio start. We anchor a wall-clock at that
 *  moment and index the track by elapsed wall-time — independent of the broadcast
 *  audio, which the backend only sends AFTER local playback finishes (so clocking
 *  off it would put the mouth a whole utterance late). A small `leadSec` trims the
 *  residual offset (WS latency + sounddevice output latency) by ear.
 *
 *  The AudioBroadcastPlayer is kept only for the optional "play audio here"
 *  (remote viewing) — it does NOT drive the lipsync clock. */
export class VisemeController {
  readonly player = new AudioBroadcastPlayer()
  private active: VisemeTrack | null = null
  private anchorMs = 0
  private out = new Float32Array(0)
  // Trim residual sync (ms→s). Negative = delay the mouth (it's leading the
  // voice), positive = advance it. Default 0; user tunes via the Lipsync slider.
  private leadSec = 0

  start(audioUrl: string): void { this.player.start(audioUrl) }
  setMuted(m: boolean): void { this.player.setMuted(m) }
  setLeadMs(ms: number): void { this.leadSec = ms / 1000 }
  dispose(): void { this.player.dispose() }

  onTrack(t: VisemeTrack): void {
    if (!t || !Array.isArray(t.frames) || t.frames.length === 0) return
    this.active = t
    this.anchorMs = performance.now() // ≈ TTS playback start
  }

  currentFrame(): VisemeFrame | null {
    const tr = this.active
    if (!tr) return null
    const elapsed = (performance.now() - this.anchorMs) / 1000
    const f = (elapsed + this.leadSec) * tr.fps
    if (f < 0) return null
    const i0 = Math.floor(f)
    if (i0 >= tr.frames.length) {
      this.active = null // utterance finished — release the mouth to neutral
      return null
    }
    const i1 = Math.min(i0 + 1, tr.frames.length - 1)
    const a = f - i0
    const fr0 = tr.frames[i0]
    const fr1 = tr.frames[i1]
    const n = fr0.length
    if (this.out.length !== n) this.out = new Float32Array(n)
    for (let k = 0; k < n; k++) this.out[k] = fr0[k] + (fr1[k] - fr0[k]) * a
    return { lo: tr.lo, hi: tr.hi, weights: this.out }
  }
}
