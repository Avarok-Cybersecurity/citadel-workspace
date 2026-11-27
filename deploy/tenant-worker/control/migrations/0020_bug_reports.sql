-- Problem reports a person sent from the app (control/bug-reports.mjs; RECOVERY-DESIGN.md §3).
--
-- Read only by Avarok, through the signed support API (support.mjs `list_bug_reports` and
-- `fetch_bug_report`); never by a workspace's admins. Kept 90 days: each row carries its own
-- expiry, and the cron deletes the rows past it (scheduled.mjs).
--
-- `tenant` is the slug the report's workspace server resolved to here, or NULL when it named none
-- this control plane knows. `contact` is `handle@host`, present only when the person ticked
-- "Avarok may contact me". `body` is the report as accepted: redacted by the client, re-scanned
-- here (bug-report-scan.mjs), at most 96 KiB.
CREATE TABLE bug_reports (
  id             TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 27),
  tenant         TEXT,
  surface        TEXT    NOT NULL CHECK (length(surface) BETWEEN 1 AND 80),
  contact        TEXT    CHECK (contact IS NULL OR length(contact) <= 320),
  body           TEXT    NOT NULL CHECK (length(body) <= 98304),
  received_at_ms INTEGER NOT NULL,
  expires_at_ms  INTEGER NOT NULL
);
CREATE INDEX bug_reports_received ON bug_reports (received_at_ms);
CREATE INDEX bug_reports_expires ON bug_reports (expires_at_ms);

-- Sends per client address per hour, by the address's salted hash (coupon_attempts' pattern).
CREATE TABLE bug_report_attempts (
  ip_hash TEXT    NOT NULL,
  hour    INTEGER NOT NULL,
  count   INTEGER NOT NULL CHECK (count >= 1),
  PRIMARY KEY (ip_hash, hour)
);
