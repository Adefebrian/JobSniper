#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

readonly SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly INSTALLER="${SCRIPT_DIR}/install.sh"
readonly UNINSTALLER="${SCRIPT_DIR}/uninstall.sh"

test_root="$(mktemp -d "${TMPDIR:-/tmp}/jobsniper-lightpanda-tests.XXXXXX")"
cleanup() {
  rm -rf -- "${test_root}"
}
trap cleanup EXIT

pass_count=0

pass() {
  pass_count=$((pass_count + 1))
  printf 'ok %d - %s\n' "${pass_count}" "$1"
}

fail() {
  printf 'not ok - %s\n' "$1" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local expected="$2"
  grep -Fq -- "${expected}" "${file}" ||
    fail "expected ${file} to contain: ${expected}"
}

assert_absent() {
  local path="$1"
  [[ ! -e "${path}" ]] || fail "expected path to be absent: ${path}"
}

expect_failure() {
  local expected="$1"
  shift
  local output="${test_root}/failure-output"
  if "$@" >"${output}" 2>&1; then
    fail "command unexpectedly succeeded: $*"
  fi
  assert_contains "${output}" "${expected}"
}

artifact="${test_root}/lightpanda-fake"
cat >"${artifact}" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\0' "$@" >"${CAPTURE_FILE}"
printf 'fake Lightpanda\n'
FAKE
chmod 755 "${artifact}"
artifact_sha256="$(shasum -a 256 -- "${artifact}" | awk '{print $1}')"

expect_failure "missing required pin input: --version" \
  "${INSTALLER}" --sha256 "${artifact_sha256}" --artifact "${artifact}" \
  --install-dir "${test_root}/missing-version"
pass "installer rejects a missing version"

expect_failure "missing required pin input: --sha256" \
  "${INSTALLER}" --version 1.2.3 --artifact "${artifact}" \
  --install-dir "${test_root}/missing-checksum"
pass "installer rejects a missing checksum"

wrong_sha256="0000000000000000000000000000000000000000000000000000000000000000"
expect_failure "checksum mismatch for --artifact" \
  "${INSTALLER}" --version 1.2.3 --sha256 "${wrong_sha256}" \
  --artifact "${artifact}" --install-dir "${test_root}/wrong-checksum"
pass "installer rejects an artifact checksum mismatch"

install_dir="${test_root}/Library/Application Support/JobSniper/bin"
"${INSTALLER}" --version 1.2.3-test --sha256 "${artifact_sha256}" \
  --artifact "${artifact}" --install-dir "${install_dir}" \
  >"${test_root}/install-output"
[[ -x "${install_dir}/lightpanda" ]] || fail "managed wrapper was not installed"
[[ -x "${install_dir}/lightpanda-bin" ]] || fail "managed binary was not installed"
[[ -f "${install_dir}/lightpanda.pin" ]] || fail "managed pin was not installed"
assert_contains "${install_dir}/lightpanda.pin" "version=1.2.3-test"
assert_contains "${install_dir}/lightpanda.pin" "sha256=${artifact_sha256}"
assert_contains "${test_root}/install-output" "jobsniper-lightpanda install: complete"
pass "installer verifies and installs the pinned artifact"

verify_output="${test_root}/verify-output"
"${install_dir}/lightpanda" --verify-pin >"${verify_output}"
install_dir_real="$(CDPATH= cd -- "${install_dir}" && pwd -P)"
assert_contains "${verify_output}" "version=1.2.3-test"
assert_contains "${verify_output}" "sha256=${artifact_sha256}"
assert_contains "${verify_output}" "path=${install_dir_real}/lightpanda-bin"
pass "wrapper reports the exact installed pin"

capture_file="${test_root}/captured-args"
expected_args="${test_root}/expected-args"
injection_marker="${test_root}/command-substitution-ran"
url="https://example.test/jobs?q=\$(touch ${injection_marker})&x=\`touch ${injection_marker}\`"
printf 'fetch\0--dump\0html\0%s\0' "${url}" >"${expected_args}"
CAPTURE_FILE="${capture_file}" "${install_dir}/lightpanda" fetch --dump html "${url}" \
  >"${test_root}/wrapper-output"
cmp -s -- "${expected_args}" "${capture_file}" ||
  fail "wrapper did not preserve the URL as one exact argument"
assert_absent "${injection_marker}"
pass "wrapper preserves arguments without shell interpolation"

expect_failure "crawler invocation must pass exactly: fetch --dump html URL" \
  "${install_dir}/lightpanda" fetch --dump html "https://example.test/one" extra
pass "wrapper rejects an unsafe crawler invocation shape"

printf '\ntampered\n' >>"${install_dir}/lightpanda-bin"
expect_failure "pin verification failed" \
  "${install_dir}/lightpanda" fetch --dump html "https://example.test/jobs"
pass "wrapper refuses a tampered binary"

unsafe_dir="${test_root}/unsafe-install"
mkdir -p -- "${unsafe_dir}"
printf 'format=not-jobsniper\nmanaged_by=somebody-else\n' >"${unsafe_dir}/lightpanda.pin"
printf 'preserve\n' >"${unsafe_dir}/sentinel"
expect_failure "refusing to remove unmanaged install directory" \
  "${UNINSTALLER}" --install-dir "${unsafe_dir}"
[[ -f "${unsafe_dir}/sentinel" ]] || fail "unsafe uninstall removed unmanaged content"
pass "uninstaller refuses an unmanaged directory"

printf 'preserve\n' >"${install_dir}/keep.txt"
"${UNINSTALLER}" --install-dir "${install_dir}" >"${test_root}/uninstall-output"
assert_absent "${install_dir}/lightpanda"
assert_absent "${install_dir}/lightpanda-bin"
assert_absent "${install_dir}/lightpanda.pin"
[[ -f "${install_dir}/keep.txt" ]] || fail "uninstaller removed unrelated content"
assert_contains "${test_root}/uninstall-output" "jobsniper-lightpanda uninstall: complete"
pass "uninstaller removes only managed files"

"${UNINSTALLER}" --install-dir "${test_root}/already-absent" \
  >"${test_root}/absent-output"
assert_contains "${test_root}/absent-output" "already absent"
pass "uninstaller is idempotent when already absent"

printf '1..%d\n' "${pass_count}"
