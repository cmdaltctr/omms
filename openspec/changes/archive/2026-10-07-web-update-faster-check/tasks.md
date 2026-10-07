## 1. Faster web app update check

- [x] 1.1 Add tests for the 10-minute interval, the status-read check after 60 seconds, one request for reads during a check, and no request when the check is off; confirm they fail on the old code.
- [x] 1.2 Change `UPDATE_CHECK_INTERVAL_MS` to 10 minutes, start a background check from `status()` after 60 seconds, and share a running check; confirm the tests pass.
- [x] 1.3 Update `docs/web-ui.md`.
- [x] 1.4 Run `bun run ci:local`.
