-- Make the pipeline actually run end to end.

-- Feed employers are discovered by name; their domain is learned later.
ALTER TABLE companies ALTER COLUMN domain DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS companies_name_unique ON companies (lower(name));

-- Per-board adapter options (board token, multi_company, close_missing, ...).
ALTER TABLE career_sources ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Brain loop queue: retry time for unverified / budget-parked jobs.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS next_judge_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS language text;
CREATE INDEX IF NOT EXISTS jobs_judge_queue_idx ON jobs (status, next_judge_at) WHERE closed_at IS NULL;

-- Correct ATS endpoint (the public posting API, not the GraphQL app API).
UPDATE sources SET config = config || '{"urlPattern":"https://api.ashbyhq.com/posting-api/job-board/{{company}}?includeCompensation=true"}'::jsonb
WHERE id = md5('jobsniper-source:ashby')::uuid;
UPDATE sources SET config = config || '{"urlPattern":"https://boards-api.greenhouse.io/v1/boards/{{company}}/jobs?content=true"}'::jsonb
WHERE id = md5('jobsniper-source:greenhouse')::uuid;
UPDATE sources SET config = config || '{"urlPattern":"https://api.lever.co/v0/postings/{{company}}?mode=json"}'::jsonb
WHERE id = md5('jobsniper-source:lever')::uuid;

-- Public JSON/RSS feeds verified on 2026-10-03. Each lists many employers (multi_company).
INSERT INTO sources (id, name, kind, countries, roles, method, config, trust, status)
VALUES (md5('jobsniper-source:arbeitnow')::uuid, 'Arbeitnow', 'aggregator_feed', ARRAY['DE','global'], ARRAY['discovery','job_record'],
        'json_api', '{"accessMode":"public_no_login","requiresLogin":false,"endpoint":"https://www.arbeitnow.com/api/job-board-api"}'::jsonb,
        'public_listing', 'active')
ON CONFLICT (id) DO NOTHING;

UPDATE sources SET method = 'json_api', status = 'active', config = config || '{"endpoint":"https://himalayas.app/jobs/api?limit=100"}'::jsonb
WHERE id = md5('jobsniper-source:himalayas')::uuid;

CREATE TEMP TABLE feed_seed (key text, label text, url text, method text, config text) ON COMMIT DROP;
INSERT INTO feed_seed (key, label, url, method, config)
VALUES
    ('remoteok', 'RemoteOK', 'https://remoteok.com/api', 'json_api',
     '{"multi_company":true,"items_path":"","fields":{"title":"position","url":"url","apply_url":"apply_url","external_id":"id","company":"company","location":"location","description":"description","posted_at":"date"}}'),
    ('remotive', 'Remotive', 'https://remotive.com/api/remote-jobs?category=software-dev', 'json_api',
     '{"multi_company":true,"items_path":"jobs","fields":{"title":"title","url":"url","external_id":"id","company":"company_name","location":"candidate_required_location","description":"description","posted_at":"publication_date"}}'),
    ('himalayas', 'Himalayas', 'https://himalayas.app/jobs/api?limit=100', 'json_api',
     '{"multi_company":true,"items_path":"jobs","fields":{"title":"title","url":"applicationLink","external_id":"guid","company":"companyName","location":"locationRestrictions","description":"description","posted_at":"pubDate"}}'),
    ('arbeitnow', 'Arbeitnow', 'https://www.arbeitnow.com/api/job-board-api', 'json_api',
     '{"multi_company":true,"items_path":"data","fields":{"title":"title","url":"url","external_id":"slug","company":"company_name","location":"location","description":"description","posted_at":"created_at"}}'),
    ('weworkremotely', 'We Work Remotely (programming)', 'https://weworkremotely.com/categories/remote-programming-jobs.rss', 'rss',
     '{"multi_company":true,"title_company_separator":": "}'),
    ('weworkremotely-fullstack', 'We Work Remotely (full-stack)', 'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss', 'rss',
     '{"multi_company":true,"title_company_separator":": "}'),
    ('weworkremotely-backend', 'We Work Remotely (back-end)', 'https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss', 'rss',
     '{"multi_company":true,"title_company_separator":": "}');

-- career_sources needs a company: feed rows hang off one holder company per feed.
INSERT INTO companies (id, name, domain, country, industry, tier, discovered_via)
SELECT md5('jobsniper-feed:' || key)::uuid, 'Feed: ' || label, NULL, 'global', 'job feed', 1, 'feed_holder'
FROM feed_seed
ON CONFLICT DO NOTHING;

INSERT INTO career_sources (id, company_id, source_id, kind, url, tier, config)
SELECT md5('jobsniper-feed-source:' || key)::uuid,
       md5('jobsniper-feed:' || key)::uuid,
       md5('jobsniper-source:' || CASE WHEN key LIKE 'weworkremotely%' THEN 'weworkremotely' ELSE key END)::uuid,
       'portal', url, 1, config::jsonb
FROM feed_seed
ON CONFLICT (company_id, url) DO UPDATE SET config = EXCLUDED.config;

