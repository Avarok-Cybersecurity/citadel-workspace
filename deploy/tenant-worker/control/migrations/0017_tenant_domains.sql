-- The names a tenant's server identity answers to (control/tenant-domains.mjs). `custom_domain` is
-- the canonical domain once one is attached (NULL: `<slug>.<CONTROL_HOST>` is canonical), held by
-- one tenant at most. `former_domains` is the JSON array of every name it was canonical under
-- before, the slug host among them once a custom domain is attached: the kernel's
-- `[identity] former_domains`, published in /.well-known/citadel. The default is for rows that
-- predate custom domains, which have none.
ALTER TABLE tenants ADD COLUMN custom_domain TEXT;
ALTER TABLE tenants ADD COLUMN former_domains TEXT NOT NULL DEFAULT '[]';
CREATE UNIQUE INDEX tenants_by_custom_domain ON tenants (custom_domain);
