import { Router } from 'express';
import { pool, tx } from '../db.js';
import { AppError, move, ref, walletOf } from '../ledger.js';
import { requireAuth } from '../services/auth2.js';

export const savingsRoutes = Router();
savingsRoutes.use(requireAuth);

savingsRoutes.get('/', async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT g.id, g.name, g.target_kobo, g.locked, a.balance_kobo AS saved_kobo
         FROM savings_goals g JOIN accounts a ON a.id=g.account_id WHERE g.user_id=$1 ORDER BY g.created_at`, [req.userId]);
    res.json(r.rows.map((g) => ({ ...g, target_kobo: Number(g.target_kobo), saved_kobo: Number(g.saved_kobo) })));
  } catch (e) { next(e); }
});

savingsRoutes.post('/', async (req, res, next) => {
  try {
    const { name, target_kobo } = req.body || {};
    if (!name || !Number.isInteger(target_kobo) || target_kobo <= 0) throw new AppError(400, 'BAD_INPUT', 'Provide a name and a target in kobo');
    const g = await tx(async (c) => {
      const a = await c.query("INSERT INTO accounts(user_id, type, name, account_number) VALUES($1,'savings',$2,$3) RETURNING id",
        [req.userId, name, `SAV-${ref('x').slice(-10)}`]);
      return (await c.query('INSERT INTO savings_goals(user_id, account_id, name, target_kobo) VALUES($1,$2,$3,$4) RETURNING *', [req.userId, a.rows[0].id, name, target_kobo])).rows[0];
    });
    res.status(201).json(g);
  } catch (e) { next(e); }
});

async function goalMove(req, res, next, direction) {
  try {
    const key = req.get('idempotency-key');
    const amountKobo = req.body?.amount_kobo;
    const out = await tx(async (c) => {
      const g = (await c.query('SELECT g.*, a.balance_kobo FROM savings_goals g JOIN accounts a ON a.id=g.account_id WHERE g.id=$1 AND g.user_id=$2', [req.params.id, req.userId])).rows[0];
      if (!g) throw new AppError(404, 'NOT_FOUND', 'Goal not found');
      const w = await walletOf(c, req.userId);
      if (direction === 'withdraw' && g.locked && Number(g.balance_kobo) < Number(g.target_kobo)) {
        throw new AppError(403, 'GOAL_LOCKED', 'This goal is locked until you reach the target');
      }
      const [from, to] = direction === 'deposit' ? [w.id, g.account_id] : [g.account_id, w.id];
      return move(c, from, to, { kind: `savings_${direction}`, reference: ref('sav'), userId: req.userId, idempotencyKey: key || null, amountKobo, meta: { goal: g.id } });
    });
    res.status(201).json(out);
  } catch (e) { next(e); }
}
savingsRoutes.post('/:id/deposit', (q, s, n) => goalMove(q, s, n, 'deposit'));
savingsRoutes.post('/:id/withdraw', (q, s, n) => goalMove(q, s, n, 'withdraw'));
