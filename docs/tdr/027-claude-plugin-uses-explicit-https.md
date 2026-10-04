# TDR-027: Fetch the Claude plugin through explicit HTTPS

- **Date:** 2026-10-04
- **Status:** Accepted
- **Deciders:** OMMS maintainer
- **Tags:** claude-code, marketplace, git, https

## Context

Claude showed `omms: connected · 4.4.2 available`. The web app answered its
health check, while the launcher reported an older OMMS copy. Updating the
plugin failed with `No ED25519 host key is known for github.com`.

### Root Cause Analysis

The marketplace used the `github` plugin source with `repo: cmdaltctr/omms`.
Claude's GitHub source handling selected SSH on the affected machine. Git's
strict host-key check then refused the connection. A command-scoped HTTPS
rewrite allowed one update, but later background runs had no such override.

OMMS sends status text through `$.ui.status`; Claude draws the icon. The
`available` suffix compares npm latest with the OMMS copy that the launcher
runs. It does not diagnose a failed health check.

## Decision

Use this plugin source in `.claude-plugin/marketplace.json`:

```json
{
  "source": "url",
  "url": "https://github.com/cmdaltctr/omms.git",
  "ref": "stable"
}
```

Use the full HTTPS repository URL when adding the marketplace too. Keep
`stable` and the npm approval gate unchanged. The fix takes effect when the
marketplace change reaches `main` and a user's catalogue refreshes.

## Consequences

### Positive

- Public plugin installs and updates work with SSH unavailable.
- Users can receive the fix through the marketplace catalogue.

### Negative

- Custom Git URL rewrites and organisation policies can still override or block HTTPS.
- An existing marketplace whose own SSH fetch fails needs HTTPS re-registration before it can obtain the catalogue fix.

### Neutral

- Plugin versions continue to follow approved npm releases through `stable`.
- Pi and OpenCode keep their existing update commands.

## Alternatives Considered

| Option                      | Rejected because                                                         |
| --------------------------- | ------------------------------------------------------------------------ |
| Keep the GitHub shorthand   | It permits SSH selection on machines that cannot complete the handshake. |
| Add a personal Git rewrite  | It repairs one machine and leaves other users exposed.                   |
| Disable SSH host-key checks | It removes the server identity check.                                    |

## How to Recognise / Handle This Again

1. Check the status text for the web app state and any available version.
2. Read the plugin update error for an SSH host-key failure.
3. Confirm the catalogue's plugin source uses the explicit HTTPS URL above.
4. Refresh the marketplace and update the plugin.
5. Run `/reload-plugins` after the update completes.

## Verification

- The updated asset assertion failed against the GitHub shorthand source, then all eight asset tests passed.
- `claude plugin validate .` passed.
- An isolated Claude configuration with an empty home and an SSH command that always fails installed 4.4.1 through HTTPS.
- After changing the scratch ref to `stable`, the same configuration updated to 4.4.2 at `26f0f6e7c4cea1122b16695d695d908fd01c8a0a`.
- A Git wrapper rejected SSH clone URLs. Both recorded clone URLs used HTTPS. Claude performed a separate SSH check during setup; its failure did not prevent the HTTPS install or update.
- `bun run ci:local` passed, including check, build and all 247 isolated test files. Bun printed directory-mismatch diagnostics during passing web tests.
- Aikido scanned the changed test and marketplace and returned zero findings.

## Revisit Triggers

Recheck this choice if Claude changes URL-source handling or catalogue updates.

## References

- [Marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference)
- [Stable-channel decision](../adr/021-claude-plugin-stable-channel.md)
- [Claude Code adapter](../claude-code-adapter.md)
- [Marketplace](../../.claude-plugin/marketplace.json)
- [Asset tests](../../tests/claude-plugin-assets.test.ts)
