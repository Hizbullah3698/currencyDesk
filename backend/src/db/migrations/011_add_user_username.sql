-- Login IDs. Email stays as-is and keeps working; username is an additional way to
-- reach the same account, not a replacement. Nullable, so every existing row stays
-- valid and an account simply has no username until one is deliberately assigned
-- (see scripts/setUsername.ts).
ALTER TABLE users ADD COLUMN username text;

-- Case-insensitive uniqueness, matching how users_email_lower_idx already works.
-- A unique index over a nullable column still permits many NULLs in Postgres, which
-- is exactly what's wanted here: any number of accounts may have no username yet,
-- but no two may share one.
CREATE UNIQUE INDEX users_username_lower_idx ON users (lower(username));

-- Format is enforced in the database, not just in the app, for two reasons:
--   1. It rules out empty/whitespace usernames, which would otherwise collide under
--      lower() in confusing ways.
--   2. It forbids '@'. That means a username can never look like an email address, so
--      the single "email OR username" login lookup can never be ambiguous about which
--      column a given identifier was meant to match.
ALTER TABLE users ADD CONSTRAINT users_username_format
  CHECK (username IS NULL OR username ~ '^[A-Za-z0-9](?:[A-Za-z0-9._-]{1,30}[A-Za-z0-9])$');
