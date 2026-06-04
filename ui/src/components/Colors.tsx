import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import ColorizeIcon from '@mui/icons-material/Colorize'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined'
import EditIcon from '@mui/icons-material/EditOutlined'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import {
  Box,
  Collapse,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ChangeEvent, ReactNode } from 'react'
import { useState } from 'react'
import { IconBtn } from './IconBtn'
import { SettingsRow } from './SettingsRow'

/** Reusable per-region color row.
 *
 *  Three visual modes:
 *  - COLLAPSED (default): row shows just [Title] + a single summary
 *    chip displaying the currently-selected color (dashed placeholder
 *    if nothing is selected). Click the title or the summary chip to
 *    expand. Compact — no visual noise unless the user is engaging
 *    with this row.
 *  - EXPANDED (view): full swatch palette inline + a clear icon when
 *    something is selected + the edit pencil at the far right (reads
 *    as "the next color slot"). To use a color that isn't in the
 *    palette, the user toggles edit mode and adds it.
 *  - EDIT: each chip becomes a native color input with an X badge for
 *    removal, plus a trailing dashed "+" chip for appending. A reset
 *    icon (factory defaults) and a check icon (done) live in the title
 *    row. Entering edit mode auto-expands; leaving it returns to
 *    whatever expansion state the user was in.
 *
 *  The component is store-agnostic — pass the palette + selection in,
 *  hand back callbacks for the mutations you want supported. Omit the
 *  `edit` prop entirely to hide the edit toggle (read-only mode). */

export interface ColorsEditApi {
  onReplace: (index: number, color: string) => void
  onRemove: (index: number) => void
  onAdd: (color: string) => void
  onReset: () => void
}

export interface ColorsProps {
  /** Row label — shown left-aligned. */
  title: string
  /** Color list in sRGB hex (`#rrggbb`). */
  palette: string[]
  /** Currently-selected color in this row's selection slot, if any. */
  selected?: string | null
  /** Fires when the user picks a swatch or commits a Custom color. */
  onSelect: (color: string) => void
  /** Optional — if provided, shows a "clear" button to drop the
   *  selection back to no-override. */
  onClear?: () => void
  /** Optional — pass to enable the edit toggle + edit mode. */
  edit?: ColorsEditApi
  /** Optional related controls (e.g. a tone slider) rendered inside
   *  a vertical Collapse bound to the same expand state as the chip
   *  row. Revealed when the user expands the row; hidden when
   *  collapsed. Keeps related selection-affecting controls
   *  colocated with the palette they belong to. */
  children?: ReactNode
}

const CHIP = 22
const EDIT_CHIP = 26

