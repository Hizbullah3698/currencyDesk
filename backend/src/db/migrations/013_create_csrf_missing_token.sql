-- Durable record of mutating requests that arrived without a CSRF token.
--
-- WHY THIS EXISTS, rather than relying on the console.warn that middleware/csrf.ts already emits:
-- the decision to switch on CSRF_ENFORCE (rollout stage 3) is gated on "nothing is still sending
-- requests without a token". A log line cannot answer that question here. Vercel's runtime logs
-- are scoped to a single deployment and retained briefly — measured directly, a warning logged at
-- 13:40 was already unretrievable by 16:05 the same day, and every push to main rotates the
-- backend deployment (both Vercel projects build from the same branch), producing five production
-- deployments in one afternoon. So a quiet log is indistinguishable between "no untokened
-- requests", "this deployment is new", and "the entry aged out" — and acting on the wrong one
-- locks out every user still holding a cached copy of the frontend.
--
-- WHY ONLY THE FAILURES ARE RECORDED, with no matching count of successful requests:
-- a denominator is needed to tell "clean traffic" from "no traffic at all", but the business
-- tables already provide it. `activity` and `journal_entries` carry created_at, so real usage over
-- any window is already queryable. Recording every successful mutation here as well would put an
-- extra round trip to Neon (a different continent from the Vercel functions) on the critical path
-- of every trade, to derive something the database already knows.
--
-- Rows therefore appear only while something is genuinely still missing a token, and stop
-- appearing entirely once the frontend rollout has propagated. An empty table over a window in
-- which `activity` shows real trades is the actual green light for stage 3.

CREATE TABLE csrf_missing_token (
  -- Bucketed by hour rather than one row per request, so a single stuck client looping on a failed
  -- action cannot grow this table without bound. `count` carries the real volume.
  hour       timestamptz NOT NULL,
  -- Never null: middleware/csrf.ts lets an unauthenticated request straight through to requireAuth
  -- (a request with no session could not have been issued a token, so rejecting it on CSRF grounds
  -- would be misleading), which means this row is only ever written for a signed-in caller.
  -- Deliberately no foreign key to users — this is diagnostic data, and it should survive the
  -- deletion of an account rather than block it.
  user_id    uuid NOT NULL,
  method     text NOT NULL,
  path       text NOT NULL,
  count      integer NOT NULL DEFAULT 1,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hour, user_id, method, path)
);

-- The gate query is "anything in the last N hours", so it reads newest-first on last_seen.
CREATE INDEX csrf_missing_token_last_seen_idx ON csrf_missing_token (last_seen DESC);
