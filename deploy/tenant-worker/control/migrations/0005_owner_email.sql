-- The address a workspace's creator gave at /create, where its claim code and a link that
-- verifies the address are sent (control/owner-email.mjs).
--   owner_email        the address, normalised; NULL once its owner said "this wasn't me".
--   email_verified_at  when the link was confirmed; NULL until then.
--   email_sent_at      when the claim email last went out; NULL if it never did.
--   verify_hash        SHA-256 of the current verification token; the token itself is never kept.
--   verify_expires     when that token stops working.
ALTER TABLE tenants ADD COLUMN owner_email TEXT;
ALTER TABLE tenants ADD COLUMN email_verified_at INTEGER;
ALTER TABLE tenants ADD COLUMN email_sent_at INTEGER;
ALTER TABLE tenants ADD COLUMN verify_hash TEXT;
ALTER TABLE tenants ADD COLUMN verify_expires INTEGER;

-- Sends per key per day, so /create cannot be used to mail an address over and over.
-- `key` is "to:<sha256 of address>", "ip:<address>" or "all".
CREATE TABLE mail_sends (
  key TEXT NOT NULL,
  day INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, day)
);

-- Addresses whose owner said "this wasn't me": never mailed again. Held by hash.
CREATE TABLE mail_suppressed (
  email_hash TEXT PRIMARY KEY,
  suppressed_at INTEGER NOT NULL
);
