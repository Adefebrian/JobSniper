#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

readonly SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly DEFAULT_INSTALL_DIR="${HOME}/Library/Application Support/JobSniper/bin"
readonly PIN_FORMAT="jobsniper-lightpanda-pin-v1"

install_dir="${DEFAULT_INSTALL_DIR}"
version=""
sha256=""
artifact=""

usage() {
  cat <<'USAGE'
Usage:
  install.sh --version VERSION --sha256 SHA256 --artifact PATH [--install-dir PATH]

Required pin inputs:
  --version VERSION    Verified Lightpanda release version.
  --sha256 SHA256      Verified SHA-256 for the exact artifact, 64 hexadecimal characters.
  --artifact PATH      Locally acquired Lightpanda executable to verify and install.

Optional:
  --install-dir PATH   Test/managed install root. Defaults to:
                       ~/Library/Application Support/JobSniper/bin
  -h, --help            Show this help.
USAGE
}

fail() {
  printf 'jobsniper-lightpanda install: %s\n' "$*" >&2
  exit 1
}

require_value() {
  local option="$1"
  local value="${2-}"
  [[ -n "${value}" ]] || fail "missing value for ${option}"
}

while (($# > 0)); do
  case "$1" in
    --version)
      require_value "$1" "${2-}"
      version="$2"
      shift 2
      ;;
    --sha256)
      require_value "$1" "${2-}"
      sha256="$2"
      shift 2
      ;;
    --artifact)
      require_value "$1" "${2-}"
      artifact="$2"
      shift 2
      ;;
    --install-dir)
      require_value "$1" "${2-}"
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

[[ -n "${version}" ]] || fail "missing required pin input: --version"
[[ -n "${sha256}" ]] || fail "missing required pin input: --sha256"
[[ -n "${artifact}" ]] || fail "missing required pin input: --artifact"
[[ "${version}" =~ ^[0-9A-Za-z][0-9A-Za-z._+-]*$ ]] ||
  fail "invalid --version; use only letters, digits, dot, underscore, plus, or hyphen"
[[ "${sha256}" =~ ^[[:xdigit:]]{64}$ ]] ||
  fail "invalid --sha256; expected exactly 64 hexadecimal characters"

sha256="$(printf '%s' "${sha256}" | tr '[:upper:]' '[:lower:]')"
[[ -n "${install_dir}" && "${install_dir}" != *$'\n'* ]] ||
  fail "invalid --install-dir"
[[ -f "${artifact}" && ! -L "${artifact}" ]] ||
  fail "--artifact must be a regular file and not a symbolic link"
command -v shasum >/dev/null 2>&1 ||
  fail "shasum is required to verify the pinned artifact"

actual_sha256="$(shasum -a 256 -- "${artifact}" | awk '{print $1}')"
actual_sha256="$(printf '%s' "${actual_sha256}" | tr '[:upper:]' '[:lower:]')"
[[ "${actual_sha256}" == "${sha256}" ]] ||
  fail "checksum mismatch for --artifact: expected ${sha256}, got ${actual_sha256}"

umask 022
mkdir -p -- "${install_dir}"
[[ -d "${install_dir}" && ! -L "${install_dir}" ]] ||
  fail "install directory is not a real directory: ${install_dir}"

staging_dir="$(mktemp -d "${install_dir}/.lightpanda.install.XXXXXX")"
cleanup() {
  rm -rf -- "${staging_dir}"
}
trap cleanup EXIT

install -m 755 -- "${artifact}" "${staging_dir}/lightpanda-bin"
install -m 755 -- "${SCRIPT_DIR}/lightpanda-wrapper.sh" "${staging_dir}/lightpanda"
cat >"${staging_dir}/lightpanda.pin" <<PIN
format=${PIN_FORMAT}
managed_by=jobsniper-lightpanda
version=${version}
sha256=${sha256}
binary=lightpanda-bin
PIN
chmod 644 "${staging_dir}/lightpanda.pin"

"${staging_dir}/lightpanda" --verify-pin >/dev/null

mv -f -- "${staging_dir}/lightpanda-bin" "${install_dir}/lightpanda-bin"
mv -f -- "${staging_dir}/lightpanda.pin" "${install_dir}/lightpanda.pin"
mv -f -- "${staging_dir}/lightpanda" "${install_dir}/lightpanda"

"${install_dir}/lightpanda" --verify-pin
printf 'jobsniper-lightpanda install: complete\n'
