/** Economy tuning shared by server authority and client UI. */
export const START_MONEY = 35_000;
export const LOT_PRICE = 20_000;

/** Hard ceiling on total outstanding debt per player. */
export const LOAN_CAP = 50_000;
/** Interest charged once per in-game day on outstanding debt. */
export const LOAN_DAILY_RATE = 0.02;

export const MOW_PAY_PER_M2 = 0.75;     // paid only for lawns you don't own
export const DELIVERY_BASE_PAY = 350;
export const DELIVERY_PAY_PER_M = 2.2;

export const COST = {
  wall: 75,          // per 1 m wall segment
  door: 320,
  window: 260,
  picture: 540,
  floorPerCell: 18,
  roofPerM2: 32,
  refundRate: 0.5,   // fraction returned when deleting
};

export interface Account {
  id: string;        // public id: stored as lot owner, safe to broadcast
  key: string;       // secret identity token, only ever sent back to its owner
  name: string;
  color: string;
  money: number;
  debt: number;
  earned: number;    // lifetime earnings, used to underwrite credit
}

/**
 * Credit limit: grows with proven income but never exceeds LOAN_CAP total.
 * Returns how much MORE the player may borrow right now.
 */
export function availableCredit(a: Account): number {
  const limit = Math.min(LOAN_CAP, 10_000 + a.earned * 2);
  return Math.max(0, Math.floor(limit - a.debt));
}
