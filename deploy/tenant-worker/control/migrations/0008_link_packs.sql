-- How many 50-link packs (billing/tiers.json add-on `secure-links`) a paid tenant bought: they
-- fill one secure-link pool the whole workspace shares. Read and written like storage_blocks,
-- through the add-on descriptors (control/addons.mjs). The default is for rows that predate packs,
-- which bought none; every insert names the column.
ALTER TABLE tenants ADD COLUMN link_packs INTEGER NOT NULL DEFAULT 0 CHECK (link_packs >= 0);
