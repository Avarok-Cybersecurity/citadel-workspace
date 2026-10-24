-- What each period's relayed bytes were (control/meter.mjs): the P2P traffic the tenant's node
-- relayed between peers, and the group fan-out it sent, as parts of the WebSocket bytes it
-- metered. A period sampled before the split existed had none of it counted: 0 is that count.
ALTER TABLE tenant_usage ADD COLUMN relayed_p2p_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_usage ADD COLUMN group_fanout_bytes INTEGER NOT NULL DEFAULT 0;
