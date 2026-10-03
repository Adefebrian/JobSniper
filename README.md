# JobSniper

Local-first AI software engineering job discovery and outreach for Brian.

JobSniper crawls public career pages and ATS feeds, preserves exact relevance evidence, ranks roles against Brian's profile, prepares grounded English applications, and sends only after per-email approval.

## Layout

- `apps/api`: Bun and Hono modular API, scheduler, judging, contacts, outreach, settings and dashboard data.
- `apps/web`: React SPA built with `Bun.build()`.
- `crates/crawler`: Rust worker and source adapters.
- `db/migrations`: PostgreSQL schema applied at API boot.
- `ops/launchd`: macOS user agents and installers.
- `docs`: product contract, design direction, operations and golden evaluation inputs.

## Commands

```bash
bun install
./scripts/bootstrap-db.sh
bun run build
bun test
cargo test --manifest-path crates/crawler/Cargo.toml
```

The production entry points are managed by `./ops/launchd/install.sh`. The dashboard binds to `127.0.0.1:4870`.

## Safety invariants

- Public pages only, with robots.txt and per-domain rate limits.
- No CAPTCHA bypass, protected login, guessed contact email, or silent failure.
- No LLM-decision, no application send.
- Every target retains source-grounded AI evidence and every contact retains source provenance.
