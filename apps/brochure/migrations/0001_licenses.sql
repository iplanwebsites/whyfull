-- Whyfull desktop licenses: one row per paid Stripe Checkout Session.
CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  key TEXT NOT NULL,
  stripe_session_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT,
  payment_intent TEXT,
  amount INTEGER,
  currency TEXT,
  created_at TEXT NOT NULL,
  refunded_at TEXT,
  emailed_at TEXT
);
CREATE INDEX IF NOT EXISTS licenses_email ON licenses (email);
CREATE INDEX IF NOT EXISTS licenses_payment_intent ON licenses (payment_intent);

-- Fixed-window counters for /api/recover and /api/license. Buckets are
-- SHA-256 hashes, so no raw IP address or email is stored here.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
