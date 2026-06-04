import { apiUrl } from '../lib/assetBase'
import BuildIcon from '@mui/icons-material/Build'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import FolderCopyIcon from '@mui/icons-material/FolderCopy'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import ImageIcon from '@mui/icons-material/Image'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import ViewInArIcon from '@mui/icons-material/ViewInAr'
import {
  Box,
  Button,
  Chip,
  Collapse,
  MenuItem,
  Select,
  Slider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useBodyCharacterMeta } from '../hooks/useBodyCharacterMeta'
import { useBodyCharacters } from '../hooks/useBodyCharacters'
import { useBodyFlags } from '../hooks/useBodyFlags'
import {
  DEFAULT_SKIN_PRESETS as SKIN_PRESETS,
  type AppearanceCust,
} from '../lib/body/appearance'
import { useStore } from '../store'
import { Btn } from '../components/Btn'
import { Colors } from '../components/Colors'
import { IconBtn } from '../components/IconBtn'
import { SettingsRow } from '../components/SettingsRow'
import { SettingsSection } from '../components/SettingsSection'

/** Strip `_custom` so customization state keys off the source
 *  character — Apply switches the dropdown to `<source>_custom.glb`
 *  but the saved settings still belong to `<source>`. */
const sourceCharacterOf = (file: string): string =>
  file.endsWith('_custom.glb') ? file.replace('_custom.glb', '.glb') : file

