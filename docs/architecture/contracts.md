# JobSniper frozen contracts

This document freezes the shared boundaries before parallel implementation.

## Postgres crawl queue

- `crawl_tasks` is the only handoff between `jobsniper-crawler` and `jobsniper-api`.
- A worker claims work with `SELECT ... FOR UPDATE SKIP LOCKED`, sets `lease_until`, and reports a terminal or retryable result.
- `payload.kind` is one of `discover`, `crawl`, `closed_check`.
- `payload.url`, `payload.source_id`, `payload.company_id`, and `payload.external_id` are optional strings.
- Claiming never deletes tasks. Terminal successful tasks are marked `done`; failures increment `attempts` and receive an explicit error in `last_error`.

## Job status

`new -> judged -> targeted -> drafted -> sent -> replied | closed | skipped | blacklisted`

Operational additions: `pending_judge`, `unverified`.

## Evidence

- Every target must retain at least one exact `ai_evidence.quote`.
- Language decisions retain exact supporting or rejecting quotes in `decisions.input`.
- Contacts retain `source_url` and `source_quote`; no guessed email is accepted.

## HTTP API

- JSON API base path: `/api`.
- All responses use `{ "ok": true, "data": ... }` or `{ "ok": false, "error": { "code", "message", "details?" } }`.
- The web SPA consumes only `/api`; browser code never imports database, credentials, model clients, or crawler internals.

## Build boundaries

- `apps/api/src/modules/<domain>/index.ts` is the only cross-module public import.
- `apps/api/src/core/ports` defines infra interfaces; adapters live under `apps/api/src/core/adapters`.
- `crates/crawler` is independent of TypeScript source and uses SQL only for the queue contract above.
