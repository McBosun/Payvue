import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreTransfer } from '../src/services/fraud.js';

const base = { amountKobo: 100_000, balanceKobo: 10_000_000, isNewPayee: false, isNewDevice: false, hourLagos: 14, transfersLastHour: 0 };

test('small trusted transfer is allowed', () => {
  assert.equal(scoreTransfer(base).decision, 'allow');
});
test('new payee with large share of balance needs step-up', () => {
  const r = scoreTransfer({ ...base, amountKobo: 6_000_000, isNewPayee: true });
  assert.equal(r.decision, 'step_up');
});
test('new device + new payee + draining balance is blocked', () => {
  const r = scoreTransfer({ ...base, amountKobo: 9_800_000, isNewPayee: true, isNewDevice: true });
  assert.equal(r.decision, 'block');
  assert.ok(r.reasons.length >= 3);
});
test('score is capped at 100', () => {
  const r = scoreTransfer({ amountKobo: 50_000_000, balanceKobo: 50_000_000, isNewPayee: true, isNewDevice: true, hourLagos: 2, transfersLastHour: 9 });
  assert.equal(r.score, 100);
});
