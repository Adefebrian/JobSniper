#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

readonly DEFAULT_INSTALL_DIR="${HOME}/Library/Application Support/JobSniper/bin"
readonly PIN_FORMAT="jobsniper-lightpanda-pin-v1"

install_dir="${DEFAULT_INSTALL_DIR}"

usage() {
  cat <<'USAGE'
Usage:
  uninstall.sh [--install-dir PATH]

Removes only the managed Lightpanda wrapper, binary, and pin metadata.
The parent JobSniper Application Support directory is preserved.
USAGE
}

fail() {
  printf 'jobsniper-lightpanda uninstall: %s\n' "$*" >&2
  exit 1
}

while (($# > 0)); do
  case "$1" in
    --install-dir)
      [[ -n "${2-}" ]] || fail "missing value for --install-dir"
      install_dir="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[[ -n "${install_dir}" && "${install_dir}" != *$'\n'* ]] ||
  fail "invalid --install-dir"

if [[ ! -e "${install_dir}" ]]; then
  printf 'jobsniper-lightpanda uninstall: already absent\n'
  exit 0
fi

[[ -d "${install_dir}" && ! -L "${install_dir}" ]] ||
  fail "refusing to uninstall through a non-directory or symbolic link"

pin_file="${install_dir}/lightpanda.pin"
if [[ ! -f "${pin_file}" || -L "${pin_file}" ]]; then
  fail "refusing to remove unmanaged install directory: ${install_dir}"
fi
grep -Fxq "format=${PIN_FORMAT}" "${pin_file}" ||
  fail "refusing to remove unmanaged install directory: ${install_dir}"
grep -Fxq "managed_by=jobsniper-lightpanda" "${pin_file}" ||
  fail "refusing to remove unmanaged install directory: ${install_dir}"

rm -f -- "${install_dir}/lightpanda" "${install_dir}/lightpanda-bin" "${pin_file}"
rmdir -- "${install_dir}" 2>/dev/null || true
printf 'jobsniper-lightpanda uninstall: complete\n'
