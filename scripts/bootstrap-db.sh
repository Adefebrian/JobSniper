#!/usr/bin/env bash
set -euo pipefail

ADMIN_URL="${DATABASE_ADMIN_URL:-postgres://localhost:5432/postgres}"

create_db() {
  local name="$1"
  if ! psql "${ADMIN_URL}" -tAc "SELECT 1 FROM pg_database WHERE datname='${name}'" | grep -q 1; then
    psql "${ADMIN_URL}" -c "CREATE DATABASE ${name}"
  fi
}

create_db jobsniper
create_db jobsniper_test

echo "Databases jobsniper and jobsniper_test are ready."
