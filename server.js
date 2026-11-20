import express from 'express';
import helmet from 'helmet';
import { AppError } from './ledger.js';
import { authRoutes } from './routes/auth1.js';
import { walletRoutes } from './routes/wallet.js';
import { billsRoutes } from './routes/bills2.js';
import { savingsRoutes } from './routes/savings.js';
import { loansRoutes } from './routes/loans.js';
import { cardsRoutes } from './routes/cards.js';
import { assistantRoutes } from './routes/assistant1.js';
import { webhookRoutes } from './routes/webhooks.js';

for (const k of ['DATABASE_URL', 'JWT_SECRET', 'WEBHOOK_SECRET']) if (!process.env[k]) throw new Error(`Missing env var ${k}`);

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use('/webhooks', express.raw({ type: '*/*', limit: '100kb' }), webhookRoutes); // raw body for signature checks
app.use(express.json({ limit: '100kb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/auth', authRoutes);
app.use('/wallet', walletRoutes);
app.use('/bills', billsRoutes);
app.use('/savings', savingsRoutes);
app.use('/loans', loansRoutes);
app.use('/cards', cardsRoutes);
app.use('/assistant', assistantRoutes);

app.use((err, _req, res, _next) => {
  if (err instanceof AppError) return res.status(err.status).json({ error: err.code, message: err.message });
  if (err.code === '23505') return res.status(409).json({ error: 'CONFLICT', message: 'Already exists' });
  console.error(err);
  res.status(500).json({ error: 'INTERNAL', message: 'Something went wrong' });
});

app.listen(process.env.PORT || 3000, () => console.log('Payvue API listening'));
