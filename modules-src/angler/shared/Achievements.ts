/** Achievements: playtime, driving, species, size, heartbreak and social milestones in up to four tiers, each paying Tackle Credits once. Evaluated from the saved stats, never claimed by the page. */
import type { AnglerProfile } from './Profile'
import { SPECIES, speciesIds, weightAtPercentile } from './Species'
import type { SpeciesId } from './Species'

export type AchievementGroup = 'Playtime' | 'Driving' | 'Species' | 'Size' | 'Heartbreak' | 'Social'

export interface AchievementDef {
  id: string
  name: string
  group: AchievementGroup
  /** Thresholds for tiers 1-4 (fewer for single-tier achievements). */
  tiers: number[]
  rewards: number[]
  describe: (threshold: number) => string
  value: (p: AnglerProfile) => number
}

export const TIER_NAMES = ['Bronze', 'Silver', 'Gold', 'Legend']

const n = (p: AnglerProfile, id: SpeciesId) => p.stats.bySpecies[id]?.n ?? 0
const bestLb = (p: AnglerProfile, id: SpeciesId) => (p.stats.bySpecies[id]?.best ?? 0) / 160

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'hours', name: 'On the Water', group: 'Playtime', tiers: [1, 10, 100, 1000], rewards: [100, 500, 2000, 6000], describe: t => `Fish for ${t} hour${t === 1 ? '' : 's'}`, value: p => p.stats.seconds / 3600 },
  { id: 'nightowl', name: 'Night Owl', group: 'Playtime', tiers: [2, 20, 100, 300], rewards: [150, 600, 2000, 5000], describe: t => `${t} hours on the water after dark`, value: p => p.stats.nightSeconds / 3600 },
  { id: 'seasons', name: 'Four Seasons', group: 'Playtime', tiers: [3, 6, 9, 12], rewards: [200, 500, 1200, 4000], describe: t => `Land fish in ${t} different months`, value: p => p.stats.months.length },
  { id: 'catches', name: 'Full Livewell', group: 'Playtime', tiers: [10, 100, 1000, 10000], rewards: [100, 500, 2500, 10000], describe: t => `Land ${t.toLocaleString()} fish`, value: p => p.stats.landed },
  { id: 'miles', name: 'Shoreline Survey', group: 'Driving', tiers: [5, 25, 100, 500], rewards: [100, 300, 1000, 3000], describe: t => `Drive ${t} miles`, value: p => p.stats.miles },
  { id: 'lakes', name: 'Lake Hopper', group: 'Driving', tiers: [2, 3, 4, 5], rewards: [150, 300, 600, 1500], describe: t => `Fish ${t} different lakes`, value: p => p.stats.lakes.length },
  { id: 'fullcreel', name: 'Full Creel', group: 'Species', tiers: [4, 8, 12, 16], rewards: [200, 600, 1500, 10000], describe: t => `Land ${t} different species`, value: p => speciesIds.filter(id => n(p, id) > 0).length },
  { id: 'panfish', name: 'Panfish Pro', group: 'Species', tiers: [25, 100, 500, 2000], rewards: [100, 400, 1500, 5000], describe: t => `Land ${t} bluegill`, value: p => n(p, 'bluegill') },
  { id: 'walleye', name: 'Marble Eyes', group: 'Species', tiers: [10, 50, 250, 1000], rewards: [150, 600, 2000, 6000], describe: t => `Land ${t} walleye`, value: p => n(p, 'walleye') },
  { id: 'bass', name: 'Bucketmouth', group: 'Species', tiers: [10, 50, 250, 1000], rewards: [150, 600, 2000, 6000], describe: t => `Land ${t} bass of either kind`, value: p => n(p, 'largemouth') + n(p, 'smallmouth') },
  { id: 'esox', name: 'Esox Hunter', group: 'Species', tiers: [1, 3, 10, 25], rewards: [500, 1500, 5000, 15000], describe: t => `Land ${t} musky`, value: p => n(p, 'musky') },
  { id: 'cats', name: 'Bottom Dweller', group: 'Species', tiers: [10, 50, 200, 500], rewards: [150, 600, 2000, 5000], describe: t => `Land ${t} catfish or bullhead`, value: p => n(p, 'channelcat') + n(p, 'flathead') + n(p, 'bullhead') },
  { id: 'fossil', name: 'Living Fossil', group: 'Species', tiers: [1, 2, 5, 10], rewards: [2000, 4000, 10000, 25000], describe: t => `Land ${t} lake sturgeon`, value: p => n(p, 'sturgeon') },
  ...speciesIds.map((id): AchievementDef => ({
    id: `size-${id}`, name: `${SPECIES[id].name} sizes`, group: 'Size',
    tiers: [0.6, 0.9, 0.98, 0.998].map(pct => Math.round(weightAtPercentile(SPECIES[id], pct) * 16) / 16),
    rewards: [50, 200, 1000, 5000],
    describe: t => `Land a ${SPECIES[id].name.toLowerCase()} of ${t >= 1 ? `${t.toFixed(t < 10 ? 2 : 1)} lb` : `${Math.round(t * 16)} oz`}`,
    value: p => bestLb(p, id),
  })),
  { id: 'doubledigits', name: 'Double Digits', group: 'Size', tiers: [10], rewards: [1500], describe: () => 'Land a 10 lb walleye, bass or lake trout', value: p => Math.max(bestLb(p, 'walleye'), bestLb(p, 'largemouth'), bestLb(p, 'smallmouth'), bestLb(p, 'laketrout')) },
  { id: 'fifty', name: 'Fifty Club', group: 'Size', tiers: [50], rewards: [5000], describe: () => 'Land a fish of 50 lb or more', value: p => Math.max(...speciesIds.map(id => bestLb(p, id))) },
  { id: 'trophies', name: 'Trophy Room', group: 'Size', tiers: [1, 5, 25, 100], rewards: [300, 1000, 4000, 12000], describe: t => `Land ${t} Trophy or Legendary fish`, value: p => (p.stats.tiers.Trophy ?? 0) + (p.stats.tiers.Legendary ?? 0) },
  { id: 'records', name: 'Record Holder', group: 'Size', tiers: [1, 5, 20, 50], rewards: [1000, 3000, 8000, 20000], describe: t => `Set ${t} site record${t === 1 ? '' : 's'}`, value: p => p.stats.records },
  { id: 'gotaway', name: 'The One That Got Away', group: 'Heartbreak', tiers: [1, 5], rewards: [200, 800], describe: t => `Lose ${t} Trophy-size fish`, value: p => (p.stats.tiers['lost:Trophy'] ?? 0) + (p.stats.tiers['lost:Legendary'] ?? 0) },
  { id: 'bigmouth', name: 'Big Mouth, Bigger Story', group: 'Heartbreak', tiers: [1, 5], rewards: [200, 800], describe: t => `Lose ${t} fish over 30 lb`, value: p => p.stats.tiers['lost:30lb'] ?? 0 },
  { id: 'missed', name: 'Short Strike', group: 'Heartbreak', tiers: [25, 250], rewards: [100, 500], describe: t => `Miss ${t} bites`, value: p => p.stats.missed },
  { id: 'social', name: 'Boat Party', group: 'Social', tiers: [1, 10, 50, 200], rewards: [300, 800, 2500, 6000], describe: t => `Share a boat with friends ${t} time${t === 1 ? '' : 's'}`, value: p => p.stats.social },
]

