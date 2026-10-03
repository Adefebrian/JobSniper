-- Remotive's robots.txt is unavailable (Cloudflare 403), which RFC 9309 treats as allow.
-- Its API asks for light use, so crawl it every 3 hours instead of hourly.
UPDATE sources SET status = 'active', last_error = NULL WHERE id = md5('jobsniper-source:remotive')::uuid;
INSERT INTO career_sources (id, company_id, source_id, kind, url, tier, config)
VALUES (md5('jobsniper-feed-source:remotive')::uuid, md5('jobsniper-feed:remotive')::uuid, md5('jobsniper-source:remotive')::uuid,
        'portal', 'https://remotive.com/api/remote-jobs?category=software-dev', 2,
        '{"multi_company":true,"items_path":"jobs","fields":{"title":"title","url":"url","external_id":"id","company":"company_name","location":"candidate_required_location","description":"description","posted_at":"publication_date"}}'::jsonb)
ON CONFLICT (company_id, url) DO UPDATE SET tier = 2, config = EXCLUDED.config;
