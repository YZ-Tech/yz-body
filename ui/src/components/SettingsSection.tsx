import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Stack,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { useStore } from '../store'

/** One collapsible section inside a settings panel. Encapsulates the
 *  Accordion machinery + the compact uppercase header styling we use
 *  everywhere, plus the shared "right side of the title" action slot.
 *
 *  Exclusive-accordion behavior is owned by a Zustand slice
 *  (`storeAccordions`) keyed by `group` → currently-open `id`. Open
 *  one section in a group → any other open section in that group
 *  closes automatically. Most callers can leave `group` at its
 *  default ('default'); pass it when multiple settings panels with
 *  their own accordion groups exist in the same app.
 *
 *  Visual style is baked in — `disableGutters`, `elevation=0`, the
 *  transparent bg with border separator, compact 36px header height,
 *  uppercase caption title typography. No call-site styling needed.
 *
 *  rightActions: optional ReactNode (usually a fragment of IconBtns)
 *  rendered at the right end of the title row, before the expand
 *  chevron. IconBtn's default e.stopPropagation() keeps clicks on the
 *  action buttons from toggling the accordion. */

const accordionSx = {
  bgcolor: 'transparent',
  boxShadow: 'none',
  '&:before': { display: 'none' },
  borderBottom: '1px solid',
  borderColor: 'divider',
  '&:last-of-type': { borderBottom: 'none' },
}
const accordionSummarySx = {
  minHeight: 36,
  px: 1,
  '& .MuiAccordionSummary-content': { my: 0.5 },
  '&.Mui-expanded': { minHeight: 36 },
}
const accordionTitleSx = {
  display: 'block',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  color: 'text.secondary',
  fontWeight: 600,
}
const accordionDetailsSx = { px: 1, pt: 0.5, pb: 1.5 }

export interface SettingsSectionProps {
  /** Unique id of this section within its group. Used for exclusive-
   *  open behavior. */
  id: string
  /** Header label — usually a short string. Accepts ReactNode for
   *  custom decoration (count badge, icon prefix, etc.). */
  label: ReactNode
  /** Exclusivity group. Sections sharing a group are mutually
   *  exclusive; sections in different groups are independent.
   *  Default is 'default'. */
  group?: string
  /** Optional right-side header actions (e.g. add/reset IconBtns).
   *  IconBtn's default stopPropagation prevents these from toggling
   *  the section. */
  rightActions?: ReactNode
  children?: ReactNode
}

export function SettingsSection({
  id,
  label,
  group = 'default',
  rightActions,
  children,
}: SettingsSectionProps) {
  const openId = useStore((s) => s.accordions[group] ?? null)
  const setOpen = useStore((s) => s.setOpenAccordion)
  const expanded = openId === id
  return (
    <Accordion
      expanded={expanded}
      onChange={(_, isExpanded) => setOpen(group, isExpanded ? id : null)}
      disableGutters
      elevation={0}
      sx={accordionSx}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon fontSize="small" />}
        sx={accordionSummarySx}
      >
        <Stack
          direction="row"
          sx={{ alignItems: 'center', gap: 1, width: '100%', pr: 1 }}
        >
          <Typography variant="caption" sx={{ ...accordionTitleSx, flex: 1 }}>
            {label}
          </Typography>
          {rightActions}
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={accordionDetailsSx}>{children}</AccordionDetails>
    </Accordion>
  )
}
