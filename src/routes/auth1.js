import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { pool, tx } from '../db.js';
import { AppError } from '../ledger.js';
import { phoneOk, pinOk, signToken, verifyPin } from '../services/auth2.js';

export const authRoutes = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

async function newAccountNumber(c) {
  for (;;) {
    const n = String(Math.floor(1e9 + Math.random() * 9e9));
    if (!(await c.query('SELECT 1 FROM accounts WHERE account_number=$1', [n])).rowCount) return n;
  }
}

authRoutes.post('/register', limiter, async (req, res, next) => {
  try {
    const { phone, name, pin } = req.body || {};
    if (!phoneOk(phone) || !pinOk(pin) || !name) throw new AppError(400, 'BAD_INPUT', 'Provide phone, name and a 4 to 6 digit PIN');
    const deviceId = req.get('x-device-id');
    const out = await tx(async (c) => {
      const u = await c.query('INSERT INTO users(phone, name, pin_hash) VALUES($1,$2,$3) RETURNING id, phone, name, kyc_tier', [phone, name, await bcrypt.hash(pin, 12)]);
      const acct = await c.query("INSERT INTO accounts(user_id, type, name, account_number) VALUES($1,'wallet',$2,$3) RETURNING account_number", [u.rows[0].id, name, await newAccountNumber(c)]);
      if (deviceId) await c.query('INSERT INTO devices(user_id, device_id) VALUES($1,$2)', [u.rows[0].id, deviceId]);
      return { user: u.rows[0], accountNumber: acct.rows[0].account_number };
    });
    res.status(201).json({ ...out, token: signToken(out.user.id) });
  } catch (e) { next(e); }
});

authRoutes.post('/login', limiter, async (req, res, next) => {
  try {
    const { phone, pin } = req.body || {};
    const found = await pool.query('SELECT id FROM users WHERE phone=$1', [phone || '']);
    if (!found.rows[0]) throw new AppError(401, 'BAD_PIN', 'Incorrect phone or PIN');
    const user = await tx((c) => verifyPin(c, found.rows[0].id, pin));
    res.json({ token: signToken(user.id) });
  } catch (e) { next(e); }
});
