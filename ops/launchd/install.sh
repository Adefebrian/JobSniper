#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUPPORT_DIR="${HOME}/Library/Application Support/JobSniper"
AGENT_DIR="${HOME}/Library/LaunchAgents"
BUN_BIN="$(command -v bun 2>/dev/null || true)"
CARGO_BIN="$(command -v cargo 2>/dev/null || true)"

if [[ -z "${BUN_BIN}" && -x "${HOME}/.bun/bin/bun" ]]; then
  BUN_BIN="${HOME}/.bun/bin/bun"
fi
if [[ -z "${CARGO_BIN}" && -x "${HOME}/.cargo/bin/cargo" ]]; then
  CARGO_BIN="${HOME}/.cargo/bin/cargo"
fi
if [[ -z "${BUN_BIN}" ]]; then
  echo "bun not found" >&2
  exit 69
fi

mkdir -p "${SUPPORT_DIR}/logs" "${AGENT_DIR}"

cat >"${SUPPORT_DIR}/jobsniper-api.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "${REPO_ROOT}"
exec "${BUN_BIN}" run apps/api/src/index.ts
EOF

if [[ -n "${CARGO_BIN}" ]]; then
  cat >"${SUPPORT_DIR}/jobsniper-crawler.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "${REPO_ROOT}/crates/crawler"
exec "${CARGO_BIN}" run --release
EOF
else
  echo "cargo not found; crawler agent will not be installed" >&2
fi

chmod 700 "${SUPPORT_DIR}/jobsniper-api.sh"
[[ -f "${SUPPORT_DIR}/jobsniper-crawler.sh" ]] && chmod 700 "${SUPPORT_DIR}/jobsniper-crawler.sh"

for process in api crawler; do
  template="${REPO_ROOT}/ops/launchd/com.ade.jobsniper.${process}.plist"
  target="${AGENT_DIR}/com.ade.jobsniper.${process}.plist"
  if [[ "${process}" == "crawler" && ! -f "${SUPPORT_DIR}/jobsniper-crawler.sh" ]]; then
    continue
  fi
  sed -e "s|__APPLICATION_SUPPORT__|${SUPPORT_DIR}|g" \
      -e "s|__REPO__|${REPO_ROOT}|g" "${template}" >"${target}"
  launchctl bootstrap "gui/$(id -u)" "${target}"
  launchctl kickstart -k "gui/$(id -u)/com.ade.jobsniper.${process}"
done

echo "JobSniper launch agents installed."
