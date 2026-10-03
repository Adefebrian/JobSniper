# Browser Smoke

The final browser smoke validates the built SPA over local HTTP without running external services.

## Run

```bash
bun run --cwd apps/web build
bun test apps/web/tests/smoke.test.ts
```

The smoke starts a loopback-only static server for `apps/web/dist` and supplies the dashboard envelope at `/api/dashboard`. It verifies at `375px` and `1280px` that:

- the JobSniper shell loads from the built bundle;
- the Targets navigation renders and opens the Targets screen;
- a ranked target opens its detail drawer;
- neither the base Targets screen nor the open detail drawer causes page-level horizontal overflow.

## Chrome

The test uses `puppeteer-core` with an installed browser. Resolution order is `PUPPETEER_EXECUTABLE_PATH`, `CHROME_PATH`, then standard macOS and Linux Chrome or Chromium locations.

When no executable is available, the browser test is skipped and prints:

```text
[JobSniper smoke] skipped: Chrome/Chromium is unavailable. Set CHROME_PATH or PUPPETEER_EXECUTABLE_PATH.
```

Set a custom executable when needed:

```bash
CHROME_PATH="/path/to/chrome" bun test apps/web/tests/smoke.test.ts
```

The smoke is intentionally limited to the single final PRD gate. It is not a general browser E2E suite.
