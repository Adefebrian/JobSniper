-- A job judged by the local rules while Jev was unreachable stays visible but is marked
-- unverified and can never be sent until Jev confirms it (PRD 11).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS jev_verified boolean NOT NULL DEFAULT false;
