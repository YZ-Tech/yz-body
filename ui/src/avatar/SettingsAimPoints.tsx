import { useState } from 'react'
import { Stack, Typography } from '@mui/material'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import ClearIcon from '@mui/icons-material/Clear'
import { useStore } from '../store'
import { IconBtn } from '../components/IconBtn'
import { SettingsSection } from '../components/SettingsSection'
import { SettingsRow } from '../components/SettingsRow'
import { BodyPointLocator } from './PointLocator'
import type { Point3, WLEDDevice } from '../api/types'

/** Aim Points — re-homed from JarvYZ's Devices page (body Stage 7). Lists the
 *  host's WLED devices (fed into the store via the `wled` WS event) and lets
 *  you place each one's `point_at` coord directly in the live avatar scene
 *  (reusing BodyPointLocator's IK preview) so the avatar can finger-point at
 *  it via play_body_point. Saves straight back to the host:
 *  PATCH /api/wled/devices/{alias}. The host owns the WLED config; this is
 *  just the picker UI, which belongs with the avatar that consumes it.
 *
 *  Empty until a JarvYZ host feeds devices over WS (the standalone SPA has
 *  none, and /api/wled doesn't exist there). */
export function BodySettingsAimPoints() {
  const devices = useStore((s) => s.wled.devices)
  const loaded = useStore((s) => s.wled.loaded)
  const [locating, setLocating] = useState<WLEDDevice | null>(null)
  const list = Object.values(devices).sort((a, b) => a.alias.localeCompare(b.alias))

  const savePointAt = async (alias: string, point: Point3 | null): Promise<void> => {
    try {
      // /api/wled is the HOST's WLED API (absolute path, not the /api/body
      // satellite prefix). Same call JarvYZ's Devices page used pre-Stage-7.
      await fetch(`/api/wled/devices/${encodeURIComponent(alias)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          point_at: point ? { x: point.x, y: point.y, z: point.z } : null,
        }),
      })
    } catch {
      /* host unreachable — best-effort; the next `wled` WS seed re-syncs */
    }
    setLocating(null)
  }

  return (
    <SettingsSection id="aim-points" group="body" label="Aim points">
      {!loaded || list.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', px: 1, py: 1 }}>
          {loaded
            ? 'No WLED devices — add one in JarvYZ → Devices.'
            : 'Connect to JarvYZ to set device aim points.'}
        </Typography>
      ) : (
        <Stack sx={{ py: 0.5 }}>
          {list.map((d) => (
            <SettingsRow
              key={d.alias}
              title={d.alias}
              info={
                d.point_at
                  ? `Avatar points at (${d.point_at.x.toFixed(0)}, ${d.point_at.y.toFixed(0)}, ${d.point_at.z.toFixed(0)})`
                  : 'No aim point — click locate to place one'
              }
            >
              <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
                <IconBtn
                  label={
                    d.point_at
                      ? 'Relocate aim point'
                      : 'Locate (place the 3D point the avatar finger-points at)'
                  }
                  onClick={() => setLocating(d)}
                  color={d.point_at ? 'primary' : 'default'}
                  icon={<MyLocationIcon />}
                />
                {d.point_at && (
                  <IconBtn
                    label="Clear aim point"
                    onClick={() => savePointAt(d.alias, null)}
                    icon={<ClearIcon />}
                  />
                )}
              </Stack>
            </SettingsRow>
          ))}
        </Stack>
      )}
      <BodyPointLocator
        open={locating !== null}
        onClose={() => setLocating(null)}
        onSave={(p) => locating && savePointAt(locating.alias, p)}
        initial={locating?.point_at ?? null}
        deviceLabel={locating?.alias}
      />
    </SettingsSection>
  )
}
