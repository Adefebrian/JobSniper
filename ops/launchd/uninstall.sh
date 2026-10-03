#!/usr/bin/env bash
set -euo pipefail

for process in api crawler; do
  label="com.ade.jobsniper.${process}"
  launchctl bootout "gui/$(id -u)/${label}" 2>/dev/null || true
  rm -f "${HOME}/Library/LaunchAgents/${label}.plist"
done

echo "JobSniper launch agents stopped. Application Support data was preserved."
