-- View / edit wine §6: optimistic concurrency (FR-8)
ALTER TABLE wine ADD COLUMN version integer NOT NULL DEFAULT 1;
