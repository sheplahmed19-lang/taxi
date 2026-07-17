/**
 * Money is always stored/passed as an integer in minor units (e.g. piastres/cents).
 * Never use floating point for money.
 */
export type MinorUnits = number;

export function addMoney(a: MinorUnits, b: MinorUnits): MinorUnits {
  return a + b;
}

export function subMoney(a: MinorUnits, b: MinorUnits): MinorUnits {
  return a - b;
}

export function isNonNegative(amount: MinorUnits): boolean {
  return Number.isInteger(amount) && amount >= 0;
}
