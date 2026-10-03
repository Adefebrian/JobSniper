# JobSniper Rust crawler

`crates/crawler` is the independent public-web worker. It claims Postgres
`crawl_tasks`, politely fetches public sources, extracts deterministic job
records, and reports a terminal or retryable queue result. It never logs in,
solves CAPTCHAs, guesses email addresses, or bypasses robots rules.

## Queue contract

The worker uses the frozen `crawl_tasks` handoff:

- claim: queued or expired leased work, `FOR UPDATE SKIP LOCKED`, ordered by
  `priority` then `created_at`; the claim writes `status = 'leased'` and
  `leased_by`;
- lease: the claim sets `lease_until`; an expired lease is claimable again;
- success: `status = 'done'`, `lease_until = NULL`, `last_error = NULL`;
- retry: `attempts = attempts + 1`, `status = 'queued'` until `max_attempts`,
  future `lease_until`, and an explicit `last_error`;
- permanent failure: `attempts = attempts + 1`, `status = 'failed'`, and an
  explicit `last_error`.

The task `payload.kind` is `discover`, `crawl`, or `closed_check`. Optional
`url`, `source_id`, `career_source_id`, `company_id`, and `external_id` strings
are passed through. Adapter-specific JSON belongs in `payload.config`;
`adapter` and `method` can also be top-level payload strings.

## Fetching behavior

- One request per domain is reserved at one request per second by default.
- `robots.txt` is loaded and cached per origin before a fetch. Protected or
  unavailable robots responses fail closed; redirects are checked too.
- Failures use exponential backoff from 30 seconds to 24 hours. Repeated bot
  walls open a 15-minute circuit and are never bypassed.
- Bodies are capped at 5 MiB by default. Lightpanda rendering is optional,
  argument-based, bounded to two processes, and timed out after 20 seconds.

## Adapters

The registry supports `json_api`, `rss`, `sitemap`, `json_ld`, `html_selector`,
and `csv_download` through JSON configuration, plus isolated custom adapters:

- `greenhouse`: `board_token` or a Greenhouse boards URL;
- `lever`: `organization` or a Lever API URL;
- `ashby`: `board` or an Ashby posting API URL;
- `workday_cxs`: a `/wday/cxs/{tenant}/{site}/jobs` URL or `tenant` plus `site`.

Generic JSON uses `items_path` and `fields` paths. HTML-selector config has
`item_selector` and per-field `{ selector, attribute?, required? }` objects.
CSV config maps logical fields to header names or zero-based column indexes.

## Tests

Run the focused suite from the repository root:

```sh
cargo test --manifest-path crates/crawler/Cargo.toml
```

The suite covers fixture parsing for all custom adapters, generic adapters,
dedup identifiers, JSON-LD/email/apply extraction, robots matching, per-domain
rate reservations, exponential failure state, renderer invocation, and queue
claim/lease/result behavior. No test contacts the network or Postgres.
