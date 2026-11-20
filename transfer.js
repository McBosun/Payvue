import { tx, pool } from '../db.js';
import { AppError, findByKey, move, ref, walletOf } from '../ledger.js';
import { scoreTransfer } from './fraud.js';
import { verifyPin } from './auth2.js';

const DAILY_LIMIT_KOBO = { 1: 5_000_000, 2: 20_000_000, 3: 500_000_000 }; // N50k, N200k, N5m by KYC tier

const lagosHour = () => parseInt(new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lagos', hour: 'numeric', hour12: false }), 10) % 24;

export async function transfer(userId, { toAccountNumber, amountKobo, idempotencyKey, deviceId, narration, pin }) {
  if (!idempotencyKey) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header');
  try {
    return await tx(async (c) => {
      const existing = await findByKey(c, userId, idempotencyKey);
      if (existing) return { status: 'duplicate', transaction: existing };

      const from = await walletOf(c, userId);
      const toRes = await c.query("SELECT * FROM accounts WHERE account_number=$1 AND type='wallet'", [toAccountNumber]);
      const to = toRes.rows[0];
      if (!to) throw new AppError(404, 'PAYEE_NOT_FOUND', 'No wallet with that account number');
      if (to.id === from.id) throw new AppError(400, 'SELF_TRANSFER', 'You cannot send money to yourself');

      const user = (await c.query('SELECT kyc_tier FROM users WHERE id=$1', [userId])).rows[0];
      const sent = await c.query(
        `SELECT COALESCE(SUM(-le.amount_kobo),0)::bigint AS s, COUNT(DISTINCT t.id)::int AS n
           FROM ledger_entries le JOIN transactions t ON t.id=le.transaction_id
          WHERE le.account_id=$1 AND le.amount_kobo<0 AND t.kind='transfer' AND t.created_at > now() - interval '24 hours'`,
        [from.id]
      );
      if (Number(sent.rows[0].s) + amountKobo > DAILY_LIMIT_KOBO[user.kyc_tier]) {
        throw new AppError(403, 'LIMIT_EXCEEDED', 'Daily limit reached for your verification level');
      }
      const lastHour = await c.query(
        "SELECT COUNT(*)::int AS n FROM transactions WHERE user_id=$1 AND kind='transfer' AND created_at > now() - interval '1 hour'", [userId]);
      const payee = await c.query('SELECT 1 FROM beneficiaries WHERE user_id=$1 AND account_number=$2', [userId, toAccountNumber]);
      const device = deviceId ? await c.query('SELECT 1 FROM devices WHERE user_id=$1 AND device_id=$2', [userId, deviceId]) : { rowCount: 0 };

      const risk = scoreTransfer({
        amountKobo, balanceKobo: Number(from.balance_kobo), isNewPayee: payee.rowCount === 0,
        isNewDevice: device.rowCount === 0, hourLagos: lagosHour(), transfersLastHour: lastHour.rows[0].n,
      });
      await c.query('INSERT INTO fraud_events(user_id, score, decision, reasons, amount_kobo) VALUES($1,$2,$3,$4,$5)',
        [userId, risk.score, risk.decision, JSON.stringify(risk.reasons), amountKobo]);

      if (risk.decision === 'block') return { status: 'blocked', risk };
      if (risk.decision === 'step_up') {
        if (!pin) return { status: 'step_up_required', risk };
        await verifyPin(c, userId, pin);
      }

      const t = await move(c, from.id, to.id, {
        kind: 'transfer', reference: ref('trf'), userId, idempotencyKey, amountKobo, fraudScore: risk.score,
        meta: { narration: narration || null, to: toAccountNumber },
      });
      await c.query('INSERT INTO beneficiaries(user_id, account_number, name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [userId, toAccountNumber, to.name]);
      if (deviceId) await c.query('INSERT INTO devices(user_id, device_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [userId, deviceId]);
      return { status: 'completed', transaction: t, risk };
    });
  } catch (e) {
    if (e.code === '23505') { // concurrent duplicate with the same idempotency key
      const t = await pool.query('SELECT * FROM transactions WHERE user_id=$1 AND idempotency_key=$2', [userId, idempotencyKey]);
      if (t.rows[0]) return { status: 'duplicate', transaction: t.rows[0] };
    }
    throw e;
  }
}
