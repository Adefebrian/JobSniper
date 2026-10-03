#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

readonly INSTALL_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly PIN_FILE="${INSTALL_DIR}/lightpanda.pin"
readonly BINARY_NAME="lightpanda-bin"
readonly BINARY_PATH="${INSTALL_DIR}/${BINARY_NAME}"
readonly PIN_FORMAT="jobsniper-lightpanda-pin-v1"

fail() {
  printf 'jobsniper-lightpanda wrapper: %s\n' "$*" >&2
  exit 1
}

[[ -f "${PIN_FILE}" && ! -L "${PIN_FILE}" ]] ||
  fail "pin metadata is missing or unsafe: ${PIN_FILE}"

format=""
managed_by=""
version=""
sha256=""
binary=""
format_seen=0
managed_by_seen=0
version_seen=0
sha256_seen=0
binary_seen=0

while IFS='=' read -r key value || [[ -n "${key}" ]]; do
  case "${key}" in
    format)
      ((format_seen == 0)) || fail "duplicate pin key: format"
      format="${value}"
      format_seen=1
      ;;
    managed_by)
      ((managed_by_seen == 0)) || fail "duplicate pin key: managed_by"
      managed_by="${value}"
      managed_by_seen=1
      ;;
    version)
      ((version_seen == 0)) || fail "duplicate pin key: version"
      version="${value}"
      version_seen=1
      ;;
    sha256)
      ((sha256_seen == 0)) || fail "duplicate pin key: sha256"
      sha256="${value}"
      sha256_seen=1
      ;;
    binary)
      ((binary_seen == 0)) || fail "duplicate pin key: binary"
      binary="${value}"
      binary_seen=1
      ;;
    '')
      ;;
    *)
      fail "unsupported pin key: ${key}"
      ;;
  esac
done <"${PIN_FILE}"

[[ "${format}" == "${PIN_FORMAT}" ]] ||
  fail "unsupported or missing pin format"
[[ "${managed_by}" == "jobsniper-lightpanda" ]] ||
  fail "pin metadata is not managed by JobSniper"
[[ -n "${version}" ]] || fail "pin version is missing"
[[ "${version}" =~ ^[0-9A-Za-z][0-9A-Za-z._+-]*$ ]] ||
  fail "pin version is invalid"
[[ -n "${sha256}" ]] || fail "pin checksum is missing"
[[ "${sha256}" =~ ^[[:xdigit:]]{64}$ ]] ||
  fail "pin checksum is invalid"
[[ "${binary}" == "${BINARY_NAME}" ]] ||
  fail "pin binary must be ${BINARY_NAME}"
[[ -f "${BINARY_PATH}" && ! -L "${BINARY_PATH}" ]] ||
  fail "pinned binary is missing or unsafe: ${BINARY_PATH}"
command -v shasum >/dev/null 2>&1 ||
  fail "shasum is required to verify the pinned binary"

sha256="$(printf '%s' "${sha256}" | tr '[:upper:]' '[:lower:]')"
actual_sha256="$(shasum -a 256 -- "${BINARY_PATH}" | awk '{print $1}')"
actual_sha256="$(printf '%s' "${actual_sha256}" | tr '[:upper:]' '[:lower:]')"
[[ "${actual_sha256}" == "${sha256}" ]] ||
  fail "pin verification failed: expected ${sha256}, got ${actual_sha256}"

if [[ "${1-}" == "--verify-pin" ]]; then
  (($# == 1)) || fail "--verify-pin does not accept additional arguments"
  printf 'format=%s\nmanaged_by=%s\nversion=%s\nsha256=%s\nbinary=%s\npath=%s\n' \
    "${PIN_FORMAT}" "jobsniper-lightpanda" "${version}" "${sha256}" \
    "${BINARY_NAME}" "${BINARY_PATH}"
  exit 0
fi

(($# == 4)) ||
  fail "crawler invocation must pass exactly: fetch --dump html URL"
[[ "$1" == "fetch" && "$2" == "--dump" && "$3" == "html" ]] ||
  fail "crawler invocation must pass exactly: fetch --dump html URL"
url="$4"
[[ "${url}" == http://* || "${url}" == https://* ]] ||
  fail "URL must start with http:// or https://"
[[ "${url}" != *$'\n'* && "${url}" != *$'\r'* ]] ||
  fail "URL must be a single line"

exec "${BINARY_PATH}" fetch --dump html "${url}"
