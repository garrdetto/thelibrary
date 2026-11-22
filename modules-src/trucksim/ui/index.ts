/**
 * Public surface of Truck Simulator's interface layer: the HUD, the panels, the shop screens and the lot builder bar. Import the
 * stylesheet once with `import './ui/styles.css'`.
 */
export { Hud } from './Hud'
export type { GaugeValues, JobView, MinimapDraw, ToastKind } from './Hud'
export { HELP_SECTIONS, SITE_KIND_COLORS, openHelp, openJobBoard, openMap, openPause, showStart } from './Panels'
export type { JobBoardHandle, JobBoardOptions, MapHandle, MapOptions, PanelHandle, PanelOptions, PauseOptions, QualityTier, StartOptions } from './Panels'
export { openDealer, openFleet, openGarage } from './Shop'
export type { DealerOptions, FleetOptions, GarageOptions, UpdatableHandle } from './Shop'
export { BuilderBar, costUnit } from './BuilderBar'
export type { BuilderBarOptions } from './BuilderBar'
export { money } from './dom'
