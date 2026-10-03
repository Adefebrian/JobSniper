-- The sniper's real target: jobs that take applications by email, and the address to send to.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS apply_method text NOT NULL DEFAULT 'unknown' CHECK (apply_method IN ('email', 'form', 'unknown'));
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS apply_email text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS apply_quote text;
CREATE INDEX IF NOT EXISTS jobs_apply_email_idx ON jobs (score DESC) WHERE apply_method = 'email' AND closed_at IS NULL;
-- Re-judge everything once so existing jobs get their apply method detected.
UPDATE jobs SET next_judge_at = now(), needs_rescore = true WHERE status IN ('targeted', 'skipped') AND closed_at IS NULL;

-- Hacker News "Who is hiring": the richest public source of apply-by-email posts.
UPDATE sources SET status = 'active', method = 'json_api',
  config = config || '{"adapter":"hn_whoishiring"}'::jsonb
WHERE id = md5('jobsniper-source:hacker-news-who-is-hiring')::uuid;
INSERT INTO companies (id, name, domain, country, industry, tier, discovered_via)
VALUES (md5('jobsniper-feed:hn-whoishiring')::uuid, 'Feed: Hacker News Who is hiring', NULL, 'global', 'job feed', 1, 'feed_holder')
ON CONFLICT DO NOTHING;
INSERT INTO career_sources (id, company_id, source_id, kind, url, tier, config)
VALUES (md5('jobsniper-feed-source:hn-whoishiring')::uuid, md5('jobsniper-feed:hn-whoishiring')::uuid,
        md5('jobsniper-source:hacker-news-who-is-hiring')::uuid, 'portal',
        'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring', 2,
        '{"adapter":"hn_whoishiring","multi_company":true}'::jsonb)
ON CONFLICT (company_id, url) DO UPDATE SET config = EXCLUDED.config;
