# Payvue

Opay-style mobile money backend: wallet, transfers, bills, savings, loans, cards, fraud scoring and an assistant parser. Includes a clickable web prototype in `web/index.html`.

## Run it
```bash
cp .env.example .env        # set JWT_SECRET and WEBHOOK_SECRET
docker compose up -d        # Postgres with the schema loaded
npm install
npm run dev                 # API on http://localhost:3000
npm test
```

## How it works
- **Ledger:** `db/schema.sql`. Double-entry, integer kobo, append-only entries, a DB trigger rejecting unbalanced transactions, and a CHECK preventing wallet overdrafts.
- **Safe payments:** every money endpoint needs an `Idempotency-Key` header; accounts are locked in id order; provider calls happen outside DB transactions with automatic reversal on failure.
- **Fraud:** `src/services/fraud.js` scores each transfer (allow, step-up with PIN, block). Swap in an ML model later.
- **Limits:** daily transfer caps by KYC tier.

## API (amounts are in kobo)
| Method | Path | Purpose |
|---|---|---|
| POST | /auth/register, /auth/login | Phone + PIN, returns JWT |
| GET | /wallet, /wallet/transactions | Balance and history |
| POST | /wallet/transfer | Send money (Idempotency-Key, X-Device-Id) |
| POST | /wallet/dev-fund | Dev only test funding |
| POST | /bills/pay | Airtime, data, electricity, cable |
| GET/POST | /savings, /savings/:id/deposit, /withdraw | Locked goals |
| GET/POST | /loans/eligibility, /loans, /loans/repay | Instant loans |
| POST | /cards, /cards/:id/freeze, /unfreeze | Virtual cards |
| POST | /assistant/parse | Turns "send 5000 to Ada" into a proposed action |
| POST | /webhooks/funding | HMAC-signed provider credits |

## Before real money
Providers in `src/providers/` are sandbox stubs. Replace them with NIBSS or a licensed BaaS partner, a KYC provider, a bills provider and a card issuer. You also need a CBN licence or a licensed partner, NDPR compliance, and a security review. Not yet built: refresh tokens, USSD/NFC, group wallets, business tools, USD wallet.
