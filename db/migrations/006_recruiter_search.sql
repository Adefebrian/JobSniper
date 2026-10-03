-- One public-email search per company (PRD 8.1 recruiter_search), never repeated in a loop.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS recruiter_searched_at timestamptz;
