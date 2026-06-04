import { Button, Tooltip } from '@mui/material'
import type { ButtonProps, TooltipProps } from '@mui/material'
import type { ReactNode } from 'react'

/** Button + Tooltip wrapper. Pass `label` for the tooltip text;
 *  omit it to get a plain Button with no tooltip.
 *
 *  Differences from a bare MUI Button:
 *    - default `size="small"` (overridable)
 *    - disabled buttons don't fire pointer events, so MUI Tooltip
 *      needs them wrapped in a span — handled transparently here so
 *      call sites don't have to remember
 *    - `label` (not `title`) to avoid colliding with the native HTML
 *      `title` attribute
 *
 *  Extra Tooltip props (placement, arrow, slotProps for max-width on
 *  long-form tooltips, etc.) go through `tooltipProps`. */

export interface BtnProps extends ButtonProps {
  /** Tooltip text — when set, wraps the Button in an MUI Tooltip. */
  label?: ReactNode
  /** Escape hatch for passing arbitrary props to the wrapping MUI
   *  Tooltip. The `title` is set internally from `label`. */
  tooltipProps?: Omit<Partial<TooltipProps>, 'title' | 'children'>
}

export function Btn({
  label,
  tooltipProps,
  size = 'small',
  disabled,
  ...rest
}: BtnProps) {
  const btn = <Button size={size} disabled={disabled} {...rest} />
  if (!label) return btn
  return (
    <Tooltip title={label} {...tooltipProps}>
      {disabled ? <span>{btn}</span> : btn}
    </Tooltip>
  )
}
