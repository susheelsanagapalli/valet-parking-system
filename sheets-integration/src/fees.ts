import type { Tariff } from './settings.js';

const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;

/** Fee for a number of parked minutes under a tariff (FR-PAY-01, FR-PAY-02). */
export function feeForMinutes(tariff: Tariff, minutes: number): number {
  const total = Math.max(0, Math.ceil(minutes));
  if (tariff.type === 'complimentary') return 0;
  if (total <= tariff.freeMinutes && tariff.freeMinutes > 0) return 0;
  if (tariff.type === 'flat') return tariff.rate;

  const billable = Math.max(0, total - tariff.freeMinutes);
  const hourlyFee = (mins: number) => Math.ceil(mins / 60) * tariff.rate;
  if (tariff.dailyCap === undefined) return hourlyFee(billable);

  const fullDays = Math.floor(billable / DAY_MINUTES);
  const remainder = billable - fullDays * DAY_MINUTES;
  return fullDays * tariff.dailyCap + Math.min(hourlyFee(remainder), tariff.dailyCap);
}

/** Minutes between two ISO timestamps, minus any excluded periods (e.g. time out on an in-and-out ticket). */
export function chargeableMinutes(fromIso: string, toIso: string, excluded: Array<{ from: string; to: string }> = []): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  let ms = Math.max(0, to - from);
  for (const p of excluded) {
    const start = Math.max(from, Date.parse(p.from));
    const end = Math.min(to, Date.parse(p.to));
    if (end > start) ms -= end - start;
  }
  return ms / MINUTE;
}
