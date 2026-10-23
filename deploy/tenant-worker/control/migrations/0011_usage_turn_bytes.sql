-- The TURN bytes members' agents reported each period (control/meter.mjs `turn`). They never
-- cross the tenant's object, so they are not part of bytes_in; the relay quota counts both. A
-- period sampled before agents reported them had none of it counted: 0 is that count.
ALTER TABLE tenant_usage ADD COLUMN turn_bytes INTEGER NOT NULL DEFAULT 0;