export function BodySettingsAppearance() {
  const [flags, updateFlags] = useBodyFlags()
  const charactersApi = useBodyCharacters()
  const charMetaApi = useBodyCharacterMeta()
  const activeCharGender = charMetaApi.genderOf(flags.characterFile)
  const characterIsGlb = flags.characterFile.toLowerCase().endsWith('.glb')

  const [textureStatus, setTextureStatus] = useState<{
    msg: string
    error: boolean
  } | null>(null)
  const [extractBusy, setExtractBusy] = useState(false)
  const [repackBusy, setRepackBusy] = useState(false)
  const [toolsExpanded, setToolsExpanded] = useState(false)

  const runExtract = async () => {
    setExtractBusy(true)
    setTextureStatus(null)
    try {
      const res = await fetch(apiUrl('/character/extract'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: flags.characterFile }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`)
      setTextureStatus({
        msg: `Wrote ${data.images.length} textures → ${data.dir}`,
        error: false,
      })
    } catch (e) {
      setTextureStatus({ msg: `Extract failed: ${(e as Error).message}`, error: true })
    } finally {
      setExtractBusy(false)
    }
  }

  const runRepack = async () => {
    setRepackBusy(true)
    setTextureStatus(null)
    try {
      const res = await fetch(apiUrl('/character/repack'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: flags.characterFile }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`)
      setTextureStatus({
        msg: `Repacked ${data.images_replaced}/${data.images_total} → ${data.out}${data.mirrored_to_static ? ' (mirrored)' : ''}`,
        error: false,
      })
      // New GLB shows up in /api/body/characters after a rescan;
      // do it automatically so the dropdown picks it up.
      await charactersApi.rescan()
    } catch (e) {
      setTextureStatus({ msg: `Repack failed: ${(e as Error).message}`, error: true })
    } finally {
      setRepackBusy(false)
    }
  }

  const sourceChar = sourceCharacterOf(flags.characterFile)
  const appearance = useStore((s) => s.bodyAppearance[sourceChar]) ?? {}
  const setBodyAppearance = useStore((s) => s.setBodyAppearance)
  // Per-region selectors so editing one palette doesn't re-render
  // the rows tied to the others.
  const skinPalette = useStore((s) => s.bodyPalettes.skin)
  const clothingPalette = useStore((s) => s.bodyPalettes.clothing)
  const hairPalette = useStore((s) => s.bodyPalettes.hair)
  const irisPalette = useStore((s) => s.bodyPalettes.iris)
  const addBodyPaletteColor = useStore((s) => s.addBodyPaletteColor)
  const removeBodyPaletteColor = useStore((s) => s.removeBodyPaletteColor)
  const replaceBodyPaletteColor = useStore((s) => s.replaceBodyPaletteColor)
  const resetBodyPalette = useStore((s) => s.resetBodyPalette)
  const [appearanceInfo, setAppearanceInfo] = useState<{
    atlas_baked: boolean
    categories: Record<string, { material: string; mode: string }>
  } | null>(null)
  const [appearanceLoading, setAppearanceLoading] = useState(false)
  const [applyBusy, setApplyBusy] = useState(false)
  const [applyStatus, setApplyStatus] = useState<{ msg: string; error: boolean } | null>(null)

  // Fetch appearance info (atlas / categories) on character change.
  // FBX can't be edited — skip the fetch.
  useEffect(() => {
    if (!characterIsGlb) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- legit "kick off async fetch" pattern
    setAppearanceLoading(true)
    const ctrl = new AbortController()
    fetch(apiUrl(`/character/appearance?file=${encodeURIComponent(sourceChar)}`), {
      signal: ctrl.signal,
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, data: d })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data?.detail || 'fetch failed')
        setAppearanceInfo({
          atlas_baked: !!data.atlas_baked,
          categories: data.categories || {},
        })
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setAppearanceInfo(null)
      })
      .finally(() => setAppearanceLoading(false))
    return () => ctrl.abort()
  }, [sourceChar, characterIsGlb])

  const updateAppearance = (next: AppearanceCust): void => {
    setBodyAppearance(sourceChar, next)
  }

  const applyAppearance = async () => {
    setApplyBusy(true)
    setApplyStatus(null)
    try {
      const res = await fetch(apiUrl('/character/customize'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: sourceChar, customizations: appearance }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`)
      setApplyStatus({
        msg: `Applied (${data.images_replaced} textures, ${data.materials_overridden} materials) → ${data.out}`,
        error: false,
      })
      await charactersApi.rescan()
      // Apply twice in a row → dropdown already on `_custom.glb` →
      // characterFile doesn't change → avatar re-uses the prior
      // load. Fire a reload event to bust that cache.
      const wasSame = data.out === flags.characterFile
      updateFlags({ characterFile: data.out })
      if (wasSame) {
        window.dispatchEvent(new Event('body.character.reload'))
      }
    } catch (e) {
      setApplyStatus({ msg: `Apply failed: ${(e as Error).message}`, error: true })
    } finally {
      setApplyBusy(false)
    }
  }

  const resetAppearance = () => {
    updateAppearance({})
    setApplyStatus({ msg: 'Cleared — click Apply to regenerate from original', error: false })
  }

  return (
    <SettingsSection id="appearance" group="body" label="Appearance">
      <Stack spacing={1.5}>
        <Box>
          <SettingsRow title="Avatar">
            <Select
              size="small"
              value={flags.characterFile}
              onChange={(e) => updateFlags({ characterFile: e.target.value })}
              sx={{
                width: 220,
                fontSize: 12,
                // pr leaves room for the absolute-positioned ext
                // chip from renderValue, on top of the arrow icon.
                '& .MuiSelect-select': {
                  pr: '52px !important',
                  py: '4px !important',
                },
              }}
              renderValue={(value) => {
                const c = charactersApi.characters.find((x) => x.file === value)
                if (!c) return value as string
                const ext = c.file.split('.').pop()?.toLowerCase() || ''
                return (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1,
                      width: '100%',
                    }}
                  >
                    <Box sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.label}
                    </Box>
                    <Chip
                      label={ext}
                      size="small"
                      variant="outlined"
                      sx={{
                        height: 18,
                        fontSize: 10,
                        fontFamily: 'ui-monospace, monospace',
                        textTransform: 'lowercase',
                      }}
                    />
                  </Box>
                )
              }}
            >
              {charactersApi.characters.map((c) => {
                const ext = c.file.split('.').pop()?.toLowerCase() || ''
                return (
                  <MenuItem
                    key={c.file}
                    value={c.file}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                  >
                    <Box sx={{ flex: 1 }}>{c.label}</Box>
                    <Chip
                      label={ext}
                      size="small"
                      variant="outlined"
                      sx={{
                        height: 18,
                        fontSize: 10,
                        fontFamily: 'ui-monospace, monospace',
                        textTransform: 'lowercase',
                      }}
                    />
                  </MenuItem>
                )
              })}
            </Select>
            <IconBtn
              label={toolsExpanded ? 'Hide tools' : 'Texture tools'}
              onClick={() => setToolsExpanded((v) => !v)}
              sx={{ p: 0.5, color: toolsExpanded ? 'primary.main' : 'inherit' }}
              icon={<BuildIcon />}
            />
          </SettingsRow>
          <Collapse in={toolsExpanded}>
            <Stack
              direction="row"
              sx={{
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 0.5,
                mt: 0.75,
                flexWrap: 'wrap',
              }}
            >
              <Btn
                label={
                  characterIsGlb
                    ? extractBusy
                      ? 'Extracting…'
                      : 'GLB → IMGs: dump embedded textures from this GLB to a sibling _textures_<name>/ folder for editing.'
                    : 'Only .glb characters can be unpacked.'
                }
                variant="outlined"
                disabled={!characterIsGlb || extractBusy || repackBusy}
                onClick={() => void runExtract()}
                sx={{ minWidth: 0, px: 0.5 }}
              >
                <Stack direction="row" sx={{ alignItems: 'center', gap: 0.25 }}>
                  <ViewInArIcon fontSize="small" />
                  <ChevronRightIcon sx={{ fontSize: 14 }} />
                  <ImageIcon fontSize="small" />
                </Stack>
              </Btn>
              <Btn
                label={
                  characterIsGlb
                    ? repackBusy
                      ? 'Repacking…'
                      : 'IMGs → GLB: pack edited textures from _textures_<name>/ back into a new GLB next to the source.'
                    : 'Only .glb characters can be repacked.'
                }
                variant="outlined"
                disabled={!characterIsGlb || extractBusy || repackBusy}
                onClick={() => void runRepack()}
                sx={{ minWidth: 0, px: 0.5 }}
              >
                <Stack direction="row" sx={{ alignItems: 'center', gap: 0.25 }}>
                  <ImageIcon fontSize="small" />
                  <ChevronRightIcon sx={{ fontSize: 14 }} />
                  <ViewInArIcon fontSize="small" />
                </Stack>
              </Btn>
              <IconBtn
                label={
                  characterIsGlb
                    ? `Open _textures_${flags.characterFile.replace(/\.glb$/i, '').toLowerCase()}/ folder in Explorer (run GLB2IMGs first if it doesn't exist).`
                    : 'Only .glb characters have a textures folder.'
                }
                disabled={!characterIsGlb}
                onClick={() => {
                  void fetch(apiUrl('/open_folder'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      target: 'character_textures',
                      file: flags.characterFile,
                    }),
                  })
                }}
                sx={{ p: 0.5 }}
                icon={<FolderOpenIcon />}
              />
              <IconBtn
                label="Open the characters folder in Explorer"
                onClick={() => {
                  void fetch(apiUrl('/open_folder'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ target: 'characters' }),
                  })
                }}
                sx={{ p: 0.5 }}
                icon={<FolderCopyIcon />}
              />
              <IconBtn
                label="Rescan /body/characters/ folder for new files"
                onClick={() => {
                  void charactersApi.rescan()
                  void charMetaApi.rescan()
                }}
                sx={{ p: 0.5 }}
                icon={<RestartAltIcon />}
              />
            </Stack>
          </Collapse>
          {textureStatus && (
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                mt: 0.5,
                color: textureStatus.error ? 'error.main' : 'text.secondary',
                fontFamily: 'ui-monospace, monospace',
                wordBreak: 'break-all',
              }}
            >
              {textureStatus.msg}
            </Typography>
          )}
        </Box>
        <SettingsRow title="Gender">
          <Tooltip
            arrow
            title="Drives the gender filter — wrong-gender clips dim in the pool grid and Loom omits them from the motion catalog."
          >
            <ToggleButtonGroup
              size="small"
              exclusive
              value={activeCharGender ?? null}
              onChange={(_, v) => {
                if (v === 'male' || v === 'female') {
                  void charMetaApi.setGender(
                    flags.characterFile.endsWith('_custom.glb')
                      ? flags.characterFile.replace('_custom.glb', '.glb')
                      : flags.characterFile,
                    v,
                  )
                }
              }}
              sx={{
                '& .MuiToggleButton-root': {
                  py: 0.25,
                  px: 1,
                  fontSize: 11,
                  textTransform: 'none',
                  lineHeight: 1.2,
                },
              }}
            >
              <ToggleButton value="female">♀ Female</ToggleButton>
              <ToggleButton value="male">♂ Male</ToggleButton>
            </ToggleButtonGroup>
          </Tooltip>
        </SettingsRow>
        <SettingsRow title="Render style">
          <ToggleButtonGroup
            size="small"
            exclusive
            value={flags.renderStyle}
            onChange={(_, v) => {
              if (v) updateFlags({ renderStyle: v })
            }}
            sx={{
              '& .MuiToggleButton-root': {
                py: 0.25,
                px: 1,
                fontSize: 11,
                lineHeight: 1.2,
              },
            }}
          >
            <ToggleButton value="realistic">Realistic</ToggleButton>
            <ToggleButton value="wireframe">Wireframe</ToggleButton>
            <ToggleButton value="hologram">Hologram</ToggleButton>
          </ToggleButtonGroup>
        </SettingsRow>
        <SettingsRow title="Room lighting">
          <Tooltip
            title="Render each WLED device with a configured 3D position as a colored glowing orb at that point in the scene — and (in 'full') let it illuminate the avatar. 'Subtle' adds discreet markers; 'Full' is the room-fills-the-frame look."
            placement="left"
            arrow
          >
            <ToggleButtonGroup
              size="small"
              exclusive
              value={flags.roomLighting}
              onChange={(_, v) => {
                if (v) updateFlags({ roomLighting: v })
              }}
              sx={{
                '& .MuiToggleButton-root': {
                  py: 0.25,
                  px: 1,
                  fontSize: 11,
                  lineHeight: 1.2,
                },
              }}
            >
              <ToggleButton value="off">Off</ToggleButton>
              <ToggleButton value="subtle">Subtle</ToggleButton>
              <ToggleButton value="full">Full</ToggleButton>
            </ToggleButtonGroup>
          </Tooltip>
        </SettingsRow>
        {!characterIsGlb ? (
          <Typography variant="caption" color="text.secondary">
            Per-region recoloring requires a .glb character (current: {flags.characterFile}).
          </Typography>
        ) : appearanceLoading ? (
          <Typography variant="caption" color="text.secondary">
            Loading appearance info…
          </Typography>
        ) : !appearanceInfo ? (
          <Typography variant="caption" color="error.main">
            Couldn't load appearance info for this character.
          </Typography>
        ) : appearanceInfo.atlas_baked ? (
          <Typography variant="caption" color="warning.main">
            Atlas-baked asset — skin and clothing share one texture, so per-region recoloring
            isn't possible. (Re-export from the source with separated outfit pieces to enable
            this.)
          </Typography>
        ) : (
          <>
            {/* Skin chip-pick maps to the backend's preset path
             *  (LAB-shift) when the hex matches a DEFAULT_SKIN_PRESETS
             *  entry; otherwise the colorize path (raw hex). The
             *  Tone slider applies an L-shift after either filter. */}
            {appearanceInfo.categories.skin && (() => {
              const skinSelected: string | null = appearance.skin?.color
                ? appearance.skin.color
                : appearance.skin?.preset
                ? SKIN_PRESETS.find((p) => p.key === appearance.skin?.preset)?.color ??
                  null
                : null
              const pickSkin = (hex: string): void => {
                const preset = SKIN_PRESETS.find(
                  (p) => p.color.toLowerCase() === hex.toLowerCase(),
                )
                updateAppearance({
                  ...appearance,
                  skin: preset
                    ? {
                        preset: preset.key,
                        tone: appearance.skin?.tone ?? 0,
                        color: null,
                      }
                    : {
                        preset: '',
                        tone: appearance.skin?.tone ?? 0,
                        color: hex,
                      },
                })
              }
              const clearSkin = (): void => {
                const next = { ...appearance }
                delete next.skin
                updateAppearance(next)
              }
              return (
                <Colors
                  title="Skin"
                  palette={skinPalette}
                  selected={skinSelected}
                  onSelect={pickSkin}
                  onClear={appearance.skin ? clearSkin : undefined}
                  edit={{
                    onReplace: (i, c) => replaceBodyPaletteColor('skin', i, c),
                    onRemove: (i) => removeBodyPaletteColor('skin', i),
                    onAdd: (c) => addBodyPaletteColor('skin', c),
                    onReset: () => resetBodyPalette('skin'),
                  }}
                >
                  <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" sx={{ minWidth: 38, color: 'text.secondary' }}>
                      Tone
                    </Typography>
                    <Slider
                      size="small"
                      min={-25}
                      max={25}
                      step={1}
                      value={appearance.skin?.tone ?? 0}
                      onChange={(_, v) =>
                        updateAppearance({
                          ...appearance,
                          skin: {
                            preset: appearance.skin?.preset || 'medium',
                            tone: v as number,
                            color: appearance.skin?.color || null,
                          },
                        })
                      }
                      sx={{ flex: 1 }}
                    />
                    <Typography
                      variant="caption"
                      sx={{ minWidth: 28, textAlign: 'right', color: 'text.secondary' }}
                    >
                      {appearance.skin?.tone ?? 0}
                    </Typography>
                  </Stack>
                </Colors>
              )
            })()}

            {/* Top / Bottom / Shoes share the `clothing` palette. */}
            {(
              [
                { key: 'top', label: 'Top', region: 'clothing' },
                { key: 'bottom', label: 'Bottom', region: 'clothing' },
                { key: 'footwear', label: 'Shoes', region: 'clothing' },
                { key: 'hair', label: 'Hair', region: 'hair' },
                { key: 'iris', label: 'Iris', region: 'iris' },
              ] as const
            ).map(({ key, label, region }) =>
              appearanceInfo.categories[key] ? (
                <Colors
                  key={key}
                  title={label}
                  palette={
                    region === 'clothing'
                      ? clothingPalette
                      : region === 'hair'
                      ? hairPalette
                      : irisPalette
                  }
                  selected={appearance[key]?.color ?? null}
                  onSelect={(c) =>
                    updateAppearance({ ...appearance, [key]: { color: c } })
                  }
                  onClear={() => {
                    const next = { ...appearance }
                    delete next[key]
                    updateAppearance(next)
                  }}
                  edit={{
                    onReplace: (i, c) => replaceBodyPaletteColor(region, i, c),
                    onRemove: (i) => removeBodyPaletteColor(region, i),
                    onAdd: (c) => addBodyPaletteColor(region, c),
                    onReset: () => resetBodyPalette(region),
                  }}
                />
              ) : null,
            )}

            <Stack
              direction="row"
              spacing={1}
              sx={{ mt: 1, justifyContent: 'flex-end' }}
            >
              <Button
                size="small"
                variant="outlined"
                disabled={applyBusy}
                onClick={resetAppearance}
              >
                Reset
              </Button>
              <Button
                size="small"
                variant="contained"
                disabled={applyBusy}
                onClick={() => void applyAppearance()}
              >
                {applyBusy ? 'Applying…' : 'Apply'}
              </Button>
            </Stack>
            {applyStatus && (
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  mt: 0.5,
                  color: applyStatus.error ? 'error.main' : 'text.secondary',
                  fontFamily: 'ui-monospace, monospace',
                  wordBreak: 'break-all',
                }}
              >
                {applyStatus.msg}
              </Typography>
            )}
          </>
        )}
      </Stack>
    </SettingsSection>
  )
}
