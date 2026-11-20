-- Payvue ledger schema. All money is stored as integer kobo (1 NGN = 100 kobo).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text UNIQUE NOT NULL,
  name text NOT NULL,
  pin_hash text NOT NULL,
  kyc_tier smallint NOT NULL DEFAULT 1 CHECK (kyc_tier BETWEEN 1 AND 3),
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  type text NOT NULL CHECK (type IN ('wallet','savings','system')),
  name text NOT NULL,
  account_number text UNIQUE NOT NULL,
  balance_kobo bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (type = 'system' OR balance_kobo >= 0)
);
CREATE INDEX ON accounts(user_id);

CREATE TABLE transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  reference text UNIQUE NOT NULL,
  user_id uuid REFERENCES users(id),
  idempotency_key text,
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  fraud_score int NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

-- Signed entries: credit to an account is positive, debit negative. Each transaction sums to zero.
CREATE TABLE ledger_entries (
  id bigserial PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES transactions(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  amount_kobo bigint NOT NULL CHECK (amount_kobo <> 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ledger_entries(account_id, created_at DESC);
CREATE INDEX ON ledger_entries(transaction_id);

CREATE FUNCTION assert_balanced() RETURNS trigger AS $$
BEGIN
  IF (SELECT COALESCE(SUM(amount_kobo),0) FROM ledger_entries WHERE transaction_id = NEW.transaction_id) <> 0 THEN
    RAISE EXCEPTION 'unbalanced transaction %', NEW.transaction_id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER ledger_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_balanced();

CREATE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'ledger_entries is append-only'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE beneficiaries (
  user_id uuid NOT NULL REFERENCES users(id),
  account_number text NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (user_id, account_number)
);

CREATE TABLE devices (
  user_id uuid NOT NULL REFERENCES users(id),
  device_id text NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);

CREATE TABLE fraud_events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  score int NOT NULL,
  decision text NOT NULL,
  reasons jsonb NOT NULL,
  amount_kobo bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  last4 char(4) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'NGN',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen')),
  provider_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE savings_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  name text NOT NULL,
  target_kobo bigint NOT NULL CHECK (target_kobo > 0),
  locked boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  principal_kobo bigint NOT NULL,
  fee_kobo bigint NOT NULL,
  repaid_kobo bigint NOT NULL DEFAULT 0,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','repaid','overdue'))
);

-- System accounts (may go negative: they mirror the outside world).
INSERT INTO accounts(type, name, account_number) VALUES
  ('system','Settlement (external funds)','SYS-SETTLEMENT'),
  ('system','Bills and airtime clearing','SYS-BILLS'),
  ('system','Loan pool','SYS-LOANPOOL'),
  ('system','Fee income','SYS-FEES');
