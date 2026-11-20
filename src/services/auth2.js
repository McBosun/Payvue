import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AppError } from '../ledger.js';

export const phoneOk = (p) => /^\+?\d{10,15}$/.test(p || '');
export const pinOk = (p) => /^\d{4,6}$/.test(p || '');
export const signToken = (id) => jwt.sign({ sub: id }, process.env.JWT_SECRET, { expiresIn: '1h' });

export function requireAuth(req, _res, next) {
  try {
    const h = req.headers.authorization || '';
    const payload = jwt.verify(h.replace(/^Bearer /, ''), process.env.JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch {
    next(new AppError(401, 'UNAUTHORIZED', 'Sign in again'));
  }
}

/** Verify a PIN with lockout after 5 failures (15 minutes). Used for login and step-up checks. */
export async function verifyPin(c, userId, pin) {
  const { rows } = await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [userId]);
  const u = rows[0];
  if (!u) throw new AppError(401, 'UNAUTHORIZED', 'Unknown user');
  if (u.locked_until && u.locked_until > new Date()) throw new AppError(423, 'LOCKED', 'Too many attempts. Try again later');
  const ok = pinOk(pin) && (await bcrypt.compare(pin, u.pin_hash));
  if (!ok) {
    const n = u.failed_attempts + 1;
    await c.query('UPDATE users SET failed_attempts=$2, locked_until=$3 WHERE id=$1', [userId, n >= 5 ? 0 : n, n >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null]);
    await c.query('COMMIT');
    await c.query('BEGIN');
    throw new AppError(401, 'BAD_PIN', 'Incorrect PIN');
  }
  await c.query('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=$1', [userId]);
  return u;
}