export function Colors({
  title,
  palette,
  selected,
  onSelect,
  onClear,
  edit,
  children,
}: ColorsProps) {
  const [editing, setEditing] = useState(false)
  // User-controlled collapse state. Edit mode force-expands; once the
  // user exits edit mode they return to whatever they had before.
  const [expanded, setExpanded] = useState(false)
  const editable = !!edit
  const showFull = expanded || editing

  return (
    <Box>
      {/* Title row + right-side controls — uses the shared
       *  SettingsRow so the typography + alignment match every
       *  other row in BodySettings pixel-for-pixel. The label is
       *  clickable in view mode (toggles expansion); in edit mode
       *  the label is inert and the check button drives state. */}
      <SettingsRow
        title={
          <>
            {title}
            {editing && (
              <Typography
                component="span"
                variant="caption"
                color="text.disabled"
                sx={{ ml: 0.5 }}
              >
                ({palette.length})
              </Typography>
            )}
          </>
        }
        onTitleClick={editing ? undefined : () => setExpanded((v) => !v)}
      >
        {/* COLLAPSED summary — single circle showing the current
         *  selection (or a dashed placeholder with a pipette icon to
         *  read as "click to pick a color"). Click expands the full
         *  row. */}
        {!showFull && (
          <Tooltip
            title={
              selected ? `${selected} — click to change` : 'Click to pick a color'
            }
            arrow
          >
            <Box
              component="button"
              type="button"
              onClick={() => setExpanded(true)}
              sx={{
                width: CHIP,
                height: CHIP,
                borderRadius: '50%',
                bgcolor: selected ?? 'transparent',
                border: selected
                  ? '1px solid rgba(255,255,255,0.15)'
                  : '1px dashed rgba(255,255,255,0.35)',
                cursor: 'pointer',
                padding: 0,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'text.secondary',
              }}
            >
              {!selected && <ColorizeIcon sx={{ fontSize: 12 }} />}
            </Box>
          </Tooltip>
        )}

        {/* EXPANDED right side (view + edit modes) — wrapped in a
         *  horizontal Collapse so open/close animates smoothly. The
         *  inner Stack is `nowrap` + `flex-shrink: 0` on each chip so
         *  the contents stay on a single line while the wrapper width
         *  animates between 0 and full (otherwise the chips would
         *  column-stack mid-animation). Everything that should only
         *  exist in the expanded state — clear, chips, reset (edit),
         *  pencil, close-X — lives inside here. */}
        <Collapse
          in={showFull}
          orientation="horizontal"
          sx={{ '& > .MuiCollapse-wrapperInner': { display: 'flex' } }}
        >
          <Stack
            direction="row"
            sx={{
              alignItems: 'center',
              gap: 0.5,
              flexWrap: 'nowrap',
              whiteSpace: 'nowrap',
            }}
          >
            {!editing && selected && onClear && (
              <IconBtn
                label="Clear selection (use texture default)"
                onClick={onClear}
                icon={<DeleteOutlineIcon />}
              />
            )}
            {/* View-mode chips render inline so the row reads as
             *  [title] … [chip][chip][chip][edit-pencil][close-X] —
             *  the pencil sits next to the chips like a "next slot",
             *  and the close-X mirrors the summary chip's position
             *  for symmetric expand/collapse affordance. */}
            {!editing &&
              palette.map((c) => {
                const isSelected = selected?.toLowerCase() === c.toLowerCase()
                return (
                  <Tooltip key={c} title={c} arrow>
                    <Box
                      component="button"
                      type="button"
                      onClick={() => onSelect(c)}
                      sx={{
                        width: CHIP,
                        height: CHIP,
                        borderRadius: '50%',
                        bgcolor: c,
                        border: isSelected
                          ? '2px solid #fff'
                          : '1px solid rgba(255,255,255,0.15)',
                        outline: isSelected ? '2px solid #1976d2' : 'none',
                        cursor: 'pointer',
                        padding: 0,
                        flexShrink: 0,
                      }}
                    />
                  </Tooltip>
                )
              })}
            {editing && edit && (
              <IconBtn
                label="Reset palette to factory defaults"
                onClick={edit.onReset}
                icon={<RestartAltIcon />}
              />
            )}
            {editable && (
              <IconBtn
                label={editing ? 'Done editing' : 'Edit palette'}
                onClick={() => setEditing((v) => !v)}
                sx={{ color: editing ? 'primary.main' : 'inherit' }}
                icon={editing ? <CheckIcon /> : <EditIcon />}
              />
            )}
            {/* Close button — only in view mode (edit mode uses the
             *  check button to leave, then the row collapses naturally
             *  if the user wants via title click). Clicking the title
             *  also collapses; this is the explicit-affordance
             *  duplicate. */}
            {!editing && (
              <IconBtn
                label="Collapse"
                onClick={() => setExpanded(false)}
                icon={<CloseIcon />}
              />
            )}
          </Stack>
        </Collapse>
      </SettingsRow>

      {/* Optional related controls — vertical Collapse bound to the
       *  same `showFull` flag as the horizontal chip Collapse. Clicking
       *  the title (or summary chip) reveals both at once; collapsing
       *  hides both. Caller-owned content via children. */}
      {children !== undefined && (
        <Collapse in={showFull} orientation="vertical">
          <Box sx={{ pt: 0.5 }}>{children}</Box>
        </Collapse>
      )}

      {editing && edit && (
        // ── EDIT body ─────────────────────────────────────────────
        // Native color input styled as a circular chip; clicking opens
        // the OS picker, `change` (release) fires replace. Uncontrolled
        // so 60Hz drag doesn't round-trip through React. An X badge in
        // each chip's top-right removes that entry. The trailing
        // dashed "+ add" chip works the same way, appending on change.
        // View mode has no body — its chips render inline in the title
        // row above (with the edit pencil as the trailing slot).
        <Stack
          direction="row"
          sx={{ flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}
        >
          {palette.map((color, index) => (
            <Box
              key={`${color}-${index}`}
              sx={{ position: 'relative', display: 'inline-block' }}
            >
              <Box
                component="input"
                type="color"
                defaultValue={color}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  edit.onReplace(index, e.target.value)
                }
                title={color}
                sx={{
                  width: EDIT_CHIP,
                  height: EDIT_CHIP,
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '50%',
                  padding: 0,
                  cursor: 'pointer',
                  bgcolor: 'transparent',
                  '&::-webkit-color-swatch-wrapper': {
                    padding: 0,
                    borderRadius: '50%',
                  },
                  '&::-webkit-color-swatch': {
                    border: 'none',
                    borderRadius: '50%',
                  },
                  '&::-moz-color-swatch': {
                    border: 'none',
                    borderRadius: '50%',
                  },
                }}
              />
              <IconBtn
                label="Remove"
                onClick={() => edit.onRemove(index)}
                sx={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  p: 0,
                  width: 14,
                  height: 14,
                  bgcolor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                  '&:hover': { bgcolor: 'error.dark' },
                }}
                icon={<CloseIcon sx={{ fontSize: 10 }} />}
              />
            </Box>
          ))}
          <Box sx={{ position: 'relative', display: 'inline-block' }}>
            <Box
              component="input"
              type="color"
              defaultValue={palette[palette.length - 1] ?? '#888888'}
              onChange={(e: ChangeEvent<HTMLInputElement>) => edit.onAdd(e.target.value)}
              title="Add a new color to this palette"
              sx={{
                width: EDIT_CHIP,
                height: EDIT_CHIP,
                border: '1px dashed rgba(255,255,255,0.35)',
                borderRadius: '50%',
                padding: 0,
                cursor: 'pointer',
                bgcolor: 'transparent',
                opacity: 0,
                position: 'absolute',
                top: 0,
                left: 0,
              }}
            />
            <Box
              sx={{
                width: EDIT_CHIP,
                height: EDIT_CHIP,
                borderRadius: '50%',
                border: '1px dashed rgba(255,255,255,0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'text.secondary',
                pointerEvents: 'none',
              }}
            >
              <AddIcon sx={{ fontSize: 16 }} />
            </Box>
          </Box>
        </Stack>
      )}
    </Box>
  )
}
