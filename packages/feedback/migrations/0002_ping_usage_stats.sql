-- Count pings by the install's usage stats answer too. Nothing had been released when this ran,
-- so the counters held only test pings and are rebuilt rather than copied.
DROP TABLE usage_pings;

CREATE TABLE usage_pings (
  day TEXT NOT NULL,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  app TEXT NOT NULL,
  browser TEXT NOT NULL,
  usage_stats TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, version, platform, arch, app, browser, usage_stats)
) WITHOUT ROWID;
