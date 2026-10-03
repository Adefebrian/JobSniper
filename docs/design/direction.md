# JobSniper direction: dashboard

Seed: product "JobSniper", screen "dashboard", key `0fc5b084`, kind direction, pool 4, pick 1, reroll 0.
Decided: 2026-10-03. Mode: operate. JEV: `ui.direction_screen`, `ui.density`.

## Decision ledger

- `orch.parallel`: safe at 0.9; coupling `shared_contract` at 0.99. The workspace and queue/API contracts were frozen before parallel work.
- `ui.density`: `adaptive`, confidence 0.91. Interpretation: compact records on desktop and comfortable 44px rows and controls below 1024px.
- `ui.direction_screen`: control room 2.55, Swiss ledger 2.41, lab notebook 2.51, departure board 2.53 and dropped for slop 0.58, engineering console 2.46.
- Seeded draw: Swiss operations ledger, original rank 4. This is stable on rerun from the recorded seed.

## Brief

Audience: Brian at a Mac, checking ranked opportunities and moving approved emails forward in short focused sessions.
Job: understand which jobs deserve action, inspect why they qualify, and move one target from evidence to approved outreach.
Mechanism: every target carries transparent AI and language evidence plus the exact reasoning behind its score before any email can move.
Rut: decorative dashboard KPIs and generic rounded cards; predictable opposite: a themed mission-control skin. Both are rejected.

## Direction

Form: Swiss operations ledger, a strict record grid aligned around evidence and action.
Preset: modern JAL Core product UI.
Thesis: the ranked work ledger is the product; status, evidence and actions stay on one calm inspection line.
Own world: white canvas, black ink, restrained green for healthy status and red only for blockers, tabular figures, neutral hairline dividers, square-to-lightly-rounded controls.
Story: Brian sees the strongest target, verifies its evidence and contact provenance, then drafts or skips it.
First viewport: at 375px, a compact status strip, page title, filters, and stacked job records; at 1280px, navigation, status strip, filter row, ranked table and optional detail drawer.
Signature moment: none. State changes use immediate, restrained feedback only.
Page shape: ledger below 960px becomes stacked records; below 640px it becomes a dedicated mobile app shell.
Compositions: status strip, toolbar, records table, detail drawer, tabbed workflow, divided settings form.

## Knobs

- Canvas: white and broken white.
- Accent: green as a signal only; black for primary actions.
- Type: system sans for text and system mono for IDs, timestamps and score components.
- Tracking: title and heading tracking only.
- Density: adaptive, with compact desktop rows and comfortable mobile controls.
- Radius: small controls and panels only; never pill-shaped record rows.
- Motion intensity: none beyond state feedback.
- Display ceiling: page title at `--text-4` or lower on product screens.

## Law

White-first, no overlap, no content outside its box, no gradients, no shadows, no side lines, no emoji, no decorative lines, no purple default, and no realtime animation.
