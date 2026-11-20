import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../src/services/assistant2.js';

test('parses a transfer', () => {
  const p = parseCommand('Send ₦5,000 to Tunde');
  assert.equal(p.intent, 'transfer');
  assert.equal(p.amountKobo, 500_000);
  assert.equal(p.recipient, 'tunde');
  assert.equal(p.needsConfirmation, true);
});
test('parses k shorthand airtime', () => {
  const p = parseCommand('buy 2k airtime');
  assert.equal(p.intent, 'bill');
  assert.equal(p.amountKobo, 200_000);
});
test('unknown text proposes nothing', () => {
  assert.equal(parseCommand('hello there').intent, 'unknown');
});
