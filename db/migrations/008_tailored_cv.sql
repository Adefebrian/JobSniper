-- A CV tailored by luna to one job, on Brian's request only (button), kept as a .docx in Documents.
CREATE TABLE IF NOT EXISTS tailored_cvs (
  job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  content jsonb NOT NULL,
  file_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
