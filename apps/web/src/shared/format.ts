/** Money is always integer minor units end-to-end (see CLAUDE.md rule 3 / apps/api's shared/money.ts). */
export function formatMoney(minorUnits: number): string {
  return (minorUnits / 100).toFixed(2);
}
