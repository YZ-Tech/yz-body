import { Box, Typography } from '@mui/material'
import { useStore } from '../store'

/** Bottom-left translucent pill showing `mode · clip` or load status.
 *  Fades from 50% → 100% opacity on hover. All four inputs come from
 *  the store — zero props. */
export function AvatarStatusPill() {
  const mode = useStore((s) => s.mode)
  const currentClip = useStore((s) => s.bodyCurrentClip)
  const status = useStore((s) => s.bodyStatus)
  const errorMsg = useStore((s) => s.bodyErrorMsg)
  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        bgcolor: 'rgba(4, 6, 14, 0.55)',
        backdropFilter: 'blur(6px)',
        borderRadius: 1,
        px: 1,
        py: 0.25,
        opacity: 0.5,
        transition: 'opacity 180ms ease',
        '&:hover': { opacity: 1 },
      }}
    >
      <Typography
        variant="caption"
        sx={{ color: '#cfd6e6', fontFamily: 'ui-monospace, monospace' }}
      >
        {status === 'loading'
          ? 'loading character…'
          : status === 'error'
          ? `error: ${errorMsg.slice(0, 60)}`
          : `${mode} · ${currentClip || '—'}`}
      </Typography>
    </Box>
  )
}
