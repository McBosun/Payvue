import crypto from 'node:crypto';

export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const ref = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

export async function systemAccount(c, accountNumber) {
  const r = await c.query("SELECT id FROM accounts WHERE account_number=$1 AND type='system'", [accountNumber]);
  if (!r.rows[0]) throw new Error(`Missing system account ${accountNumber}`);
  return r.rows[0].id;
}

export async function walletOf(c, userId) {
  const r = await c.query("SELECT * FROM accounts WHERE user_id=$1 AND type='wallet'", [userId]);
  if (!r.rows[0]) throw new AppError(404, 'NO_WALLET', 'Wallet not found');
  return r.rows[0];
}

export async function findByKey(c, userId, key) {
  if (!key) return null;
  const r = await c.query('SELECT * FROM transactions WHERE user_id=$1 AND idempotency_key=$2', [userId, key]);
  return r.rows[0] || null;
}

/**
 * Post one balanced, atomic transaction. entries: [{accountId, amountKobo}] with signed amounts summing to 0.
 * Locks accounts in id order to avoid deadlocks. The DB CHECK on accounts rejects overdrafts.
 */
export async function post(c, { kind, reference, userId = null, idempotencyKey = null, amountKobo, fraudScore = 0, meta = {}, entries }) {
  if (!Number.isInteger(amountKobo) || amountKobo <= 0) throw new AppError(400, 'BAD_AMOUNT', 'Amount must be a positive whole number of kobo');
  if (entries.reduce((s, e) => s + e.amountKobo, 0) !== 0) throw new Error('Unbalanced entries');
  const ids = [...new Set(entries.map((e) => e.accountId))].sort();
  await c.query('SELECT id FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids]);
  const t = await c.query(
    `INSERT INTO transactions(kind, reference, user_id, idempotency_key, amount_kobo, fraud_score, meta)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [kind, reference, userId, idempotencyKey, amountKobo, fraudScore, meta]
  );
  for (const e of entries) {
    try {
      await c.query('UPDATE accounts SET balance_kobo = balance_kobo + $2 WHERE id=$1', [e.accountId, e.amountKobo]);
    } catch (err) {
      if (err.code === '23514') throw new AppError(422, 'INSUFFICIENT_FUNDS', 'Insufficient funds');
      throw err;
    }
    await c.query('INSERT INTO ledger_entries(transaction_id, account_id, amount_kobo) VALUES($1,$2,$3)', [t.rows[0].id, e.accountId, e.amountKobo]);
  }
  return t.rows[0];
}

/** Move money between two accounts. */
export const move = (c, from, to, opts) =>
  post(c, { ...opts, entries: [{ accountId: from, amountKobo: -opts.amountKobo }, { accountId: to, amountKobo: opts.amountKobo }] });
