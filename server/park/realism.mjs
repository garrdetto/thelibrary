export const REALISM_MAX_LOAN = 150000
export const REALISM_RIDE_COST = 5

export function rideCostScale(state) {
  return state?.realism === true ? REALISM_RIDE_COST : 1
}
