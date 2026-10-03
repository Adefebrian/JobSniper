# QA Report

## Scope

This focused `jal-qa` pass owns only:

- `scripts/evaluate-golden.ts`
- `test/golden/**`
- `docs/evaluation.md`
- `docs/QA.md`

No application, crawler, database, operations, root configuration, or existing golden case was edited.

## Golden evaluator

Implemented a deterministic JSONL evaluator with:

- strict case parsing and duplicate-id detection;
- rule-based role relevance with exact source evidence;
- rule-based language fit covering English JDs, explicit English in non-English JDs, mandatory non-English exclusions, optional-language allowances, and Saudi-only exclusions;
- overall plus by-country and by-seniority precision/recall/confusion metrics;
- false-positive and false-negative reporting;
- a default 90% precision gate with nonzero CLI exit on failure;
- no network, LLM, Jev, database, or runtime secret access.

The committed 16-case seed passes at 100% precision and recall: `TP=7`, `TN=9`, `FP=0`, `FN=0`.

## Tests

```bash
bun test test/golden
```

Result: **13 pass, 0 fail, 35 assertions**. Coverage includes AI/LLM relevance, product-facing ML, generic software rejection, graduate/research exclusions, German required/optional language, non-English German with English evidence, Arabic-native and Saudi-only exclusions, restricted remote relevance, grouped metrics, JSONL parsing, report formatting, and CLI nonzero exit below the precision gate.

```bash
bun test
```

Result: **35 pass, 0 fail, 89 assertions** across the existing API/web tests plus the new golden suite.

```bash
cargo test --locked --manifest-path crates/crawler/Cargo.toml
```

Result: **25 pass, 0 fail** across Rust unit and fixture-backed integration tests.

```bash
bun run build
```

Result: web build completed successfully.

The required API typecheck (`bun run --cwd apps/api typecheck`) currently fails in existing backend files with TypeScript errors in `companies`, `outreach`, and `settings`. Those files are outside this disjoint QA scope and were not edited; the final Build gate remains **FAIL** until the owning backend scope resolves them.

## Validation matrix

The final production matrix is defined in `docs/evaluation.md`. The migration smoke and P4 browser smoke are intentionally marked as required P4 gates because their harnesses are outside this disjoint QA scope; they must not be treated as skipped. The browser gate must use `puppeteer-core` with system Chromium and the built local SPA.

QA GATE: PASS  |  13 passed, 0 failed, 0 skipped  |  golden evaluator  |  35ms
