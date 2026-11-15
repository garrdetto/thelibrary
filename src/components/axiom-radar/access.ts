import { createContext, useContext } from 'react'

export type RadarAccess = { canEdit: boolean }

/** Anyone can watch the Radar. Only the administrator can pin coins, save settings or control the bot. */
export const RadarAccessContext = createContext<RadarAccess>({ canEdit: false })

export const useRadarAccess = () => useContext(RadarAccessContext)
