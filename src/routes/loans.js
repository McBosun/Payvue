import { Router } from 'express';
import { pool, tx } from '../db.js';
import { AppError, move, ref, systemAccount, walletOf } from '../ledger.js';
import { requireAuth } from '../services/auth2.js';

export const loansRoutes = Router();
loansRoutes.use(requireAuth);
const FEE = 0.05;
const MAX_KOBO = 20_000_000; // N200,000 starter cap

/** Starter credit rule: 25% of money received in the last 90 days, capped. Replace with a trained model later. */
async function limitFor(c, userId) {
  const w = await walletOf(c, userId);
  const r = await c.query(
    `SELECT COALESCE(SUM(amount_kobo),0)::bigint AS inflow FROM ledger_entries
      WHERE account_id=$1 AND amount_kobo>0 AND created_at > now() - interval '90 days'`, [w.id]);
  return Math.min(MAX_KOBO, Math.floor(Number(r.rows[0].inflow) * 0.25));
}

loansRoutes.get('/eligibility', async (req, res, next) => {
  try {
    const active = await pool.query("SELECT 1 FROM loans WHERE user_id=$1 AND status<>'repaid'", [req.userId]);
    res.json({ limitKobo: active.rowCount ? 0 : await limitFor(pool, req.userId), feeRate: FEE });
  } catch (e) { next(e); }
});

loansRoutes.post('/', async (req, res, next) => {
  try {
    const amountKobo = req.body?.amount_kobo;
    const loan = await tx(async (c) => {
      await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [req.userId]);
      if ((await c.query("SELECT 1 FROM loans WHERE user_id=$1 AND status<>'repaid'", [req.userId])).rowCount) throw new AppError(409, 'LOAN_ACTIVE', 'Repay your current loan first');
      if (!Number.isInteger(amountKobo) || amountKobo <= 0 || amountKobo > (await limitFor(c, req.userId))) throw new AppError(422, 'OVER_LIMIT', 'Amount is above your limit');
      const l = (await c.query("INSERT INTO loans(user_id, principal_kobo, fee_kobo, due_at) VALUES($1,$2,$3, now() + interval '30 days') RETURNING *", [req.userId, amountKobo, Math.round(amountKobo * FEE)])).rows[0];
      await move(c, await systemAccount(c, 'SYS-LOANPOOL'), (await walletOf(c, req.userId)).id, { kind: 'loan_disbursement', reference: ref('lon'), userId: req.userId, amountKobo, meta: { loan: l.id } });
      return l;
    });
    res.status(201).json(loan);
  } catch (e) { next(e); }
});

loansRoutes.post('/repay', async (req, res, next) => {
  try {
    const out = await tx(async (c) => {
      const l = (await c.query("SELECT * FROM loans WHERE user_id=$1 AND status<>'repaid' FOR UPDATE", [req.userId])).rows[0];
      if (!l) throw new AppError(404, 'NO_LOAN', 'No active loan');
      const owed = Number(l.principal_kobo) + Number(l.fee_kobo) - Number(l.repaid_kobo);
      const w = await walletOf(c, req.userId);
      await move(c, w.id, await systemAccount(c, 'SYS-LOANPOOL'), { kind: 'loan_repayment', reference: ref('lrp'), userId: req.userId, amountKobo: Number(l.principal_kobo), meta: { loan: l.id } });
      await move(c, w.id, await systemAccount(c, 'SYS-FEES'), { kind: 'loan_fee', reference: ref('lfe'), userId: req.userId, amountKobo: Number(l.fee_kobo), meta: { loan: l.id } });
      await c.query("UPDATE loans SET repaid_kobo=$2, status='repaid' WHERE id=$1", [l.id, owed + Number(l.repaid_kobo)]);
      return { repaidKobo: owed };
    });
    res.json(out);
  } catch (e) { next(e); }
});
