-- How far the identity upgrade (control/identity-upgrade.mjs, identity-version.mjs) has brought
-- the tenant's object. Every row that exists when this runs was provisioned before server
-- identities, so it starts at 0: not yet upgraded. A row created from here on is inserted at the
-- current version by name (store.mjs), its object provisioned with its identity at creation.
ALTER TABLE tenants ADD COLUMN identity_version INTEGER NOT NULL DEFAULT 0;
