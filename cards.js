import { Router } from 'express';
import { pool } from '../db.js';
import { AppError } from '../ledger.js';
import { requireAuth } from '../services/auth2.js';

export const cardsRoutes = Router();
cardsRoutes.use(requireAuth);

// Sandbox issuing: store only the last 4 digits. Real PANs stay with the issuer (Sudo, Graph, Flutterwave); never store them.
cardsRoutes.post('/', async (req, res, next) => {
  try {
    const last4 = String(Math.floor(1000 + Math.random() * 9000));
    const r = await pool.query('INSERT INTO cards(user_id, last4, provider_ref) VALUES($1,$2,$3) RETURNING id, last4, currency, status', [req.userId, last4, 'sandbox']);
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

cardsRoutes.get('/', async (req, res, next) => {
  try { res.json((await pool.query('SELECT id, last4, currency, status FROM cards WHERE user_id=$1', [req.userId])).rows); } catch (e) { next(e); }
});

for (const [path, status] of [['freeze', 'frozen'], ['unfreeze', 'active']]) {
  cardsRoutes.post(`/:id/${path}`, async (req, res, next) => {
    try {
      const r = await pool.query('UPDATE cards SET status=$3 WHERE id=$1 AND user_id=$2 RETURNING id, last4, status', [req.params.id, req.userId, status]);
      if (!r.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Card not found');
      res.json(r.rows[0]);
    } catch (e) { next(e); }
  });
}
