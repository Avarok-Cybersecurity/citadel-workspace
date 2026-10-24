-- What apps cost each period (control/meter.mjs `appEgress`, `appRelay`): the bodies server
-- egress brought in, which the relay quota counts (billing/tiers.json
-- `metering.relay_quota_fields`), and the iHTTP frames the node relayed between members' apps,
-- already in bytes_in and kept apart only to say how much of it was apps'. A period sampled
-- before apps were metered had none of either counted: 0 is that count.
ALTER TABLE tenant_usage ADD COLUMN app_egress_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_usage ADD COLUMN app_relay_ihttp_bytes INTEGER NOT NULL DEFAULT 0;
