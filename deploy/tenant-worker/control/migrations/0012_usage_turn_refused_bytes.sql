-- TURN bytes claimed in reports the per-member hourly ceiling refused (control/turn-cap.mjs):
-- never billed, kept so a member's agent over its ceiling shows in the period's record. A
-- period sampled before the ceiling existed refused none: 0 is that count.
ALTER TABLE tenant_usage ADD COLUMN turn_refused_bytes INTEGER NOT NULL DEFAULT 0;
