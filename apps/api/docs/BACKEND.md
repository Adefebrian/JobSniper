# JobSniper API backend

The backend is a Bun + Hono modular monolith backed by Postgres. The frozen response envelope is `{ ok: true, data }` or `{ ok: false, error }`. Every `/api` request is restricted to localhost and rejects mismatched browser `Origin` headers.

## Owned boundaries

- `src/core` contains shared configuration, runtime settings, HTTP validation, ports, and concrete adapters.
- `src/modules/brain` owns jobs, decisions, and LLM usage. `index.ts` is its only public surface.
- `src/modules/contacts` owns evidenced professional contacts. `index.ts` is its only public surface.
- `db/migrations` is applied transactionally at boot through `schema_migrations`.

Contact ingestion is intentionally strict: the complete email must occur in `source_quote`, and the source must be a public URL. The service never constructs or guesses an address.

## Backend QA

Run focused tests from the repository root:

```sh
bun test apps/api/tests/brain.test.ts apps/api/tests/api-validation.test.ts
bunx tsc -p apps/api/tsconfig.json --noEmit
```
