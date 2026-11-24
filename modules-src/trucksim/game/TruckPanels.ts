/**
 * The job board, dealer, fleet and garage panels wired to a career and a session, shared by every host (the standalone county
 * page and Truck Simulator on Montello). The host decides when a panel may open (`open`) and what happens when it closes.
 */
import type { ProgressClient } from '../net/Progress'
import { truckResale } from '../shared/Actions'
import { FUEL_PRICE_PER_L, REPAIR_COST_PER_POINT, RESALE_SHARE, TRAILER_BY_ID, TRUCK_BY_ID, lookCost } from '../shared/Catalog'
import { FUEL_STATION_MARKUP, REPAIR_LABOUR_MARKUP } from '../shared/Economy'
import type { HaulWorld } from '../shared/HaulWorld'
import { generateJobs, jobSlot } from '../shared/Jobs'
import { hasService } from '../shared/Lots'
import type { LotSpec } from '../shared/WorldLayout'
import { openJobBoard } from '../ui/Panels'
import type { PanelHandle } from '../ui/Panels'
import { openDealer, openFleet, openGarage } from '../ui/Shop'
import type { ToastKind } from './TruckHost'
import type { TruckSession } from './TruckSession'

export interface PanelContext {
  readonly uiRoot: HTMLElement
  readonly progress: ProgressClient
  readonly world: HaulWorld
  session(): TruckSession
  toast(text: string, kind?: ToastKind): void
  /** Opens a panel unless another panel or mode has the screen. */
  open(make: () => PanelHandle): void
  /** Called when a panel closes. */
  closed(): void
  lotFor(index: number | null): LotSpec | null
}

export class TruckPanels {
  constructor(private readonly ctx: PanelContext) {}

  private get progress(): ProgressClient {
    return this.ctx.progress
  }

  /** True on a service bay or on your own lot with a shop, where repairs cost no labour markup. */
  atServiceOrShop(): boolean {
    const p = this.ctx.session().rigPosition()
    const lot = this.ctx.lotFor(this.progress.profile.lot)
    if (lot && hasService(this.progress.profile.build) && p.x >= lot.x && p.x <= lot.x + lot.w && p.z >= lot.z && p.z <= lot.z + lot.d) return true
    return this.ctx.world.zones.some((zone) => zone.kind === 'service' && Math.abs(p.x - zone.x) < zone.w / 2 + 6 && Math.abs(p.z - zone.z) < zone.d / 2 + 6)
  }

  jobBoard(): void {
    const { world } = this.ctx
    const siteName = (id: string) => {
      const zone = world.zone(id)
      return zone ? `${world.site(zone.site)?.name ?? zone.site} · ${zone.label}` : id
    }
    this.ctx.open(() => {
      const board = openJobBoard(this.ctx.uiRoot, {
        jobs: generateJobs(world, jobSlot(Date.now())),
        profile: this.progress.profile,
        canTake: (job) => this.ctx.session().canTake(job),
        siteName,
        onAccept: async (job) => {
          const result = await this.progress.act({ action: 'accept-job', job: job.id })
          this.ctx.toast(result.message || (result.ok ? 'Job accepted' : 'Could not take that job'), result.ok ? 'good' : 'warn')
          if (result.ok) board.close()
          else board.update(this.progress.profile)
        },
        onAbandon: async () => {
          const result = await this.progress.act({ action: 'abandon-job' })
          this.ctx.toast(result.message || 'Job abandoned', result.ok ? 'info' : 'warn')
          board.update(this.progress.profile)
        },
        onClose: () => this.ctx.closed(),
      })
      return board
    })
  }

  dealer(): void {
    this.ctx.open(() => {
      const dealer = openDealer(this.ctx.uiRoot, {
        profile: this.progress.profile,
        onBuyTruck: async (model, look) => {
          const result = await this.progress.act({ action: 'buy-truck', model, look })
          this.ctx.toast(result.message || (result.ok ? 'Bought! It is waiting at your lot' : 'Could not buy that'), result.ok ? 'good' : 'warn')
          dealer.update(this.progress.profile)
        },
        onBuyTrailer: async (model) => {
          const result = await this.progress.act({ action: 'buy-trailer', model })
          this.ctx.toast(result.message || (result.ok ? 'Bought! It is waiting at your lot' : 'Could not buy that'), result.ok ? 'good' : 'warn')
          dealer.update(this.progress.profile)
        },
        onClose: () => this.ctx.closed(),
      })
      return dealer
    })
  }

