/** Plays JarvYZ's TTS PCM broadcast (`/ws/audio`, 24 kHz mono int16) in the
 *  browser via WebAudio — primarily to provide a sample-accurate playback CLOCK
 *  for neurosync lipsync. Output gain defaults to 0 (silent): a muted source
 *  still advances the AudioContext timeline, so the avatar's mouth syncs to the
 *  audio WITHOUT double-playing it on the same machine. Unmute to actually hear
 *  it (e.g. a remote viewer watching the avatar in a browser).
 *
 *  Utterance boundaries are inferred from scheduler underrun: TTS utterances are
 *  separated by silence (no PCM), so the schedule drains between them; the first
 *  chunk after a drain starts a new utterance and re-anchors the clock to 0. */
export class AudioBroadcastPlayer {
  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  private ws: WebSocket | null = null
  private url = ''
  private sr = 24000
  private nextTime = 0
  private uttStart = 0
  private uttId = 0
  private muted = true
  private disposed = false

  start(url: string): void {
    if (this.ctx || this.disposed) return
    this.url = url
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctor()
    } catch {
      return
    }
    this.gain = this.ctx.createGain()
    this.gain.gain.value = this.muted ? 0 : 1
    this.gain.connect(this.ctx.destination)
    // Browsers start the context suspended until a user gesture; resume now and
    // again on the next interaction so the clock advances.
    void this.ctx.resume()
    const resume = () => { void this.ctx?.resume() }
    window.addEventListener('pointerdown', resume, { once: true })
    this.connect()
  }

  private connect(): void {
    if (this.disposed || !this.url) return
    let ws: WebSocket
    try {
      ws = new WebSocket(this.url)
    } catch {
      return
    }
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    // The /ws/audio endpoint only fans TTS PCM to clients that explicitly ask;
    // without this the socket is open but silent (no clock). Server replies tts_ack.
    ws.onopen = () => { try { ws.send(JSON.stringify({ type: 'subscribe_tts' })) } catch { /* */ } }
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        try {
          const m = JSON.parse(e.data) as { type?: string; sample_rate?: number }
          if (m?.type === 'tts_ack' && m.sample_rate) this.sr = m.sample_rate
        } catch {
          /* ignore non-JSON text */
        }
        return
      }
      this.schedule(e.data as ArrayBuffer)
    }
    ws.onclose = () => {
      this.ws = null
      if (!this.disposed) setTimeout(() => this.connect(), 1500)
    }
    ws.onerror = () => { try { ws.close() } catch { /* */ } }
  }

  private schedule(buf: ArrayBuffer): void {
    const ctx = this.ctx
    const gain = this.gain
    if (!ctx || !gain) return
    const i16 = new Int16Array(buf)
    if (i16.length === 0) return
    const f32 = new Float32Array(i16.length)
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768
    const ab = ctx.createBuffer(1, f32.length, this.sr)
    ab.copyToChannel(f32, 0)
    const src = ctx.createBufferSource()
    src.buffer = ab
    src.connect(gain)
    const lead = 0.06
    let startAt = this.nextTime
    if (startAt < ctx.currentTime + lead) {
      // Schedule drained (silence gap between utterances, or first ever chunk)
      // -> a new utterance begins. Re-anchor the clock so frame 0 lines up.
      startAt = ctx.currentTime + lead
      this.uttStart = startAt
      this.uttId++
    }
    src.start(startAt)
    this.nextTime = startAt + ab.duration
  }

  /** Seconds since the current utterance's first sample began playing, or null
   *  when nothing is playing right now. */
  utteranceElapsed(): number | null {
    const ctx = this.ctx
    if (!ctx) return null
    const t = ctx.currentTime - this.uttStart
    if (t < 0 || ctx.currentTime > this.nextTime + 0.1) return null
    return t
  }

  /** Monotonic id, bumped on each detected utterance start. */
  utteranceId(): number {
    return this.uttId
  }

  setMuted(m: boolean): void {
    this.muted = m
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.02)
    }
  }

  dispose(): void {
    this.disposed = true
    try { this.ws?.close() } catch { /* */ }
    this.ws = null
    try { void this.ctx?.close() } catch { /* */ }
    this.ctx = null
    this.gain = null
  }
}
