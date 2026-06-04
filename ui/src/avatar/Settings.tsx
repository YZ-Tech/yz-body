import CloseIcon from '@mui/icons-material/Close'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import { Box, Button, Stack, Typography } from '@mui/material'
import { useEffect } from 'react'
import { useBodyCharacterMeta } from '../hooks/useBodyCharacterMeta'
import { useBodyClipPools } from '../hooks/useBodyClipPools'
import { useBodyFlags } from '../hooks/useBodyFlags'
import { useStore } from '../store'
import { IconBtn } from '../components/IconBtn'
import { BodySettingsAimPoints } from './SettingsAimPoints'
import { BodySettingsAppearance } from './SettingsAppearance'
import { BodySettingsBehavior } from './SettingsBehavior'
import { BodySettingsClips } from './SettingsClips'
import { BodySettingsOverlays } from './SettingsOverlays'

export function BodySettings({
  onPreview,
}: {
  onPreview: (clip: string) => void
}) {
  // open/close + currentClip now live in the store so AvatarControls
  // and the active-clip chip in BodySettingsClips don't need prop drilling.
  const open = useStore((s) => s.bodySettingsOpen)
  const setOpen = useStore((s) => s.setBodySettingsOpen)
  const onClose = () => setOpen(false)

  // Only need resetAll here (Reset button at the bottom); the rest of
  // the pools hook lives inside BodySettingsClips.
  const [flags] = useBodyFlags()
  const charMetaApi = useBodyCharacterMeta()
  const activeCharGender = charMetaApi.genderOf(flags.characterFile)
  const [, , resetAll] = useBodyClipPools(flags.characterFile, activeCharGender)

  // Escape-to-close (Drawer used to give this for free).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  return (
    // Lives INSIDE the BodyAvatar Paper (not in a Modal/Drawer) so
    // fullscreen carries the panel with the canvas. Left half of
    // the canvas stays orbit/zoom-capable while open.
    <Box
      role="dialog"
      aria-hidden={!open}
      sx={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 520,
        maxWidth: '90%',
        bgcolor: 'background.paper',
        borderLeft: '1px solid',
        borderColor: 'divider',
        boxShadow: 8,
        display: 'flex',
        flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        zIndex: 5,
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, px: 2, py: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
          Settings
        </Typography>
        <IconBtn onClick={onClose} icon={<CloseIcon />} />
      </Stack>
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          px: 1,
          py: 0.5,
          borderTop: '1px solid',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <BodySettingsBehavior />
        <BodySettingsAppearance />
        <BodySettingsOverlays />
        <BodySettingsClips onPreview={onPreview} />
        <BodySettingsAimPoints />
      </Box>
      <Stack direction="row" sx={{ alignItems: 'center', p: 1.5, gap: 1 }}>
        <Button
          size="small"
          startIcon={<RestartAltIcon />}
          onClick={() => {
            if (confirm('Reset all clip pools to defaults?')) resetAll()
          }}
          color="warning"
        >
          Reset
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={onClose} variant="contained">
          Done
        </Button>
      </Stack>
    </Box>
  )
}
