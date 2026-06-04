import { createContext, useContext } from 'react'

export interface Capabilities {
  apiBase: string                          // '/api/body' for JarvYZ-embedded; '' for standalone
  deployTarget: 'jarvis' | 'standalone'
}

export const DEFAULT_CAPABILITIES: Capabilities = {
  apiBase: '',
  deployTarget: 'jarvis',
}

export const CapabilitiesContext = createContext<Capabilities>(DEFAULT_CAPABILITIES)

export const useCapabilities = () => useContext(CapabilitiesContext)
