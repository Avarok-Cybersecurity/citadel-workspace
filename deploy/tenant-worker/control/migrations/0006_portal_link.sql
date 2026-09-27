-- A single-use link to the billing portal, mailed to a verified owner address in place of
-- opening the portal for whoever holds the claim code (control/portal.mjs).
--   portal_hash     SHA-256 of the current link's token; the token itself is never kept.
--   portal_expires  when that link stops working.
ALTER TABLE tenants ADD COLUMN portal_hash TEXT;
ALTER TABLE tenants ADD COLUMN portal_expires INTEGER;