export interface Unlock {
  id: string
  name: string
  tier: number
  reward: number
  text: string
}

export function evaluateAchievements(profile: AnglerProfile): Unlock[] {
  const unlocked: Unlock[] = []
  for (const a of ACHIEVEMENTS) {
    const value = a.value(profile)
    const have = profile.achievements[a.id] ?? 0
    let tier = have
    while (tier < a.tiers.length && value >= a.tiers[tier]) tier++
    for (let t = have; t < tier; t++) {
      unlocked.push({ id: a.id, name: a.name, tier: t + 1, reward: a.rewards[t], text: a.describe(a.tiers[t]) })
      profile.tc += a.rewards[t]
      profile.stats.tcEarned += a.rewards[t]
    }
    if (tier > have) profile.achievements[a.id] = tier
  }
  return unlocked
}

export function applyProgress(profile: AnglerProfile, seconds: number, miles: number, night: boolean, social: number): void {
  profile.stats.seconds += seconds
  if (night) profile.stats.nightSeconds += seconds
  profile.stats.miles = Math.round((profile.stats.miles + miles) * 1000) / 1000
  if (social > 0) profile.stats.social += 1
}

export function anglerTitle(profile: AnglerProfile): string {
  const trophies = (profile.stats.tiers.Trophy ?? 0) + (profile.stats.tiers.Legendary ?? 0)
  if (profile.stats.records >= 5 || trophies >= 50) return 'Legend of the Lake'
  if (trophies >= 10) return 'Fishing Guide'
  if (trophies >= 1 || profile.stats.landed >= 250) return 'Weekend Warrior'
  if (profile.stats.landed >= 25) return 'Regular'
  return 'First Cast'
}
