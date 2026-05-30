-- Schema for the Cloudflare D1 (managed SQLite) collector.
-- Applied via: wrangler d1 migrations apply DB --remote

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL,        -- unix epoch milliseconds
  name         TEXT    NOT NULL,        -- 'pageview' or a custom event name
  domain       TEXT    NOT NULL,
  path         TEXT    NOT NULL,
  visitor      TEXT    NOT NULL,        -- daily-rotating hash (NOT an IP)
  ref_host     TEXT,
  channel      TEXT,                    -- ai | search | social | referral | direct
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  device       TEXT,                    -- mobile | tablet | desktop
  country      TEXT,
  flags        TEXT                     -- NULL = clean; else comma-joined reasons
);                                       -- (bot | no_origin | origin_mismatch)

CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts);
CREATE INDEX IF NOT EXISTS idx_events_visitor ON events (visitor);

-- Daily salt for cookieless visitor hashing. Only today + yesterday are retained.
CREATE TABLE IF NOT EXISTS salts (
  day  TEXT PRIMARY KEY,   -- UTC YYYY-MM-DD
  salt TEXT NOT NULL
);
