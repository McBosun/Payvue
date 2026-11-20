import { Router } from 'express';
import { pool, tx } from '../db.js';
import { AppError, move, ref, systemAccount, walletOf } from '../ledger.js';
import { requireAuth } from '../services/auth2.js';
import { transfer } from '../services/transfer.js';

export const walletRoutes = Router();
walletRoutes.use(requireAuth);

walletRoutes.get('/', async (req, res, next) => {
  try {
    const w = await walletOf(pool, req.userId);
    res.json({ accountNumber: w.account_number, balanceKobo: Number(w.balance_kobo) });
  } catch (e) { next(e); }
});

walletRoutes.get('/transactions', async (req, res, next) => {
  try {
    const w = await walletOf(pool, req.userId);
    const r = await pool.query(
      `SELECT t.id, t.kind, t.reference, le.amount_kobo, t.meta, t.created_at
         FROM ledger_entries le JOIN transactions t ON t.id=le.transaction_id
        WHERE le.account_id=$1 ORDER BY le.id DESC LIMIT 50`, [w.id]);
    res.json(r.rows.map((x) => ({ ...x, amount_kobo: Number(x.amount_kobo) })));
  } catch (e) { next(e); }
});

walletRoutes.post('/transfer', async (req, res, next) => {
  try {
    const { to_account_number, amount_kobo, narration, pin } = req.body || {};
    const r = await transfer(req.userId, {
      toAccountNumber: String(to_account_number || ''), amountKobo: amount_kobo, narration, pin,
      idempotencyKey: req.get('idempotency-key'), deviceId: req.get('x-device-id'),
    });
    const code = { completed: 201, duplicate: 200, step_up_required: 403, blocked: 403 }[r.status];
    res.status(code).json(r);
  } catch (e) { next(e); }
});

// Dev only: credit the wallet from the settlement account. Real funding arrives through /webhooks/funding.
walletRoutes.post('/dev-fund', async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') throw new AppError(404, 'NOT_FOUND', 'Not found');
    const amountKobo = req.body?.amount_kobo;
    await tx(async (c) => move(c, await systemAccount(c, 'SYS-SETTLEMENT'), (await walletOf(c, req.userId)).id, { kind: 'dev_fund', reference: ref('dev'), userId: req.userId, amountKobo }));
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});