  fleet(): void {
    const profile = () => this.progress.profile
    const shop = () => hasService(profile().build)
    this.ctx.open(() => {
      const fleet = openFleet(this.ctx.uiRoot, {
        profile: profile(),
        onSelect: async (truck, trailer) => {
          const result = await this.progress.act({ action: 'select', truck, trailer })
          this.ctx.toast(result.message || (result.ok ? 'Your rig is ready at the lot' : 'Could not switch rigs'), result.ok ? 'good' : 'warn')
          fleet.update(profile())
        },
        onSell: async (kind, uid) => {
          const result = await this.progress.act(kind === 'truck' ? { action: 'sell-truck', uid } : { action: 'sell-trailer', uid })
          this.ctx.toast(result.message || (result.ok ? 'Sold' : 'Could not sell that'), result.ok ? 'good' : 'warn')
          fleet.update(profile())
        },
        onRepair: async (uid) => {
          if (!this.atServiceOrShop()) {
            this.ctx.toast('Drive to a service bay or a shop on your lot for repairs', 'warn')
            return
          }
          const result = await this.progress.act({ action: 'repair', uid })
          this.ctx.toast(result.message || (result.ok ? 'Repaired' : 'Could not repair'), result.ok ? 'good' : 'warn')
          fleet.update(profile())
        },
        onRefuel: () => this.ctx.toast('Pull into a fuel lane (or your own fuel island) and press E', 'info'),
        onCustomise: (uid) => {
          if (uid !== profile().activeTruck) {
            this.ctx.toast('Select that truck first, then customise it', 'info')
            return
          }
          fleet.close()
          this.garage()
        },
        repairCost: (uid) => {
          const truck = profile().trucks.find((t) => t.uid === uid)
          const trailer = profile().trailers.find((t) => t.uid === uid)
          const damage = truck?.damage ?? trailer?.damage ?? 0
          return Math.round(damage * REPAIR_COST_PER_POINT * (shop() ? 1 : REPAIR_LABOUR_MARKUP))
        },
        refuelCost: (uid) => {
          const truck = profile().trucks.find((t) => t.uid === uid)
          const model = truck ? TRUCK_BY_ID[truck.model] : null
          return truck && model ? Math.round(Math.max(0, model.fuelTankL - truck.fuelL) * FUEL_PRICE_PER_L * FUEL_STATION_MARKUP) : 0
        },
        sellValue: (kind, uid) => {
          if (kind === 'truck') {
            const truck = profile().trucks.find((t) => t.uid === uid)
            const model = truck ? TRUCK_BY_ID[truck.model] : null
            return truck && model ? truckResale(model.price, truck.damage) : 0
          }
          const trailer = profile().trailers.find((t) => t.uid === uid)
          const model = trailer ? TRAILER_BY_ID[trailer.model] : null
          return trailer && model ? Math.round(model.price * RESALE_SHARE * (1 - trailer.damage / 200)) : 0
        },
        onClose: () => this.ctx.closed(),
      })
      return fleet
    })
  }

  garage(): void {
    const profile = this.progress.profile
    const truck = profile.trucks.find((t) => t.uid === profile.activeTruck)
    if (!truck) return
    const session = this.ctx.session()
    this.ctx.open(() => openGarage(this.ctx.uiRoot, {
      profile,
      truck,
      onPreview: (look) => session.previewLook(look),
      price: (look) => lookCost(truck.look, look),
      onSave: async (look) => {
        const result = await this.progress.act({ action: 'customize', uid: truck.uid, look })
        this.ctx.toast(result.message || (result.ok ? 'Fresh look saved' : 'Could not save that look'), result.ok ? 'good' : 'warn')
        session.previewLook(null)
      },
      onClose: () => {
        session.previewLook(null)
        this.ctx.closed()
      },
    }))
  }
}
