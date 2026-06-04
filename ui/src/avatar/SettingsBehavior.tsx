import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import {
  Autocomplete,
  Box,
  Chip,
  Collapse,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useBodyBehavior } from '../hooks/useBodyBehavior'
import { useBodyFlags } from '../hooks/useBodyFlags'
import { useStore } from '../store'
import { IconBtn } from '../components/IconBtn'
import { SettingsRow } from '../components/SettingsRow'
import { SettingsSection } from '../components/SettingsSection'
import {
  DEFAULT_Body_BEHAVIOR,
  type BodyEyeBoneCandidates,
} from '../lib/body/behavior'

/** Behavior settings — boolean toggles + per-character feel sliders +
 *  rig-compatibility candidate lists. All sliders + lists default to
 *  the shared DEFAULT_Body_BEHAVIOR; user overrides are stored
 *  per-source-character in bodyBehavior. */

export function BodySettingsBehavior() {
  const [flags, updateFlags] = useBodyFlags()
  const behavior = useBodyBehavior(flags.characterFile)
  const eff = behavior.effective
  const bodyBones = useStore((s) => s.bodyBones)
  const bodyMorphs = useStore((s) => s.bodyMorphs)
  const [rigOpen, setRigOpen] = useState(false)

  // Convenience wrappers — patch a single field or merge an
  // eyeBoneCandidates sub-key. Keeps the JSX terse.
  const patch = behavior.setBehavior
  const patchEye = (k: keyof BodyEyeBoneCandidates, v: string[]) =>
    patch({ eyeBoneCandidates: { ...eff.eyeBoneCandidates, [k]: v } })

  return (
    <SettingsSection id="behavior" group="body" label="Behavior">
      <Stack spacing={2}>
        {/* ── Boolean toggles ─────────────────────────────────────── */}
        <Stack spacing={0.5}>
          <SettingsRow
            title="Eye / cursor tracking + saccades"
            info="When on, the eyes (or head, if eye bones are missing) track your cursor with subtle saccade jitter. Off = eyes stay forward."
          >
            <Switch
              size="small"
              checked={flags.eyeTracking}
              onChange={(e) => updateFlags({ eyeTracking: e.target.checked })}
            />
          </SettingsRow>
          <SettingsRow
            title="Eye blink"
            info="Random blinks driven by the eyeBlinkLeft / eyeBlinkRight ARKit morphs (or whichever names you've configured below). Off = mannequin stare."
          >
            <Switch
              size="small"
              checked={flags.eyeBlink}
              onChange={(e) => updateFlags({ eyeBlink: e.target.checked })}
            />
          </SettingsRow>
        </Stack>

        {/* ── Eyes feel knobs ─────────────────────────────────────── */}
        <GroupHeader label="Eyes" onReset={() => behavior.resetGroup('feel')} />
        <Stack spacing={0.5}>
          <SliderRow
            label="Blink interval min"
            info="Shortest pause between blinks (ms). Lower = restless, higher = relaxed."
            value={eff.blinkIntervalMinMs}
            defaultValue={DEFAULT_Body_BEHAVIOR.blinkIntervalMinMs}
            min={500}
            max={5000}
            step={100}
            format={(v) => `${v} ms`}
            onChange={(v) => patch({ blinkIntervalMinMs: v })}
          />
          <SliderRow
            label="Blink interval max"
            info="Longest pause between blinks (ms). The actual interval is randomized between min and max."
            value={eff.blinkIntervalMaxMs}
            defaultValue={DEFAULT_Body_BEHAVIOR.blinkIntervalMaxMs}
            min={1000}
            max={10000}
            step={100}
            format={(v) => `${v} ms`}
            onChange={(v) => patch({ blinkIntervalMaxMs: v })}
          />
          <SliderRow
            label="Saccade intensity"
            info="Micro-jitter amplitude on the gaze target. 0 = no jitter, 0.3 = noticeably twitchy."
            value={eff.saccadeAmplitude}
            defaultValue={DEFAULT_Body_BEHAVIOR.saccadeAmplitude}
            min={0}
            max={0.3}
            step={0.01}
            format={(v) => v.toFixed(2)}
            onChange={(v) => patch({ saccadeAmplitude: v })}
          />
        </Stack>

        {/* ── Speech feel knobs ───────────────────────────────────── */}
        <GroupHeader label="Speech" onReset={() => behavior.resetGroup('feel')} />
        <Stack spacing={0.5}>
          <SliderRow
            label="Lipsync gain"
            info="How sensitive the mouth-open morph is to TTS RMS. Higher = more exaggerated mouth movement."
            value={eff.lipsyncGain}
            defaultValue={DEFAULT_Body_BEHAVIOR.lipsyncGain}
            min={0.5}
            max={5}
            step={0.1}
            format={(v) => `${v.toFixed(1)}×`}
            onChange={(v) => patch({ lipsyncGain: v })}
          />
          <SliderRow
            label="Lipsync max"
            info="Cap on the morph weight so peaks don't pop the jaw wide open."
            value={eff.lipsyncMax}
            defaultValue={DEFAULT_Body_BEHAVIOR.lipsyncMax}
            min={0.3}
            max={1}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={(v) => patch({ lipsyncMax: v })}
          />
        </Stack>

        {/* ── Animation feel knobs ────────────────────────────────── */}
        <GroupHeader label="Animation" onReset={() => behavior.resetGroup('feel')} />
        <Stack spacing={0.5}>
          <SliderRow
            label="Clip re-pick interval"
            info="Seconds between mode-pool re-shuffles. Lower = restless, higher = stoic."
            value={eff.repickAfterS}
            defaultValue={DEFAULT_Body_BEHAVIOR.repickAfterS}
            min={3}
            max={30}
            step={1}
            format={(v) => `${v}s`}
            onChange={(v) => patch({ repickAfterS: v })}
          />
          <SliderRow
            label="Crossfade duration"
            info="Seconds spent blending between clips. Lower = snappy, higher = smooth."
            value={eff.crossfadeS}
            defaultValue={DEFAULT_Body_BEHAVIOR.crossfadeS}
            min={0.1}
            max={1.5}
            step={0.05}
            format={(v) => `${v.toFixed(2)}s`}
            onChange={(v) => patch({ crossfadeS: v })}
          />
        </Stack>

        {/* ── Rig compatibility (collapsed by default) ────────────── */}
        <Box>
          <Stack
            direction="row"
            sx={{ alignItems: 'center', gap: 1, cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setRigOpen((v) => !v)}
          >
            {rigOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            <Typography
              variant="overline"
              sx={{ flex: 1, color: 'text.secondary', letterSpacing: 0.6 }}
            >
              Rig compatibility (Advanced)
            </Typography>
            <IconBtn
              label="Reset rig-compatibility lists to defaults"
              onClick={(e) => {
                e.stopPropagation()
                behavior.resetGroup('rig')
              }}
              icon={<RestartAltIcon />}
            />
          </Stack>
          <Collapse in={rigOpen}>
            <Box sx={{ mt: 1 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mb: 1.5 }}
              >
                When a new model uses non-standard bone or morph names, add them here. Existing
                defaults stay; your additions are merged in. The character re-binds live — no
                reload needed.
              </Typography>
              <Stack spacing={1.5}>
                <CandidateAutocomplete
                  label="Left eye bone"
                  options={bodyBones}
                  value={eff.eyeBoneCandidates.left}
                  onChange={(v) => patchEye('left', v)}
                />
                <CandidateAutocomplete
                  label="Right eye bone"
                  options={bodyBones}
                  value={eff.eyeBoneCandidates.right}
                  onChange={(v) => patchEye('right', v)}
                />
                <CandidateAutocomplete
                  label="Head bone"
                  options={bodyBones}
                  value={eff.eyeBoneCandidates.head}
                  onChange={(v) => patchEye('head', v)}
                />
                <CandidateAutocomplete
                  label="Jaw bone"
                  options={bodyBones}
                  value={eff.eyeBoneCandidates.jaw}
                  onChange={(v) => patchEye('jaw', v)}
                />
                <CandidateAutocomplete
                  label="Blink morphs"
                  options={bodyMorphs}
                  value={eff.blinkMorphNames}
                  onChange={(v) => patch({ blinkMorphNames: v })}
                />
                <CandidateAutocomplete
                  label="Jaw / mouth-open morphs"
                  options={bodyMorphs}
                  value={eff.jawMorphCandidates}
                  onChange={(v) => patch({ jawMorphCandidates: v })}
                />
              </Stack>
            </Box>
          </Collapse>
        </Box>
      </Stack>
    </SettingsSection>
  )
}

function GroupHeader({ label, onReset }: { label: string; onReset: () => void }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
      <Typography variant="overline" sx={{ flex: 1, color: 'text.secondary', letterSpacing: 0.6 }}>
        {label}
      </Typography>
      <IconBtn
        label={`Reset ${label.toLowerCase()} (and other feel-knob groups) to defaults`}
        onClick={onReset}
        icon={<RestartAltIcon />}
      />
    </Stack>
  )
}

interface SliderRowProps {
  label: string
  info: string
  value: number
  defaultValue: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}

function SliderRow({
  label,
  info,
  value,
  defaultValue,
  min,
  max,
  step,
  format,
  onChange,
}: SliderRowProps) {
  const isDefault = value === defaultValue
  return (
    <SettingsRow
      title={
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }} component="span">
          <span>{label}</span>
          <Typography
            variant="caption"
            sx={{
              fontFamily: 'ui-monospace, monospace',
              color: isDefault ? 'text.disabled' : 'primary.main',
            }}
          >
            {format(value)}
          </Typography>
        </Stack>
      }
      info={info}
    >
      <Slider
        size="small"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(_, v) => onChange(Array.isArray(v) ? v[0] : v)}
        sx={{ width: 140 }}
      />
    </SettingsRow>
  )
}

function CandidateAutocomplete({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: string[]
  value: string[]
  onChange: (v: string[]) => void
}) {
  return (
    <Autocomplete
      multiple
      freeSolo
      size="small"
      options={options}
      value={value}
      onChange={(_, v) => onChange(v as string[])}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={options.length > 0 ? 'Pick from model or type' : 'Type a name'}
        />
      )}
      renderValue={(items, getItemProps) =>
        items.map((option, index) => {
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
    />
  )
}
