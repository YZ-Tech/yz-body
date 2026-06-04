/** Store barrel — keeps the copied `from '../store'` / `from '../../store'`
 *  imports valid. The store is the default export of `useStore.ts`;
 *  re-exported here as a named `useStore` (matching the host's shape). */

export { default as useStore, type IStore } from './useStore'
export type { Mode } from './storeMode'
export type { WLEDDeviceState } from './storeWLED'
