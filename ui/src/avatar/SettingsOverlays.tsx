import AddIcon from '@mui/icons-material/Add'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import { Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { useOverlayActions, useOverlayIds } from '../hooks/useBodyOverlays'
import { useStore } from '../store'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { IconBtn } from '../components/IconBtn'
import { OverlayEditor } from './OverlayEditor'
import { SettingsSection } from '../components/SettingsSection'

export function BodySettingsOverlays() {
  const overlayIds = useOverlayIds()
  const overlayActions = useOverlayActions()
  const skeletonBones = useStore((s) => s.bodyBones)
  // Confirmed via the themed ConfirmDialog, not window.confirm.
  const [confirmReset, setConfirmReset] = useState(false)
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
            onClick={() => setConfirmReset(true)}
            icon={<RestartAltIcon />}
          />
          <ConfirmDialog
            open={confirmReset}
            title="Reset body overlays"
            message="Reset all body overlays to defaults? Custom overlays are removed and the stock set comes back."
            confirmLabel="Reset"
            onConfirm={() => overlayActions.reset()}
            onClose={() => setConfirmReset(false)}
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
