-- One row per day and build, counting the anonymous pings it received; nothing per install.
CREATE TABLE usage_pings (
  day TEXT NOT NULL,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  app TEXT NOT NULL,
  browser TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, version, platform, arch, app, browser)
) WITHOUT ROWID;

-- Cloud waitlist sign-ups; a row is kept unconfirmed for seven days, then removed.
CREATE TABLE waitlist (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  email_key TEXT NOT NULL UNIQUE,
  note TEXT,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  confirmation_sent_at TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE INDEX waitlist_unconfirmed ON waitlist (created_at) WHERE confirmed_at IS NULL;
