import crypto from 'node:crypto';
import { Router } from 'express';
import { tx } from '../db.js';
import { AppError, move, systemAccount } from '../ledger.js';

export const webhookRoutes = Router();

/** Provider funding webhook. Body is the raw bytes; signature is hex HMAC-SHA256 with WEBHOOK_SECRET. The unique reference makes retries safe. */
webhookRoutes.post('/funding', async (req, res, next) => {
  try {
    const expected = crypto.createHmac('sha256', process.env.WEBHOOK_SECRET).update(req.body).digest();
    const got = Buffer.from(req.get('x-signature') || '', 'hex');
    if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) throw new AppError(401, 'BAD_SIGNATURE', 'Invalid signature');
    const { reference, account_number, amount_kobo } = JSON.parse(req.body.toString('utf8'));
    try {
      await tx(async (c) => {
        const a = (await c.query("SELECT id, user_id FROM accounts WHERE account_number=$1 AND type='wallet'", [account_number])).rows[0];
        if (!a) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Unknown account');
        await move(c, await systemAccount(c, 'SYS-SETTLEMENT'), a.id, { kind: 'funding', reference: `fund_${reference}`, userId: a.user_id, amountKobo: amount_kobo });
      });
    } catch (e) { if (e.code !== '23505') throw e; } // already processed
    res.json({ ok: true });
  } catch (e) { next(e); }
});
