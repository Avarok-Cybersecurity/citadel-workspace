-- Who accepted which version of the Customer Terms, and when, for each workspace created.
--
-- Written in the same D1 batch as the pending tenant row, so a reservation never exists without
-- its acceptance. The creator is identified by the tenant they created (`tenant_id`; its Stripe
-- customer is on the tenants row once a paid creation completes): the flow holds no email, and
-- the request's IP address is deliberately not recorded. A row is not removed when its
-- reservation is released or expires: the acceptance was given.
CREATE TABLE customer_terms_acceptances (
  tenant_id   TEXT NOT NULL,
  slug        TEXT NOT NULL,
  version     INTEGER NOT NULL CHECK (version >= 1),
  accepted_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, version)
);
