import { Box, Stack, Tooltip, Typography } from '@mui/material'
import type { ReactNode } from 'react'

/** One settings row — a flex row with a left-aligned caption label and
 *  flex-pushed-right content. Used to normalize the visual shape of
 *  every "Label … control" line in BodySettings (Avatar, Gender,
 *  Render style, Skin, Hair, Iris, etc.) so all six rows share the
 *  same typography, alignment, and click behavior.
 *
 *  Vertical spacing is OWNED BY THE PARENT — wrap rows in a single
 *  `<Stack spacing={N}>` and remove any per-row margin. SettingsRow
 *  itself never sets a `mb`.
 *
 *  Pass `onTitleClick` to make the label clickable (e.g. for a
 *  collapsible row whose label toggles expansion — see Colors). The
 *  whole flex-1 label area becomes the click target, not just the
 *  text. */

export interface SettingsRowProps {
  /** Label content — usually a string but accepts ReactNode for
   *  decorations like a count badge `(N)` next to the title. */
  title: ReactNode
  /** Optional — pass to make the label clickable. Cursor becomes
   *  pointer + text-selection is suppressed. */
  onTitleClick?: () => void
  /** Optional long-form description shown as a Tooltip when the user
   *  hovers the row. Use for "what does this setting do?" copy that
   *  doesn't fit in the short `title`. */
  info?: ReactNode
  /** Right-side content, pushed flush right by the label's `flex: 1`. */
  children?: ReactNode
}

export function SettingsRow({ title, onTitleClick, info, children }: SettingsRowProps) {
  const clickable = !!onTitleClick
  const row = (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
      <Box
        onClick={onTitleClick}
        sx={{
          flex: 1,
          minWidth: 0,
          cursor: clickable ? 'pointer' : 'default',
          userSelect: clickable ? 'none' : 'auto',
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {title}
        </Typography>
      </Box>
      {children}
    </Stack>
  )
  if (!info) return row
  return (
    <Tooltip arrow title={info}>
      {row}
    </Tooltip>
  )
}
