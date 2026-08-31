-- Runtime-editable application settings.
--
-- WHY A NEW TABLE, when the project's rule is to match existing patterns rather than invent
-- mechanisms: there was no existing pattern to match. Every app-level setting until now lives in
-- config/env.ts and is read from the process environment — DATABASE_URL, COOKIE_NAME,
-- SESSION_MAX_AGE_DAYS, CSRF_ENFORCE. That is the right home for deployment configuration, but it
-- cannot satisfy "a configurable admin setting": changing an env var on Vercel requires a
-- redeploy, so an administrator cannot change it, only whoever holds the hosting account can.
--
-- Deliberately a generic key/value table rather than one column per setting. A settings table with
-- a column per option needs a migration for every new option, which is precisely the friction that
-- pushes people back to hardcoding. Values are text and parsed by the service that owns each key,
-- because the alternative — a typed column per kind — reintroduces the same problem.
--
-- Defaults are NOT stored here as a rule. settingsService.ts carries a fallback for every key it
-- knows, so a missing row means "use the default" rather than "the app is misconfigured". The one
-- row seeded below exists so the value is visible and editable immediately rather than only
-- appearing after someone first changes it.

CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Who last changed it. Nullable because the seeded row below was set by no one, and
  -- deliberately no foreign key to users: a setting's history should survive the deletion of the
  -- account that made it rather than block that deletion.
  updated_by uuid
);

-- Idle timeout in minutes. 5 is the client's requested default.
--
-- This is the single global value for every role. The client has not asked for per-role
-- differences, so encoding one now would be inventing a requirement; a per-role split later means
-- adding keys like 'idle_timeout_minutes.admin' alongside this one and falling back to the global
-- value, without changing the table.
INSERT INTO app_settings (key, value) VALUES ('idle_timeout_minutes', '5')
ON CONFLICT (key) DO NOTHING;
