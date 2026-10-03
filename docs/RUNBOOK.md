# JobSniper runbook

## First run

1. Install Bun, Rust, and local PostgreSQL.
2. Run `bun install`.
3. Run `./scripts/bootstrap-db.sh`.
4. Copy `.env.example` to `.env` and set local values.
5. Store external credentials with `./scripts/keychain.sh <account> <value>`.
6. Install a verified Lightpanda artifact with `./ops/lightpanda/install.sh --version <version> --sha256 <sha256> --artifact <path>`.
7. Run `bun run check`.
8. Start processes with `./ops/launchd/install.sh`.

The API runs at `http://127.0.0.1:4870`. It applies pending migrations automatically.

## Recovery

- `launchctl kickstart -k gui/$(id -u)/com.ade.jobsniper.api`
- `launchctl kickstart -k gui/$(id -u)/com.ade.jobsniper.crawler`
- Expired crawl leases are reclaimed automatically after a crash.
- LLM or Jev outages never permit outbound mail; jobs remain `pending_judge` or `unverified`.

## Shutdown

Run `./ops/launchd/uninstall.sh`. Data and Keychain entries remain intact.
