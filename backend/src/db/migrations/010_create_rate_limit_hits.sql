-- Backs a persistent express-rate-limit Store (see services/rateLimitStore.ts). The built-in
-- in-memory store only works when a single long-lived process holds the counts — on a
-- serverless deployment (Vercel), each concurrent function instance would get its own separate
-- in-memory counter, silently weakening the login brute-force limiter instead of erroring. A
-- shared Postgres table makes the limit real regardless of how many instances are running.
CREATE TABLE rate_limit_hits (
  key       text PRIMARY KEY,
  count     integer NOT NULL DEFAULT 0,
  reset_at  timestamptz NOT NULL
);
