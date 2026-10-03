# JobSniper web

React + TypeScript SPA for the local JobSniper workspace. The UI is a Swiss operations ledger with adaptive density: compact records on desktop, 44px controls and stacked records on small screens.

## Run

```sh
bun install
bun run build
bun test
```

The app consumes the frozen `/api` envelope from `docs/architecture/contracts.md`. It polls dashboard data every 60 seconds and has no realtime socket. When the local API is unavailable, the last available snapshot is shown with a visible warning while API and mutation requests remain wired to the real endpoints.

## Views

- `#/targets`: ranked jobs, evidence-backed filters, detail drawer, and target actions.
- `#/outreach`: draft, scheduled, sent, replied, and follow-up workflow with editing and approval.
- `#/companies`: company health, discovery controls, source yield, and source admission.
- `#/settings`: parsed profile, CV variants, country and score weights, sender identity, and limits.

CSV and XLSX export requests use `/api/export` and download the returned blob directly.
