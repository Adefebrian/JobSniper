-- Brian's like/dislike on targets: examples Jev judges new jobs against, plus a local fallback model.
CREATE TABLE IF NOT EXISTS job_feedback (
  job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  verdict text NOT NULL CHECK (verdict IN ('like', 'dislike')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Focus on AI-assisted / agentic engineering, and fit with Brian's feedback (0..1 each).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS agentic_focus real;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS preference_fit real;
-- Targets re-scored after new feedback without leaving the Targets list.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS needs_rescore boolean NOT NULL DEFAULT false;
