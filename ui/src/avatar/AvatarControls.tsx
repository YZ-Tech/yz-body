import FaceIcon from '@mui/icons-material/Face'
import FullscreenIcon from '@mui/icons-material/Fullscreen'
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit'
import HomeIcon from '@mui/icons-material/Home'
import SettingsIcon from '@mui/icons-material/Settings'
import { Stack } from '@mui/material'
import {
  useEffect,
  useState,
  type MouseEvent,
  type MutableRefObject,
  type RefObject,
} from 'react'
import { IconBtn } from '../components/IconBtn'
import { useBodyCameraPresets } from '../hooks/useBodyCameraPresets'
import { useStore } from '../store'

interface Props {
  /** The element to fullscreen — usually BodyAvatar's outer Paper. */
  containerRef: RefObject<HTMLElement | null>
  /** Imperative ref filled in by BodyAvatar's scene effect; called on
   *  left-click to tween the camera to a saved preset. */
  resetCameraRef: MutableRefObject<(mode: 'home' | 'face') => void>
  /** Reads the current camera pos + orbit target world coords; called
   *  on right-click to capture the user's view as a new preset. */
  getCameraStateRef: MutableRefObject<() => {
    pos: [number, number, number]
    target: [number, number, number]
  }>
}

/** Top-right action cluster: Home / Face / Settings / Fullscreen.
 *  Hidden by default, fades in on hover. Right-click on Home/Face saves
 *  the current camera view as that preset.
 *
 *  Owns the fullscreen state + listener locally (Avatar.tsx uses the
 *  CSS `:fullscreen` pseudo-class for its layout, so the state doesn't
 *  need to leave this component). Camera reset/save is driven through
 *  refs assigned by Avatar's scene effect. */
export function AvatarControls({
  containerRef,
  resetCameraRef,
  getCameraStateRef,
}: Props) {
  const setBodySettingsOpen = useStore((s) => s.setBodySettingsOpen)
  const cameraPresetsApi = useBodyCameraPresets()

  const [isFullscreen, setIsFullscreen] = useState(false)
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [containerRef])
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      containerRef.current?.requestFullscreen()
    }
  }

  return (
    <Stack
      direction="row"
      spacing={0.5}
      sx={{
        position: 'absolute',
        top: 8,
        right: 8,
        bgcolor: 'rgba(4, 6, 14, 0.55)',
        backdropFilter: 'blur(6px)',
        borderRadius: 1,
        p: 0.25,
        opacity: 0,
        transition: 'opacity 180ms ease',
        '&:hover': { opacity: 1 },
      }}
    >
      <IconBtn
        label="Reset view (full body) — right-click to save current view as Home"
        onClick={() => resetCameraRef.current?.('home')}
        onContextMenu={(e: MouseEvent) => {
          e.preventDefault()
          const s = getCameraStateRef.current?.()
          if (s) cameraPresetsApi.setPreset('home', s)
        }}
        sx={{ color: '#cfd6e6' }}
        icon={<HomeIcon />}
      />
      <IconBtn
        label="Zoom to face — right-click to save current view as Face"
        onClick={() => resetCameraRef.current?.('face')}
        onContextMenu={(e: MouseEvent) => {
          e.preventDefault()
          const s = getCameraStateRef.current?.()
          if (s) cameraPresetsApi.setPreset('face', s)
        }}
        sx={{ color: '#cfd6e6' }}
        icon={<FaceIcon />}
      />
      <IconBtn
        label="Settings"
        onClick={() => setBodySettingsOpen(true)}
        sx={{ color: '#cfd6e6' }}
        icon={<SettingsIcon />}
      />
      <IconBtn
        label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        onClick={toggleFullscreen}
        sx={{ color: '#cfd6e6' }}
        icon={isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
      />
    </Stack>
  )
}
