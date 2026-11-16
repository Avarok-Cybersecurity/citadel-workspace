-- How many 5000-document packs (billing/tiers.json add-on `chat-documents`, business only) a paid
-- tenant bought: each adds 5000 to how many documents shared in chats the workspace may hold.
-- Read and written like storage_blocks and link_packs, through the add-on descriptors
-- (control/addons.mjs). The default is for rows that predate packs, which bought none; every
-- insert names the column. 0013 and 0014 are left for the upgrade branch, which plans them.
ALTER TABLE tenants ADD COLUMN chat_document_packs INTEGER NOT NULL DEFAULT 0 CHECK (chat_document_packs >= 0);
