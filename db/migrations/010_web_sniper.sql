-- Web sniper: job posts found anywhere on the web (company sites, public LinkedIn posts, forums)
-- that state a real application email. Plus a "new company" signal the score favours.
INSERT INTO sources (id, name, kind, countries, roles, method, config, trust, status)
VALUES (md5('jobsniper-source:web-sniper')::uuid, 'Web sniper (search + page read)', 'search_dork', ARRAY['global'],
        ARRAY['discovery', 'job_record', 'contact'], 'headless', '{"accessMode":"public_no_login","requiresLogin":false}'::jsonb,
        'public_listing', 'active')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS discovered_urls (
  url text PRIMARY KEY,
  query text,
  outcome text NOT NULL,           -- job | no_email | not_job | blocked | error
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS new_company boolean NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS new_company_quote text;
