/**
 * Rule-based fraud scoring. Pure function so it is easy to test and later swap for an ML model.
 * Returns { score 0-100, decision: allow | step_up | block, reasons[] }.
 */
export const THRESHOLDS = { stepUp: 40, block: 75 };

export function scoreTransfer({ amountKobo, balanceKobo, isNewPayee, isNewDevice, hourLagos, transfersLastHour }) {
  let score = 0;
  const reasons = [];
  const add = (n, why) => { score += n; reasons.push(why); };

  const share = balanceKobo > 0 ? amountKobo / balanceKobo : 1;
  if (share >= 0.9) add(30, 'drains most of the balance');
  else if (share >= 0.5) add(20, 'large share of balance');
  if (amountKobo >= 10_000_000) add(20, 'amount of N100,000 or more');
  if (isNewPayee) add(20, 'first transfer to this payee');
  if (isNewDevice) add(30, 'unrecognised device');
  if (hourLagos >= 0 && hourLagos < 5) add(10, 'unusual hour');
  if (transfersLastHour >= 5) add(25, 'many transfers in the last hour');

  score = Math.min(score, 100);
  const decision = score >= THRESHOLDS.block ? 'block' : score >= THRESHOLDS.stepUp ? 'step_up' : 'allow';
  return { score, decision, reasons };
}
