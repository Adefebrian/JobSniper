#!/usr/bin/env bash
set -euo pipefail

SERVICE="${JOBSNIPER_KEYCHAIN_SERVICE:-JobSniper}"
ACCOUNT="${1:-}"
VALUE="${2:-}"

if [[ -z "${ACCOUNT}" || -z "${VALUE}" ]]; then
  echo "Usage: $0 <account> <value>" >&2
  echo "Accounts: openai, jev, gmail-client, gmail-refresh, smtp-password" >&2
  exit 64
fi

security add-generic-password -U -s "${SERVICE}" -a "${ACCOUNT}" -w "${VALUE}"
echo "Stored ${ACCOUNT} in macOS Keychain service ${SERVICE}."
