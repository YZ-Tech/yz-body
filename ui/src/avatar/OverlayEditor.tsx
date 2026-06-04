import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined'
import {
  Autocomplete,
  Box,
  Chip,
  Collapse,
  FormControlLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { useOverlay, useOverlayActions } from '../hooks/useBodyOverlays'
import type { BodyMode } from '../hooks/useBodyClipPools'
import { MODES } from '../lib/body/modes'
import type {
  BodyOverlayConfig,
  OverlayDriver,
  OverlayEffect,
} from '../lib/body/bodyOverlays'
import { applyLiveOverlayPatch } from '../lib/body/liveOverlay'
import { IconBtn } from '../components/IconBtn'

/** Per-overlay config card. Header row stays visible; body collapses
 *  when not enabled. Subscribes to its own slice of the store via
 *  useOverlay(id) — a color drag on overlay A only re-renders A's
 *  editor, not its siblings or the parent BodySettings tree. */
export function OverlayEditor({
  id,
  boneOptions,
}: {
  id: string
  /** Suggested bone names for the picker — typically the live character
   *  skeleton (published by BodyAvatar via the storeBodyBones slice).
   *  FreeSolo, so the user can also type custom names not in the list. */
  boneOptions: string[]
}) {
  const cfg = useOverlay(id)
  const { updateOne, remove } = useOverlayActions()
  // Hooks must be declared before any conditional return — keep
  // useState/useRef here even though we early-return on missing cfg.
  const [expanded, setExpanded] = useState(cfg?.enabled ?? false)
  // Drag-commit debouncer used by every high-frequency editor control
  // (color picker + every Slider). The pattern:
  //   1. liveCommit(patch)        → mutate Three.js NOW (zero React)
  //                                  + accumulate pending patch
  //                                  + (re)start the debounce timer.
  //   2. debouncedCommit(patch)   → no Three.js path; debounced
  //                                  store commit only. Used for
  //                                  structural fields like
  //                                  weightThreshold (no per-frame
  //                                  reader; change triggers a mesh
  //                                  rebuild on commit).
  //   3. timer fires after COMMIT_DEBOUNCE_MS of idle → updateOne
  //      once with the accumulated patch.
  // pendingPatchRef accumulates across multiple controls so dragging
  // intensity then color before timer fires commits both atomically.
  const commitTimerRef = useRef<number | null>(null)
  const pendingPatchRef = useRef<Partial<BodyOverlayConfig> | null>(null)
  const flushCommit = (): void => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current)
      commitTimerRef.current = null
    }
    if (pendingPatchRef.current) {
      updateOne(id, pendingPatchRef.current)
      pendingPatchRef.current = null
    }
  }
  useEffect(() => {
    // Flush any pending commit on unmount so the store persists the
    // last value even if the user closes the panel mid-drag.
    return () => {
      flushCommit()
    }
    // flushCommit closes over id + updateOne which are stable for this
    // OverlayEditor instance; safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!cfg) return null
  const COMMIT_DEBOUNCE_MS = 150
  const scheduleCommit = (patch: Partial<BodyOverlayConfig>): void => {
    pendingPatchRef.current = { ...(pendingPatchRef.current ?? {}), ...patch }
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current)
    }
    commitTimerRef.current = window.setTimeout(flushCommit, COMMIT_DEBOUNCE_MS)
  }
  // Live + debounced: mutate Three.js now, commit to store on idle.
  // Use for fields read by the per-frame driver tick / flow shader
  // (baseColor, baseIntensity, flow.*, driver gains).
  const liveCommit = (patch: Partial<BodyOverlayConfig>): void => {
    applyLiveOverlayPatch(id, patch)
    scheduleCommit(patch)
  }
  // Resolve the current pending value for a nested field so multi-
  // field flow drags don't lose siblings. Reads from pendingPatchRef
  // first (latest in-flight values), falls back to store cfg.
  const getEffectiveFlow = (): { period_ms?: number; pulse_width?: number } => {
    const pending = pendingPatchRef.current?.flow as
      | { period_ms?: number; pulse_width?: number }
      | undefined
    return { ...(cfg.flow ?? {}), ...(pending ?? {}) }
  }
  const onChange = (patch: Partial<BodyOverlayConfig>) => updateOne(id, patch)
  const onDelete = () => {
    if (confirm(`Delete overlay "${id}"?`)) remove(id)
  }
  // Hex color string for the native color picker; convert to/from
  // the config's 0..255 RGB tuple on edit.
  const hex = `#${cfg.baseColor.map((v) => v.toString(16).padStart(2, '0')).join('')}`
  const onColor = (val: string) => {
    const clean = val.replace('#', '')
    if (clean.length !== 6) return
    const rgb: [number, number, number] = [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ]
    liveCommit({ baseColor: rgb })
  }
  const driverKind = cfg.driver.kind
  return (
    <Paper variant="outlined" sx={{ p: 1.25, opacity: cfg.enabled ? 1 : 0.6 }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
        <Switch
          size="small"
          checked={cfg.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          sx={{ ml: -0.5 }}
        />
        <Typography
          variant="body2"
          onClick={() => setExpanded((x) => !x)}
          sx={{
            flex: 1,
            fontFamily: 'ui-monospace, monospace',
            fontSize: 12,
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          {cfg.id}
        </Typography>
        <Chip
          size="small"
          label={cfg.effect}
          variant="outlined"
          sx={{ height: 18, fontSize: 10 }}
        />
        <Chip
          size="small"
          label={driverKind}
          color="primary"
          variant="outlined"
          sx={{ height: 18, fontSize: 10 }}
        />
        <Tooltip title="Color">
          <Box
            component="input"
            type="color"
            value={hex}
            onChange={(e) => onColor((e.target as HTMLInputElement).value)}
            sx={{
              width: 22,
              height: 22,
              border: 'none',
              cursor: 'pointer',
              p: 0,
              borderRadius: 0.5,
            }}
          />
        </Tooltip>
        <IconBtn
          label="Delete"
          onClick={onDelete}
          icon={<DeleteOutlineIcon />}
        />
      </Stack>
      <Collapse in={expanded}>
        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
          {/* Include descendants toggle — affects how the bones list
           *  is expanded. ON (default): each named bone + every bone
           *  under it (e.g. RightHand + all 21 finger bones). OFF:
           *  only the literally-named bones — use for Spine2 (chest)
           *  since its descendants are the entire upper body. */}
          <FormControlLabel
            sx={{ ml: -0.5, mt: -0.5 }}
            control={
              <Switch
                size="small"
                checked={cfg.includeChildren !== false}
                onChange={(e) => onChange({ includeChildren: e.target.checked })}
              />
            }
            label={
              <Typography variant="caption">
                Include descendant bones
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 0.5 }}
                >
                  (off for Spine2-only chest, on for hand+fingers)
                </Typography>
              </Typography>
            }
          />
          {/* Bones picker — Autocomplete multi + freeSolo. Options come
           *  from the live skeleton (BodyAvatar writes them via the
           *  storeBodyBones slice on character load); freeSolo lets the
           *  user type custom names not in the list. */}
          <Autocomplete
            multiple
            freeSolo
            size="small"
            options={boneOptions}
            value={cfg.bones}
            onChange={(_, v) => onChange({ bones: v as string[] })}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Bones"
                placeholder="Pick from skeleton or type"
                helperText="e.g. RightHand, or Head + Neck. Descendants auto-included."
              />
            )}
            renderValue={(value, getItemProps) =>
              value.map((option, index) => {
                const { key, ...rest } = getItemProps({ index })
                return (
                  <Chip
                    key={key}
                    size="small"
                    label={option}
                    sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}
                    {...rest}
                  />
                )
              })
            }
            slotProps={{
              chip: { size: 'small' },
            }}
          />
          {/* Effect toggle */}
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Effect
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={cfg.effect}
              onChange={(_, v) => {
                if (v) onChange({ effect: v as OverlayEffect })
              }}
            >
              <ToggleButton value="wireframe">Wireframe</ToggleButton>
              <ToggleButton value="solid">Solid</ToggleButton>
              <ToggleButton value="hologram">Hologram</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          {/* Sliders: weight threshold + base intensity
           *
           *  Both are uncontrolled (defaultValue, no `value` prop) so
           *  MUI manages the thumb position internally during drag —
           *  zero React state churn per tick. Re-keying by cfg.id +
           *  field forces a remount on EXTERNAL changes (reset,
           *  cross-tab sync) so the slider picks up the new value.
           *
           *  weightThreshold IS in shapeKey — every change triggers a
           *  full mesh rebuild in BodyAvatar. So it's debounce-only
           *  (no live path); the rebuild fires once on commit.
           *  baseIntensity is read by the per-frame driver tick, so
           *  it gets the full liveCommit path. */}
          <Stack direction="row" spacing={2}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Weight threshold
              </Typography>
              <Slider
                key={`wt-${id}-${cfg.weightThreshold}`}
                size="small"
                defaultValue={cfg.weightThreshold}
                min={0.1}
                max={0.9}
                step={0.05}
                valueLabelDisplay="auto"
                onChange={(_, v) => scheduleCommit({ weightThreshold: v as number })}
              />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Base intensity
              </Typography>
              <Slider
                key={`bi-${id}-${cfg.baseIntensity}`}
                size="small"
                defaultValue={cfg.baseIntensity}
                min={0}
                max={1}
                step={0.01}
                valueLabelDisplay="auto"
                onChange={(_, v) => liveCommit({ baseIntensity: v as number })}
              />
            </Box>
          </Stack>
          {/* Flow effect — pulses a Gaussian bright spot along the
              chain defined by the Bones field (in array order, treated
              as shoulder → fingertip). Bones list IS the chain — to
              extend to a forearm + arm flow, add RightForeArm and
              RightArm to the Bones field above. */}
          <Box>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
              <FormControlLabel
                sx={{ ml: -0.5, mr: 0, flex: 1 }}
                control={
                  <Switch
                    size="small"
                    checked={!!cfg.flow}
                    onChange={(e) =>
                      onChange({
                        flow: e.target.checked
                          ? {
                              period_ms: cfg.flow?.period_ms ?? 1800,
                              pulse_width: cfg.flow?.pulse_width ?? 0.2,
                            }
                          : undefined,
                      })
                    }
                  />
                }
                label={
                  <Typography variant="caption">
                    Energy flow
                    <Typography
                      component="span"
                      variant="caption"
                      color="text.secondary"
                      sx={{ ml: 0.5 }}
                    >
                      (pulses along the bone chain — order Bones shoulder→fingertip)
                    </Typography>
                  </Typography>
                }
              />
            </Stack>
            {cfg.flow && (
              <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Period
                  </Typography>
                  <Slider
                    key={`flow-period-${id}-${cfg.flow.period_ms ?? 1800}`}
                    size="small"
                    defaultValue={cfg.flow.period_ms ?? 1800}
                    min={300}
                    max={5000}
                    step={50}
                    valueLabelDisplay="auto"
                    valueLabelFormat={(v) => `${v}ms`}
                    onChange={(_, v) =>
                      liveCommit({ flow: { ...getEffectiveFlow(), period_ms: v as number } })
                    }
                  />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Pulse width
                  </Typography>
                  <Slider
                    key={`flow-pw-${id}-${cfg.flow.pulse_width ?? 0.2}`}
                    size="small"
                    defaultValue={cfg.flow.pulse_width ?? 0.2}
                    min={0.05}
                    max={0.5}
                    step={0.01}
                    valueLabelDisplay="auto"
                    onChange={(_, v) =>
                      liveCommit({ flow: { ...getEffectiveFlow(), pulse_width: v as number } })
                    }
                  />
                </Box>
              </Stack>
            )}
          </Box>
          {/* Driver kind + driver-specific args */}
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Driver
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Select
                size="small"
                value={driverKind}
                onChange={(e) => {
                  const kind = e.target.value as OverlayDriver['kind']
                  // Switch driver kind — reset to a sensible default for
                  // the new kind so unused fields don't linger.
                  const next: OverlayDriver =
                    kind === 'wled-hand'
                      ? { kind: 'wled-hand', hand: 'right' }
                      : kind === 'tts-rms'
                        ? { kind: 'tts-rms', gain: 3 }
                        : kind === 'mode-pulse'
                          ? { kind: 'mode-pulse', whenMode: 'thinking', max: 0.55, periodMs: 1400 }
                          : kind === 'mode-on'
                            ? { kind: 'mode-on', whenMode: 'speaking', intensity: 0.6 }
                            : { kind: 'static' }
                  onChange({ driver: next })
                }}
                sx={{ minWidth: 130 }}
              >
                <MenuItem value="static">static</MenuItem>
                <MenuItem value="wled-hand">wled-hand</MenuItem>
                <MenuItem value="tts-rms">tts-rms</MenuItem>
                <MenuItem value="mode-pulse">mode-pulse</MenuItem>
                <MenuItem value="mode-on">mode-on</MenuItem>
              </Select>
              {cfg.driver.kind === 'wled-hand' && (
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={cfg.driver.hand}
                  onChange={(_, v) => {
                    if (v) onChange({ driver: { kind: 'wled-hand', hand: v } })
                  }}
                >
                  <ToggleButton value="right">R</ToggleButton>
                  <ToggleButton value="left">L</ToggleButton>
                  <ToggleButton value="both">R+L</ToggleButton>
                </ToggleButtonGroup>
              )}
              {cfg.driver.kind === 'tts-rms' && (
                <Box sx={{ flex: 1, minWidth: 120 }}>
                  <Typography variant="caption" color="text.secondary">
                    Gain
                  </Typography>
                  <Slider
                    key={`gain-${id}-${cfg.driver.gain ?? 3}`}
                    size="small"
                    defaultValue={cfg.driver.gain ?? 3}
                    min={0.5}
                    max={8}
                    step={0.1}
                    valueLabelDisplay="auto"
                    onChange={(_, v) =>
                      liveCommit({ driver: { kind: 'tts-rms', gain: v as number } })
                    }
                  />
                </Box>
              )}
              {(cfg.driver.kind === 'mode-pulse' || cfg.driver.kind === 'mode-on') && (
                <Select
                  size="small"
                  value={cfg.driver.whenMode}
                  onChange={(e) => {
                    const m = e.target.value as BodyMode
                    if (cfg.driver.kind === 'mode-pulse') {
                      onChange({ driver: { ...cfg.driver, whenMode: m } })
                    } else if (cfg.driver.kind === 'mode-on') {
                      onChange({ driver: { ...cfg.driver, whenMode: m } })
                    }
                  }}
                  sx={{ minWidth: 120 }}
                >
                  {MODES.map((m) => (
                    <MenuItem key={m.key} value={m.key}>
                      {m.label}
                    </MenuItem>
                  ))}
                </Select>
              )}
            </Stack>
          </Box>
        </Stack>
      </Collapse>
    </Paper>
  )
}
