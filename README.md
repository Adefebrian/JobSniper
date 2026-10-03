# JobSniper

Local-first AI software engineering job discovery and outreach.

JobSniper crawls public career pages and ATS feeds, preserves exact relevance evidence, ranks roles against Brian's profile, prepares grounded English applications, and sends only after per-email approval.

## Layout

- `apps/api`: Bun and Hono modular API, scheduler, judging, contacts, outreach, settings and dashboard data.
- `apps/web`: React SPA built with `Bun.build()`.
- `crates/crawler`: Rust worker and source adapters.
- `db/migrations`: PostgreSQL schema applied at API boot.
- `ops/launchd`: macOS user agents and installers.
- `docs`: product contract, design direction, operations and golden evaluation inputs.

## Use it (macOS app)

1. Postgres must run: `brew services start postgresql@15` (already set to start at login on Brian's Mac).
2. Build and install: `zsh apps/desktop/build.sh --install`, then open JobSniper from /Applications.
   The app starts the API and the crawler itself, starts at login, and keeps crawling when its window is closed
   (menu bar icon: Open / Quit). Logs: `~/Library/Logs/JobSniper/`.
3. Settings > Connections: paste the OpenAI key (gpt-6-luna) and the Jev key. Without Jev, targets are shown
   with an "Unverified by Jev" label and can never be sent.
4. Gmail: create a Google Cloud OAuth client of type "Desktop app" with the Gmail API enabled, paste its client ID
   and secret in Connections, then press Connect Gmail.
5. Settings > Profile: import the CV file (default `~/Documents/CV_Ade_Febrian_AI_Engineer.docx`).
6. More company boards: `bun scripts/seed-ats.ts slug1 slug2` probes Greenhouse, Ashby and Lever and registers what answers.

## Develop


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
