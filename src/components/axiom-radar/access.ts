import { createContext, useContext } from 'react'

export type RadarAccess = { canEdit: boolean }

/** The owner, and accounts granted `axiom-radar`, can watch the Radar. Only the owner can pin coins, save settings or control the bot. */
export const RadarAccessContext = createContext<RadarAccess>({ canEdit: false })

export const useRadarAccess = () => useContext(RadarAccessContext)
