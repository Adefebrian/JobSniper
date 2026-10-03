# Golden evaluation

`scripts/evaluate-golden.ts` is the deterministic QA entry point for `docs/golden/cases.jsonl`. It reads the JSONL fixture, applies transparent rule-based role and language checks, and emits confusion-matrix metrics without network calls, model calls, or hidden state.

## Run

```bash
bun run scripts/evaluate-golden.ts
bun run scripts/evaluate-golden.ts docs/golden/cases.jsonl --min-precision=0.9
bun test test/golden
```

The default precision gate is `0.90`. The command exits `0` only when the measured precision is at least the gate, `1` when the gate fails, and `2` for invalid input or execution errors. A set with no predicted positives has `precision: null` and therefore cannot pass the gate.

## Input contract

Each non-empty line in `docs/golden/cases.jsonl` is one JSON object:

```json
{
  "id": "stable-id",
  "title": "AI Software Engineer",
  "description": "Exact public job text",
  "country": "SG",
  "label": true,
  "reason": "Why this label is correct"
}
```

`id`, `title`, `description`, `country`, and `reason` must be non-empty strings. `label` must be a boolean. `country` is an opaque grouping key, so labels such as `UK` are preserved. The parser skips blank lines, reports malformed lines with their line number, and rejects duplicate ids. An optional `seniority` field accepts `early`, `mid`, `senior`, `lead`, or `unknown`; when absent, the evaluator uses a transparent title heuristic and reports the remaining cases as `unknown`.

The label and reason are evaluation metadata. They are never used by the rule predictor; only `title` and `description` determine a prediction.

## Rule checks

The evaluator implements the PRD pre-filter in two transparent stages:

1. **Role relevance.** Graduate/new-grad/intern/apprentice, AI trainer/annotation, pure research, and non-engineering title roles are excluded first. A job passes when AI/LLM/agentic evidence is paired with engineering evidence, or when product-facing model/inference evidence is paired with engineering evidence. The returned `roleEvidence` contains exact source sentences.
2. **Language fit.** Saudi-national-only and Saudization roles are excluded. A required non-English language is excluded unless the requirement is explicitly preferred/optional. English JDs pass automatically; non-English JDs must contain an English working-language marker. `languageEvidence` contains the exact supporting sentence.

The final prediction is `roleRelevant && languageFit`. The deterministic rules are intentionally bounded and are not a replacement for Jev runtime decisions. They make golden-set regressions visible and keep QA independent of external APIs.

## Metrics

For each case, the evaluator records one of `true_positive`, `true_negative`, `false_positive`, or `false_negative`.

```text
precision = TP / (TP + FP)   # null when there are no predicted positives
recall    = TP / (TP + FN)   # null when there are no actual positives
```

The report includes overall metrics and separate by-country and by-seniority tables. Each table reports `N`, `TP`, `FP`, `FN`, `TN`, precision, and recall. False-positive and false-negative ids and rule reasons are printed after the tables so tuning changes cannot hide errors.

## Current seed result

The committed seed contains 100 cases (67 positive labels and 33 negative labels). The evaluator currently reports:

```text
Cases: 100 | actual positives: 67 | predicted positives: 67
Overall | 100 | 67 | 0 | 0 | 33 | 100.00% | 100.00%
Precision gate: PASS (minimum 90.00%)
False positives (0)
False negatives (0)
```

The seed meets the PRD's 100-case target. Keep `docs/golden/cases.jsonl` deterministic when tuning thresholds; do not weaken the precision gate to accommodate new cases.

## Final validation matrix

Every row is a required release gate. A missing harness is `FAIL`, not `SKIP`; only the focused golden evaluator is in this QA change.

| Gate | Command | Pass criteria | Scope status |
|---|---|---|---|
| Bun tests | `bun test` | Exit `0`; all unit, API, and golden tests pass with no unexplained skips | Run: 35 pass, 0 fail |
| Focused golden tests | `bun test test/golden` | Exit `0`; evaluator parser, rules, metrics, report, and CLI exit gate pass | Run: 13 pass, 0 fail |
| Rust fixture tests | `cargo test --locked --manifest-path crates/crawler/Cargo.toml` | Exit `0`; all adapter/fixture tests pass | Run: 25 pass, 0 fail |
| Build | `bun run build && bun run --cwd apps/api typecheck && cargo build --locked --manifest-path crates/crawler/Cargo.toml` | All commands exit `0` | FAIL: web/Rust build pass; existing API typecheck errors must be fixed by the owning backend scope |
| Migration smoke | `bun test test/migration-smoke.test.ts` | Fresh `jobsniper_test` applies `001_initial.sql` and second boot applies nothing; required tables and `schema_migrations` are present | P4 harness required |
| P4 browser smoke | `CHROME_PATH=/path/to/chrome bun test test/browser/p4-smoke.test.ts` | `puppeteer-core` opens the built SPA against the local API, exercises all four routes and one target drawer, and records console/network failures | P4 harness required |

The browser smoke uses system Chromium through `puppeteer-core`, matching JAL QA discipline. It must run against the built SPA and local API, not sample data or a remote service.
