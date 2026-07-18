import { apiUrl } from '../lib/assetBase'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import GraphicEqIcon from '@mui/icons-material/GraphicEq'
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import {
  Autocomplete,
  Box,
  Checkbox,
  Chip,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { Fragment, useMemo, useState } from 'react'
import { useBodyCharacterMeta } from '../hooks/useBodyCharacterMeta'
import { useBodyClipBeats } from '../hooks/useBodyClipBeats'
import { useBodyClipGenders, type BodyGender } from '../hooks/useBodyClipGenders'
import { useBodyClipPools, type BodyMode } from '../hooks/useBodyClipPools'
import { useBodyClips } from '../hooks/useBodyClips'
import {
  sourceRigFor,
  targetRigFor,
} from './engine/rigRemap'
import { useBodyClipTags } from '../hooks/useBodyClipTags'
import { useBodyFlags } from '../hooks/useBodyFlags'
import { MODES } from '../lib/body/modes'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { IconBtn } from '../components/IconBtn'
import { SettingsSection } from '../components/SettingsSection'
import { useStore } from '../store'

export function BodySettingsClips({
  onPreview,
}: {
  onPreview: (clip: string) => void
}) {
  const currentClip = useStore((s) => s.bodyCurrentClip)
  const [flags] = useBodyFlags()
  const charMetaApi = useBodyCharacterMeta()
  const activeCharGender = charMetaApi.genderOf(flags.characterFile)
  const [pools, updatePool] = useBodyClipPools(flags.characterFile, activeCharGender)
  const clipsApi = useBodyClips()
  const tagsApi = useBodyClipTags()
  const beatsApi = useBodyClipBeats()
  const gendersApi = useBodyClipGenders()

  const [tagMode, setTagMode] = useState(false)
  const [beatMode, setBeatMode] = useState(false)
  const [clipFilterText, setClipFilterText] = useState('')
  const [clipFilterTags, setClipFilterTags] = useState<string[]>([])
  // Clip path pending trash confirmation (themed ConfirmDialog at the
  // section root, not window.confirm).
  const [confirmTrash, setConfirmTrash] = useState<string | null>(null)

  // Active character's rig — used to filter the clip list per the
  // STRICT-LINE POLICY (rigRemap.ts): each character only plays clips
  // authored for its own rig. BotM/BotF (Quaternius) see UAL clips,
  // Loom/Yeon (Mixamo) see private/ clips. Cross-rig clips silently
  // no-op at the mixer, so showing them in the picker is misleading.
  const activeCharRig = useMemo(
    () => targetRigFor(flags.characterFile),
    [flags.characterFile],
  )

  // Group clips by parent folder; "Ungrouped" (root-level) last.
  const grouped = useMemo(() => {
    const text = clipFilterText.trim().toLowerCase()
    const tags = clipFilterTags.map((t) => t.toLowerCase())
    const byGroup = new Map<string, { path: string; file: string }[]>()
    for (const c of clipsApi.clips) {
      // Rig-compatibility filter: only show clips whose source rig
      // matches the active character's rig.
      if (sourceRigFor(c.path) !== activeCharRig) continue
      if (text && !c.path.toLowerCase().includes(text)) continue
      if (tags.length > 0) {
        const clipTags = (tagsApi.tags[c.path] || []).map((t) => t.toLowerCase())
        if (!tags.every((t) => clipTags.includes(t))) continue
      }
      const arr = byGroup.get(c.group) ?? []
      arr.push({ path: c.path, file: c.file })
      byGroup.set(c.group, arr)
    }
    const sorted = Array.from(byGroup.entries())
      .sort(([a], [b]) => {
        if (a === 'Ungrouped') return 1
        if (b === 'Ungrouped') return -1
        return a.localeCompare(b)
      })
      .map(([name, items]) => ({ name, items }))
    return sorted
  }, [clipsApi.clips, clipFilterText, clipFilterTags, tagsApi.tags, activeCharRig])

  const toggle = (mode: BodyMode, clip: string) => {
    const current = pools[mode] ?? []
    const next = current.includes(clip) ? current.filter((c) => c !== clip) : [...current, clip]
    updatePool(mode, next)
  }

  return (
    <SettingsSection
      id="pools"
      group="body"
      label={
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }} component="span">
          <span>Clip pools</span>
          {currentClip && (
            <Chip
              size="small"
              icon={<CheckCircleIcon />}
              label={currentClip}
              sx={{
                height: 18,
                fontSize: 10,
                fontFamily: 'ui-monospace, monospace',
                maxWidth: 260,
                textTransform: 'none',
                letterSpacing: 0,
                fontWeight: 400,
                '& .MuiChip-label': { px: 0.75 },
              }}
            />
          )}
        </Stack>
      }
      rightActions={
        <>
          <IconBtn
            label={tagMode ? 'Exit tag mode' : 'Edit tags per clip'}
            onClick={() => {
              setTagMode((v) => !v)
              if (beatMode) setBeatMode(false)
            }}
            sx={{ color: tagMode ? 'primary.main' : 'inherit' }}
            icon={<LocalOfferOutlinedIcon />}
          />
          <IconBtn
            label={
              beatMode ? 'Exit beat mode' : 'Label motion beats per clip (auto-detected peaks)'
            }
            onClick={() => {
              setBeatMode((v) => !v)
              if (tagMode) setTagMode(false)
            }}
            sx={{ color: beatMode ? 'primary.main' : 'inherit' }}
            icon={<GraphicEqIcon />}
          />
          <IconBtn
            label="Rescan /body/animations/ folder (also re-analyzes beats)"
            onClick={() => {
              void clipsApi.rescan()
              void tagsApi.rescan()
              void beatsApi.rescan()
            }}
            icon={<RestartAltIcon />}
          />
          <IconBtn
            label="Open the animations folder in Explorer"
            onClick={() => {
              void fetch(apiUrl('/clips/open_folder'), { method: 'POST' })
            }}
            icon={<FolderOpenIcon />}
          />
        </>
      }
    >
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
        Tick the clips you want eligible for each mode. The render loop picks randomly from
        the active pool, re-shuffling every few seconds. Clips are grouped by their folder
        under <code>/body/animations/</code>. Trash icon soft-deletes (moves to{' '}
        <code>_trash/</code>) — Rescan or check the folder to undo.
      </Typography>

      <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Filter clips…"
          value={clipFilterText}
          onChange={(e) => setClipFilterText(e.target.value)}
          sx={{ flex: 1, '& .MuiInputBase-input': { fontSize: 12 } }}
        />
        <Autocomplete
          multiple
          size="small"
          options={tagsApi.allTags}
          value={clipFilterTags}
          onChange={(_, v) => setClipFilterTags(v as string[])}
          sx={{
            flex: 2,
            '& .MuiAutocomplete-tag': { height: 18, fontSize: 10 },
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder={clipFilterTags.length ? '' : 'Filter by tag (AND)…'}
              sx={{ '& .MuiInputBase-input': { fontSize: 12 } }}
            />
          )}
        />
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 2 }}>
        {grouped.map((g) => (
          <Box key={g.name}>
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                color: 'text.secondary',
                mb: 0.5,
              }}
            >
              {g.name}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                // [play] [clip-name] [5 mode checkboxes] [trash]
                gridTemplateColumns: '28px 1fr repeat(5, 28px) 28px',
                alignItems: 'center',
                rowGap: 0.25,
                columnGap: 0.25,
                fontSize: 13,
              }}
            >
              {/* Column header — first group only (lazy but fine). */}
              {g === grouped[0] && (
                <>
                  <Box />
                  <Box />
                  {MODES.map((m) => (
                    <Tooltip key={m.key} title={m.desc} arrow>
                      <Typography
                        variant="caption"
                        sx={{
                          textAlign: 'center',
                          color: 'text.secondary',
                          fontSize: 10,
                        }}
                      >
                        {m.label.slice(0, 4)}
                      </Typography>
                    </Tooltip>
                  ))}
                  <Box />
                </>
              )}

              {g.items.map(({ path, file }) => {
                // currentClip may be bare filename (legacy) or
                // full path — match either so the playing
                // highlight survives the format transition.
                const isCurrent = currentClip === path || currentClip === file
                const clipGender = gendersApi.genders[path] ?? 'neutral'
                const wrongGender =
                  !!activeCharGender &&
                  clipGender !== 'neutral' &&
                  clipGender !== activeCharGender
                const dimSx = wrongGender ? { opacity: 0.4 } : undefined
                return (
                  <Fragment key={path}>
                    <IconBtn
                      label={`Preview ${path}`}
                      onClick={() => onPreview(path)}
                      sx={{
                        color: isCurrent ? 'primary.main' : 'text.secondary',
                        ...dimSx,
                      }}
                      icon={<PlayArrowIcon sx={{ fontSize: 16 }} />}
                    />
                    <Typography
                      variant="body2"
                      onClick={() => onPreview(path)}
                      sx={{
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 11.5,
                        color: isCurrent ? 'primary.main' : 'text.primary',
                        fontWeight: isCurrent ? 600 : 400,
                        cursor: 'pointer',
                        userSelect: 'none',
                        '&:hover': { color: 'primary.main' },
                        ...dimSx,
                      }}
                      title={
                        wrongGender
                          ? `${path}  —  wrong gender (${clipGender}); excluded from random pool picks unless you re-tag it.`
                          : path
                      }
                    >
                      {file}
                      {clipGender !== 'neutral' && (
                        <Typography
                          component="span"
                          variant="caption"
                          sx={{
                            ml: 0.5,
                            fontSize: 10,
                            color: 'text.secondary',
                          }}
                        >
                          {clipGender === 'female' ? '♀' : '♂'}
                        </Typography>
                      )}
                    </Typography>
                    {MODES.map((m) => (
                      <Box key={m.key} sx={{ textAlign: 'center', ...dimSx }}>
                        <Checkbox
                          size="small"
                          checked={(pools[m.key] ?? []).includes(path)}
                          onChange={() => toggle(m.key, path)}
                          sx={{ p: 0.25 }}
                        />
                      </Box>
                    ))}
                    <IconBtn
                      label={`Move ${path} to _trash/`}
                      onClick={() => setConfirmTrash(path)}
                      sx={{
                        color: 'text.secondary',
                        '&:hover': { color: 'error.main' },
                      }}
                      icon={<DeleteOutlineIcon sx={{ fontSize: 16 }} />}
                    />
                    {(() => {
                      const entry = beatsApi.beats[path]
                      if (!entry || !entry.peaks?.length) return null
                      // Intensity-rank so canonical names align
                      // with the LLM catalog block's ordering.
                      const ranked = [...entry.peaks]
                        .sort((a, b) => b.intensity - a.intensity)
                        .slice(0, 3)
                        .map((p, rank) => ({
                          ...p,
                          canonical: rank === 0 ? 'peak' : `peak${rank + 1}`,
                          key: p.t.toFixed(2),
                          label: entry.labels?.[p.t.toFixed(2)] || '',
                        }))
                      const hasLabels = ranked.some((p) => !!p.label)
                      if (!beatMode && !hasLabels) return null
                      return (
                        <Box
                          sx={{
                            gridColumn: '2 / -1',
                            pb: 0.5,
                            pl: 0.25,
                          }}
                        >
                          {beatMode ? (
                            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                              {ranked.map((p) => (
                                <Stack
                                  key={p.key}
                                  direction="row"
                                  sx={{
                                    alignItems: 'center',
                                    gap: 0.25,
                                    border: '1px solid',
                                    borderColor: p.label ? 'primary.main' : 'divider',
                                    borderRadius: 1,
                                    px: 0.5,
                                    py: 0.25,
                                  }}
                                >
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      fontSize: 10,
                                      color: 'text.secondary',
                                      fontFamily: 'ui-monospace, monospace',
                                      minWidth: 70,
                                    }}
                                    title={`Top bones: ${p.bones.slice(0, 3).join(', ')}`}
                                  >
                                    {p.canonical}@{p.t.toFixed(2)}s
                                  </Typography>
                                  <TextField
                                    size="small"
                                    variant="standard"
                                    placeholder="label"
                                    defaultValue={p.label}
                                    onBlur={(e) => {
                                      const next = e.target.value.trim().toLowerCase()
                                      if (next === p.label) return
                                      void beatsApi.setLabel(path, p.t, next)
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter')
                                        (e.target as HTMLInputElement).blur()
                                    }}
                                    sx={{
                                      '& .MuiInput-root': {
                                        fontSize: 11,
                                        minWidth: 60,
                                        width: 80,
                                      },
                                    }}
                                  />
                                </Stack>
                              ))}
                            </Stack>
                          ) : (
                            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.25 }}>
                              {ranked
                                .filter((p) => !!p.label)
                                .map((p) => (
                                  <Chip
                                    key={p.key}
                                    label={`${p.label}@${p.t.toFixed(1)}s`}
                                    size="small"
                                    color="primary"
                                    variant="outlined"
                                    sx={{
                                      height: 16,
                                      fontSize: 10,
                                      '& .MuiChip-label': { px: 0.75 },
                                    }}
                                  />
                                ))}
                            </Stack>
                          )}
                        </Box>
                      )
                    })()}
                    {(() => {
                      const clipTags = tagsApi.tags[path] ?? []
                      if (!tagMode && clipTags.length === 0) return null
                      return (
                        <Box
                          sx={{
                            gridColumn: '2 / -1',
                            pb: 0.5,
                            pl: 0.25,
                          }}
                        >
                          {tagMode ? (
                            <>
                              <Stack
                                direction="row"
                                sx={{ alignItems: 'center', gap: 0.5, mb: 0.5 }}
                              >
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{ fontSize: 10 }}
                                >
                                  gender:
                                </Typography>
                                <ToggleButtonGroup
                                  size="small"
                                  exclusive
                                  value={clipGender}
                                  onChange={(_, v: BodyGender | null) => {
                                    if (v) void gendersApi.setGender(path, v)
                                  }}
                                  sx={{
                                    '& .MuiToggleButton-root': {
                                      py: 0,
                                      px: 0.5,
                                      fontSize: 9,
                                      lineHeight: 1.6,
                                      textTransform: 'none',
                                    },
                                  }}
                                >
                                  <ToggleButton value="female">♀</ToggleButton>
                                  <ToggleButton value="male">♂</ToggleButton>
                                  <ToggleButton value="neutral">·</ToggleButton>
                                </ToggleButtonGroup>
                              </Stack>
                              <Autocomplete
                                multiple
                                freeSolo
                                size="small"
                                options={tagsApi.allTags}
                                value={clipTags}
                                onChange={(_, next) => {
                                  const cleaned = (next as string[])
                                    .map((s) => s.trim().toLowerCase())
                                    .filter(Boolean)
                                  void tagsApi.setTags(path, cleaned)
                                }}
                                renderInput={(params) => (
                                  <TextField
                                    {...params}
                                    variant="standard"
                                    placeholder="tags…"
                                    sx={{ '& .MuiInput-root': { fontSize: 12 } }}
                                  />
                                )}
                                sx={{
                                  '& .MuiAutocomplete-tag': {
                                    height: 18,
                                    fontSize: 10,
                                  },
                                }}
                              />
                            </>
                          ) : (
                            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.25 }}>
                              {clipTags.map((t) => (
                                <Chip
                                  key={t}
                                  label={t}
                                  size="small"
                                  sx={{
                                    height: 16,
                                    fontSize: 10,
                                    '& .MuiChip-label': { px: 0.75 },
                                  }}
                                />
                              ))}
                            </Stack>
                          )}
                        </Box>
                      )
                    })()}
                  </Fragment>
                )
              })}
            </Box>
          </Box>
        ))}
      </Box>

      <ConfirmDialog
        open={confirmTrash !== null}
        title="Move clip to trash"
        message={`Move "${confirmTrash}" to trash? The file stays on disk in _trash/ — Rescan to restore.`}
        confirmLabel="Move to trash"
        onConfirm={() => confirmTrash && void clipsApi.trash(confirmTrash)}
        onClose={() => setConfirmTrash(null)}
      />
    </SettingsSection>
  )
}
