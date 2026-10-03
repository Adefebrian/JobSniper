CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  domain text NOT NULL UNIQUE,
  country text NOT NULL,
  industry text,
  tier integer NOT NULL DEFAULT 3 CHECK (tier BETWEEN 1 AND 3),
  sponsor_registry_hit boolean NOT NULL DEFAULT false,
  discovered_via text NOT NULL,
  health text NOT NULL DEFAULT 'ok' CHECK (health IN ('ok', 'failing', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sources (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ats', 'career_page', 'portal', 'gov_portal', 'community', 'aggregator_feed', 'search_dork', 'sponsor_registry', 'curated_list')),
  countries text[] NOT NULL DEFAULT '{}',
  roles text[] NOT NULL DEFAULT '{}',
  method text NOT NULL CHECK (method IN ('json_api', 'rss', 'sitemap', 'json_ld', 'html_selector', 'headless', 'csv_download', 'custom_adapter')),
  config jsonb NOT NULL DEFAULT '{}',
  trust text NOT NULL CHECK (trust IN ('official', 'public_listing', 'derived')),
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'active', 'paused', 'blocked', 'retired')),
  yield_stats jsonb NOT NULL DEFAULT '{"itemsSeen":0,"relevantJobs":0,"duplicateJobs":0,"failures":0,"lastYieldAt":null}'::jsonb,
  admitted_by text,
  trial_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS career_sources (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_id uuid REFERENCES sources(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('career_page', 'ats', 'portal')),
  url text NOT NULL,
  tier integer NOT NULL DEFAULT 3 CHECK (tier BETWEEN 1 AND 3),
  etag text,
  content_hash text,
  next_due_at timestamptz NOT NULL DEFAULT now(),
  closed_check_due_at timestamptz NOT NULL DEFAULT now(),
  fail_count integer NOT NULL DEFAULT 0,
  blocked_until timestamptz,
  last_ok_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, url)
);

CREATE INDEX IF NOT EXISTS career_sources_due_idx ON career_sources (next_due_at, tier);
CREATE INDEX IF NOT EXISTS career_sources_closed_due_idx ON career_sources (closed_check_due_at, tier);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_id uuid REFERENCES sources(id) ON DELETE SET NULL,
  external_id text,
  title text NOT NULL,
  url text NOT NULL,
  apply_url text NOT NULL,
  location text,
  countries text[] NOT NULL DEFAULT '{}',
  work_mode text NOT NULL DEFAULT 'unknown' CHECK (work_mode IN ('remote', 'hybrid', 'onsite', 'unknown')),
  remote_scope text NOT NULL DEFAULT 'unknown' CHECK (remote_scope IN ('remote_global', 'remote_apac', 'remote_restricted', 'onsite', 'unknown')),
  sponsorship text NOT NULL DEFAULT 'unknown' CHECK (sponsorship IN ('yes', 'no', 'unknown', 'onsite_sponsor_yes', 'sponsor_unknown', 'sponsor_no')),
  sponsor_registry_hit boolean NOT NULL DEFAULT false,
  seniority text NOT NULL DEFAULT 'unknown' CHECK (seniority IN ('mid', 'early', 'senior', 'lead', 'unknown')),
  salary text,
  posted_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  jd_text text NOT NULL,
  jd_text_english text,
  jd_hash text NOT NULL,
  ai_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  language_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  score double precision,
  score_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'judged', 'targeted', 'drafted', 'sent', 'replied', 'closed', 'skipped', 'blacklisted', 'pending_judge', 'unverified')),
  skip_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_source_external_unique ON jobs (source_id, external_id) WHERE external_id IS NOT NULL AND source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_company_title_location_unique ON jobs (company_id, lower(title), coalesce(location, ''));
CREATE INDEX IF NOT EXISTS jobs_status_score_idx ON jobs (status, score DESC NULLS LAST, first_seen_at DESC);

CREATE TABLE IF NOT EXISTS job_sightings (
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  url text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, source_id)
);

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (position('@' IN email) > 1),
  name text,
  role text,
  kind text NOT NULL CHECK (kind IN ('public', 'portal_public', 'recruiter_search')),
  source_url text NOT NULL,
  source_quote text NOT NULL,
  jev_verdict jsonb,
  invalid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_job_unique ON contacts (email, coalesce(job_id::text, '')) WHERE invalid_at IS NULL;

CREATE TABLE IF NOT EXISTS do_not_contact (
  id uuid PRIMARY KEY,
  email_or_domain text NOT NULL UNIQUE,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outreach (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('initial', 'followup')),
  subject text NOT NULL,
  body text NOT NULL,
  cv_variant text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'scheduled', 'sending', 'sent', 'replied', 'closed', 'failed')),
  scheduled_for timestamptz,
  sent_at timestamptz,
  gmail_thread_id text,
  reply_class text CHECK (reply_class IN ('positive', 'negative', 'auto_reply', 'bounce')),
  reply_text text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS outreach_unique_kind ON outreach (job_id, kind) WHERE status NOT IN ('closed', 'failed');

CREATE TABLE IF NOT EXISTS crawl_tasks (
  id uuid PRIMARY KEY,
  source_id uuid REFERENCES sources(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('discover', 'crawl', 'closed_check')),
  priority integer NOT NULL DEFAULT 50,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'leased', 'done', 'failed')),
  lease_until timestamptz,
  leased_by text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL UNIQUE,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crawl_tasks_claim_idx ON crawl_tasks (status, priority DESC, created_at) WHERE status IN ('queued', 'leased');

CREATE TABLE IF NOT EXISTS decisions (
  id uuid PRIMARY KEY,
  decision_id text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  input_digest text NOT NULL,
  input jsonb NOT NULL,
  verdict jsonb NOT NULL,
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS decisions_subject_idx ON decisions (subject_type, subject_id, created_at DESC);

CREATE TABLE IF NOT EXISTS llm_usage (
  id uuid PRIMARY KEY,
  model text NOT NULL,
  purpose text NOT NULL,
  request_id text NOT NULL,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  cost_usd double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_usage_created_idx ON llm_usage (created_at);
