#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

echo "== TypeScript build =="
bun run build

echo "== Bun tests =="
bun test

echo "== Golden evaluation =="
bun scripts/evaluate-golden.ts

echo "== Rust tests =="
"${HOME}/.cargo/bin/cargo" test --manifest-path crates/crawler/Cargo.toml

echo "== Lightpanda safety tests =="
bash ops/lightpanda/test.sh

echo "VALIDATION: PASS"
