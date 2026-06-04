// Lib (IIFE) entry. The IIFE attaches these exports to `window.YzBody`;
// JarvYZ loads it via @yz-dev/react-dynamic-module and looks up
// `createSatelliteApi` (api factory) + `BodyDashboard` (the variant-13
// component) by name.

export { BodyDashboard } from './BodyDashboard'
export type { BodyDashboardProps } from './BodyDashboard'
export { createSatelliteApi, NotSupportedError } from './lib/api'
export type { BodyApi, SatelliteSettings } from './lib/api'
export type { WSApi } from './lib/ws'
export type { Capabilities } from './lib/capabilities'
