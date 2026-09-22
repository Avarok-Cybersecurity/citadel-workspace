-- A paid tenant's reservation can be retried by whoever started it: a visitor who cancels at
-- Stripe and comes back re-posts the same slug with the reservation token the first 201 gave them.
--
-- SHA-256 of that token (the token itself is never stored), and the pending row's Checkout
-- Session id AES-GCM sealed under it, so the retry can expire the old session and nobody without
-- the token can learn the id (which is the key to the sealed claim code).
ALTER TABLE tenants ADD COLUMN reservation_hash TEXT;
ALTER TABLE tenants ADD COLUMN checkout_sealed TEXT;
