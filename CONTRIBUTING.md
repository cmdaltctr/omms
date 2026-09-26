# Contributing to OMMS

Thank you for helping. OMMS is a memory plugin for OpenCode and the Pi coding
agent. Bug reports, fixes, documentation, and new features are all welcome.

## Before you start

- **Bugs:** search the [issues](https://github.com/cmdaltctr/omms/issues)
  first. If none matches, open one with your OS, agent and version, OMMS
  version, what you did, and what happened. Logs help; remove anything private
  first.
- **Features and larger changes:** open an issue to describe the problem
  before you write code. The maintainer plans behaviour changes as an OpenSpec
  change (a proposal, a design, and a task list), so agreeing on the plan
  first saves rework.
- **Security problems:** do not open a public issue. Report them through
  [GitHub private vulnerability reporting](https://github.com/cmdaltctr/omms/security/advisories/new).

## Set up

You need [Bun](https://bun.sh) and Node.js 24. The package itself supports
Node.js 22.14 or later.

```bash
git clone https://github.com/cmdaltctr/omms.git
cd omms
bun install --frozen-lockfile
(cd web && bun install --frozen-lockfile)
bun run build
```

The first test run downloads a small embedding model from Hugging Face, so it
needs internet access once.

## Make a change

1. Create a branch from `main`. Never commit to `main` directly.
2. Keep the change focused on one thing.
3. If you change a feature for one host (OpenCode or Pi), change it for the
   other host too. Both hosts must offer the same capabilities.
4. Add or update tests. Every bug fix needs a test that fails without the fix.
5. Update the matching guide in `docs/` when user-visible behaviour changes.
   Keep `README.md` short; detail belongs in `docs/`.

Read [docs/shared-core.md](docs/shared-core.md) before you move code between
`src/core/`, `src/services/`, and the host adapters. Tests enforce those
boundaries.

## Check your work

| Command                         | When                                                                       |
| ------------------------------- | -------------------------------------------------------------------------- |
| `bun run check`                 | Often. Format check, lint, and typecheck; about 11 seconds.                |
| `bun test tests/<name>.test.ts` | While you work on one area. Run `bun run build` first if it needs `dist/`. |
| `bun run ci:local`              | Before you open or update a pull request. This is the required gate.       |
| `bun run check:package`         | After `bun run build`, when you change `package.json` or entry points.     |

Do not run the whole suite with plain `bun test`. It runs every file in one
process, and shared state makes about 48 tests fail for reasons unrelated to
your change. `bun run ci:local` runs each file in its own process.

Git hooks run automatically: the pre-commit hook typechecks and formats staged
files, and the pre-push hook runs `bun run check`. Run `bun run format` to fix
formatting by hand.

## Code style

- TypeScript in strict mode, ES modules, `.js` extensions in relative imports.
- Prettier formats code and Markdown; ESLint allows no warnings.
- Match the naming and comment style of the code around your change.
- Never log raw model replies, prompts, or secrets.

## Commit messages and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org). Releases and
the changelog are generated from them:

| Prefix                                         | Effect on the next release |
| ---------------------------------------------- | -------------------------- |
| `feat:`                                        | Minor version              |
| `fix:`, `deps:`                                | Patch version              |
| `feat!:` or `BREAKING CHANGE:`                 | Major version              |
| `docs:`, `refactor:`, `test:`, `ci:`, `chore:` | No release                 |

Open the pull request against `main`. Describe what changed and why, and how
you tested it. GitHub runs the Quality workflow on every pull request;
CodeRabbit also reviews it. Reply to each review comment, fix it or explain
why not, and resolve the thread. [docs/ci.md](docs/ci.md) explains every
check and the release process.

## Using an AI coding agent

[AGENTS.md](AGENTS.md) holds the rules that coding agents follow in this
repository: architecture, commands, tests, host parity, and the OpenSpec
workflow. If you use an agent, point it at that file.

## Licence

OMMS is released under the [MIT License](LICENSE.md). By contributing, you
agree that your contribution is released under the same licence.
