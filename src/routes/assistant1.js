import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../services/auth2.js';
import { parseCommand } from '../services/assistant2.js';

export const assistantRoutes = Router();
assistantRoutes.use(requireAuth);

// Returns a proposed action. The client shows it for confirmation, then calls the real endpoint.
assistantRoutes.post('/parse', async (req, res, next) => {
  try {
    const p = parseCommand(req.body?.text);
    if (p.intent === 'transfer') {
      const b = await pool.query('SELECT account_number, name FROM beneficiaries WHERE user_id=$1 AND lower(name) LIKE $2 LIMIT 3', [req.userId, `%${p.recipient}%`]);
      p.matches = b.rows;
    }
    res.json(p);
  } catch (e) { next(e); }
});
