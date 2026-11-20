import { Router } from 'express';
import { tx } from '../db.js';
import { AppError, findByKey, move, ref, systemAccount, walletOf } from '../ledger.js';
import { requireAuth } from '../services/auth2.js';
import { SERVICES, billsProvider } from '../providers/bills1.js';

export const billsRoutes = Router();
billsRoutes.use(requireAuth);

billsRoutes.post('/pay', async (req, res, next) => {
  try {
    const { service, account, amount_kobo } = req.body || {};
    const key = req.get('idempotency-key');
    if (!key) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header');
    if (!SERVICES.includes(service)) throw new AppError(400, 'BAD_SERVICE', `service must be one of ${SERVICES.join(', ')}`);

    // 1) Debit the wallet into the clearing account.
    const debit = await tx(async (c) => {
      const dup = await findByKey(c, req.userId, key);
      if (dup) return { duplicate: dup };
      const w = await walletOf(c, req.userId);
      const t = await move(c, w.id, await systemAccount(c, 'SYS-BILLS'), {
        kind: 'bill', reference: ref('bil'), userId: req.userId, idempotencyKey: key, amountKobo: amount_kobo, meta: { service, account },
      });
      return { t, walletId: w.id };
    });
    if (debit.duplicate) return res.status(200).json({ status: 'duplicate', transaction: debit.duplicate });

    // 2) Call the provider outside the DB transaction. 3) Reverse on failure.
    let result;
    try { result = await billsProvider.pay({ service, account, amountKobo: amount_kobo, reference: debit.t.reference }); }
    catch { result = { ok: false }; }
    if (!result.ok) {
      await tx(async (c) => move(c, await systemAccount(c, 'SYS-BILLS'), debit.walletId, {
        kind: 'bill_reversal', reference: `${debit.t.reference}_rev`, userId: req.userId, amountKobo: amount_kobo, meta: { original: debit.t.reference },
      }));
      throw new AppError(502, 'PROVIDER_FAILED', 'Payment failed and your money was returned');
    }
    res.status(201).json({ status: 'completed', transaction: debit.t, token: result.token });
  } catch (e) { next(e); }
});
