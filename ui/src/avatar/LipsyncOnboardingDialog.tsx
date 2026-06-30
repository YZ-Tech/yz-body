import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'

const ONBOARD_KEY = 'yzBodyLipsyncOnboarded'

interface ModelStatus {
  available?: boolean
  downloading?: boolean
  downloaded_mb?: number
  total_mb?: number
  download_error?: string | null
}

type Phase = 'offer' | 'downloading' | 'error'

/** First-run lipsync nudge (v13 only). When the NeuroSync model isn't installed
 *  AND the user hasn't chosen yet, auto-open a positively-framed offer to enrich
 *  the avatar with phoneme-accurate lipsync. Either choice is remembered in
 *  localStorage so the dialog never reappears.
 *
 *  On "Download NeuroSync" the dialog does NOT close — it switches to a live
 *  progress bar (polling the satellite model endpoint, the same one Behavior →
 *  Speech uses) and only closes once the weights have landed. A failed download
 *  shows the error with Retry / Keep Amplitude so the modal can't get stuck.
 *
 *  Mounted by BodyDashboard inside the theme/context providers, so it inherits
 *  the host MUI theme and only ever shows for the v13 dashboard. */
export function LipsyncOnboardingDialog() {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('offer')
  const [busy, setBusy] = useState(false)
  const [model, setModel] = useState<ModelStatus | null>(null)
  const pollRef = useRef<number | null>(null)

  // Decide whether to prompt: only when the model is genuinely absent and the
  // user hasn't chosen. One retry covers the satellite still spawning on the
  // very first v13 mount; then we give up silently for this session.
  useEffect(() => {
    if (localStorage.getItem(ONBOARD_KEY) === '1') return
    let cancelled = false
    const check = async (attempt = 0): Promise<void> => {
      try {
        const r = await fetch('/api/body/lipsync/model')
        if (!r.ok) throw new Error(String(r.status))
        const d = (await r.json()) as ModelStatus
        if (!cancelled && d && d.available === false) setOpen(true)
      } catch {
        if (attempt === 0 && !cancelled) window.setTimeout(() => void check(1), 2500)
      }
    }
    void check()
    return () => { cancelled = true }
  }, [])

  const stopPoll = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }
  useEffect(() => stopPoll, [])

  const remember = () => localStorage.setItem(ONBOARD_KEY, '1')

  // Tell other lipsync consumers (Behavior → Speech's LipsyncEngineRows) that
  // the engine or model just changed, so they re-fetch instead of showing a
  // stale "Download NeuroSync" chip / wrong engine after this dialog acts.
  const notifyChanged = () => window.dispatchEvent(new CustomEvent('body.lipsyncChanged'))

  const setEngine = (engine: 'amplitude' | 'neurosync') =>
    fetch('/api/satellites/body', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { lipsync_engine: engine } }),
    })

  const keepAmplitude = async () => {
    setBusy(true)
    try { await setEngine('amplitude') } catch { /* amplitude is the default anyway */ }
    remember()
    stopPoll()
    setBusy(false)
    notifyChanged()
    setOpen(false)
  }

  // Poll the model endpoint while a download is in flight; close on success,
  // surface the error otherwise. Same endpoint Behavior → Speech polls.
  const pollUntilReady = () => {
    stopPoll()
    const tick = async () => {
      try {
        const r = await fetch('/api/body/lipsync/model')
        const d = (await r.json()) as ModelStatus
        setModel(d)
        if (d.available) {
          stopPoll()
          remember()
          notifyChanged()
          setOpen(false)
        } else if (d.download_error) {
          stopPoll()
          setPhase('error')
        }
      } catch {
        /* transient — keep polling */
      }
    }
    void tick() // immediate, so a fast download doesn't wait a full interval
    pollRef.current = window.setInterval(() => void tick(), 1000)
  }

  const startDownload = async () => {
    setBusy(true)
    setModel(null)
    setPhase('downloading')
    try {
      // Kick off the background download and pre-select neurosync so the avatar
      // switches to real visemes automatically the moment the weights land.
      await fetch('/api/body/lipsync/install', { method: 'POST' })
      await setEngine('neurosync')
      pollUntilReady()
    } catch {
      setPhase('error')
      setModel({ download_error: 'Could not start the download. Check the connection and retry.' })
    } finally {
      setBusy(false)
    }
  }

  const pct =
    model?.total_mb && model.total_mb > 0
      ? Math.min(100, Math.round((100 * (model.downloaded_mb ?? 0)) / model.total_mb))
      : null

  // No onClose during offer/downloading: the choice is deliberate and the
  // download must run to completion. The error phase always offers a way out.
  return (
    <Dialog open={open} maxWidth="xs" fullWidth>
      <DialogTitle>Bring your avatar's face to life</DialogTitle>

      {phase === 'offer' && (
        <>
          <DialogContent>
            <DialogContentText component="div">
              Your avatar can move its full mouth with lifelike, phoneme-accurate
              lipsync. Download the NeuroSync model (~1&nbsp;GB, one-time) to
              enrich the experience — or keep the lightweight amplitude lipsync,
              where the jaw follows the voice.
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mt: 1.5 }}
              >
                You can change this anytime in Behavior → Speech.
              </Typography>
            </DialogContentText>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => void keepAmplitude()} disabled={busy} color="inherit">
              Keep Amplitude
            </Button>
            <Button onClick={() => void startDownload()} disabled={busy} variant="contained">
              Download NeuroSync
            </Button>
          </DialogActions>
        </>
      )}

      {phase === 'downloading' && (
        <DialogContent>
          <DialogContentText component="div" sx={{ mb: 2 }}>
            Downloading the NeuroSync model — this is a one-time setup. The avatar
            switches to lifelike lipsync automatically when it finishes.
          </DialogContentText>
          <LinearProgress
            variant={pct === null ? 'indeterminate' : 'determinate'}
            value={pct ?? undefined}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {pct === null
              ? 'Starting…'
              : `${model?.downloaded_mb ?? 0} / ${model?.total_mb} MB (${pct}%)`}
          </Typography>
        </DialogContent>
      )}

      {phase === 'error' && (
        <>
          <DialogContent>
            <DialogContentText component="div">
              <Typography color="error.main" variant="body2">
                {model?.download_error || 'The download did not complete.'}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                You can retry, or keep amplitude lipsync for now and download later
                in Behavior → Speech.
              </Typography>
            </DialogContentText>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => void keepAmplitude()} disabled={busy} color="inherit">
              Keep Amplitude
            </Button>
            <Button onClick={() => void startDownload()} disabled={busy} variant="contained">
              Retry
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}
