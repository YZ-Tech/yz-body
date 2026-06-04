import AddIcon from '@mui/icons-material/Add'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import { Stack, Typography } from '@mui/material'
import { useOverlayActions, useOverlayIds } from '../hooks/useBodyOverlays'
import { useStore } from '../store'
import { IconBtn } from '../components/IconBtn'
import { OverlayEditor } from './OverlayEditor'
import { SettingsSection } from '../components/SettingsSection'

export function BodySettingsOverlays() {
  const overlayIds = useOverlayIds()
  const overlayActions = useOverlayActions()
  const skeletonBones = useStore((s) => s.bodyBones)
  return (
    <SettingsSection
      id="overlays"
      group="body"
      label="Body overlays"
      rightActions={
        <>
          <IconBtn
            label="Add a new overlay (starts disabled)"
            onClick={() => overlayActions.add()}
            icon={<AddIcon />}
          />
          <IconBtn
            label="Reset overlays to defaults"
            onClick={() => {
              if (confirm('Reset all body overlays to defaults?')) overlayActions.reset()
            }}
            icon={<RestartAltIcon />}
          />
        </>
      }
    >
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
        Glow effects on bone-weighted body parts. Each entry extracts a subset of the
        character mesh (by bone names) and renders it on top with a chosen effect + driver.
        Edits apply live — tear-down + rebuild happens on save.
      </Typography>
      <Stack spacing={1.25} sx={{ mb: 2 }}>
        {overlayIds.map((id) => (
          <OverlayEditor key={id} id={id} boneOptions={skeletonBones} />
        ))}
        {overlayIds.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ py: 1 }}>
            No overlays. Click + to add one.
          </Typography>
        )}
      </Stack>
    </SettingsSection>
  )
}
