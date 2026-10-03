# Lightpanda Pinning and Safe Invocation

JobSniper renders JavaScript-heavy pages with a checksum-pinned Lightpanda binary. The macOS installer never downloads a release implicitly. Version and SHA-256 are explicit required inputs so an operator must select and verify the exact artifact before it enters JobSniper.

No public Lightpanda release version or checksum is bundled in this repository. This workstream did not verify a canonical public macOS release asset, so inventing or inferring a pin would be unsafe. Supply both values from a trusted release record or independent artifact verification.

## Pin Inputs

`ops/lightpanda/install.sh` requires all three values:

| Input | Requirement |
|---|---|
| `--version VERSION` | Non-empty verified release version. Allowed characters are letters, digits, `.`, `_`, `+`, and `-`. |
| `--sha256 SHA256` | Exactly 64 hexadecimal characters for the exact input artifact. Comparison is case-insensitive. |
| `--artifact PATH` | A locally acquired Lightpanda executable. It must be a regular file and cannot be a symlink. |

Optional `--install-dir PATH` exists for isolated tests and managed installations. Its production default is exactly:

```text
~/Library/Application Support/JobSniper/bin
```

The installer computes SHA-256 with macOS `shasum`, fails before installation if it differs from `--sha256`, and writes the accepted values into pin metadata. Missing `--version`, missing `--sha256`, malformed values, an unsafe artifact path, and checksum mismatch all produce explicit failures.

## Installed Files

The default installation contains only these managed files:

```text
~/Library/Application Support/JobSniper/bin/lightpanda
~/Library/Application Support/JobSniper/bin/lightpanda-bin
~/Library/Application Support/JobSniper/bin/lightpanda.pin
```

- `lightpanda` is the safe wrapper used by the crawler.
- `lightpanda-bin` is the verified Lightpanda executable.
- `lightpanda.pin` records pin format, manager, version, SHA-256, and fixed binary name.

The wrapper validates pin metadata, rejects duplicate or unknown keys, verifies `lightpanda-bin` before every invocation, and refuses to execute if the binary has changed. `--verify-pin` prints the installed version, checksum, and absolute binary path without executing Lightpanda.

## Install

Acquire the Lightpanda executable through the release process chosen by Brian. Then install that exact local file:

```bash
./ops/lightpanda/install.sh \
  --version 'VERIFIED_VERSION' \
  --sha256 'VERIFIED_64_CHARACTER_SHA256' \
  --artifact '/absolute/path/to/verified/lightpanda'
```

The example values are intentionally placeholders. The command fails until each is replaced with a verified pin input.

## Crawler Invocation

Point `LIGHTPANDA_PATH` at the managed wrapper:

```text
~/Library/Application Support/JobSniper/bin/lightpanda
```

The crawler must use an argument-based process API and no shell:

```rust
Command::new(lightpanda_path)
    .args(["fetch", "--dump", "html", url])
```

Do not build a command string, pass it to `sh -c`, use `eval`, or interpolate a URL into shell source. The wrapper accepts exactly `fetch --dump html URL`, requires the URL to use `http://` or `https://`, and passes it to the pinned executable as one argument. This preserves URL characters and prevents shell interpretation.

## Validate

Run the self-contained installer, pin, argument-preservation, tamper, and uninstall tests:

```bash
bash ops/lightpanda/test.sh
```

The test uses a temporary fake executable and never contacts the network or modifies the production Application Support directory.

## Uninstall

Remove the managed wrapper, binary, and pin:

```bash
./ops/lightpanda/uninstall.sh
```

Uninstall removes no other JobSniper data and does not remove the parent Application Support directory. It refuses to delete a directory without JobSniper's exact managed pin marker. For a non-default installation, pass `--install-dir PATH`.
