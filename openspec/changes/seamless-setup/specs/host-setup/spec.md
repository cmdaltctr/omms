## ADDED Requirements

### Requirement: Setup finds each host and prints a plan

The terminal command SHALL offer `setup`, which also works as `npx om-memory-system@latest setup`. It SHALL look for OpenCode, Pi and Claude Code, and for each host found SHALL check whether OMMS is already registered, by reading the host's own configuration or asking the host's own command. Before any change it SHALL print a plan: each host found with its version, the commands it will run and the files it will change, each host already set up, each absent host, and the first-run notice text.

#### Scenario: Plan for three cases

- **WHEN** OpenCode is found without OMMS, Pi is found with OMMS, and Claude Code is not found
- **THEN** the plan SHALL list the OpenCode command, say Pi is already set up, and say Claude Code was not found

#### Scenario: Old host version

- **WHEN** OpenCode 2.0.10 is found
- **THEN** the plan SHALL warn that OpenCode 2.0.22 or later is needed for every feature

### Requirement: Setup installs only through each host's own command

`setup` SHALL install OMMS with `opencode plugin add om-memory-system` for OpenCode, `pi install npm:om-memory-system` for Pi, and `claude plugin marketplace add https://github.com/cmdaltctr/omms.git` then `claude plugin install omms@omms` for Claude Code. It SHALL skip the marketplace step when Claude Code already lists the `omms` marketplace. It SHALL NOT write to OpenCode's database, to Pi session files, or to any host file except the OpenCode `cli.json` entry.

#### Scenario: Two hosts found

- **WHEN** OpenCode and Pi are on the `PATH`, Claude Code is not, and the user answers yes
- **THEN** `setup` SHALL run `opencode plugin add om-memory-system` and `pi install npm:om-memory-system`
- **AND** it SHALL run no Claude Code command

#### Scenario: Claude Code marketplace already added

- **WHEN** Claude Code lists the `omms` marketplace but not the `omms@omms` plugin
- **THEN** `setup` SHALL run only `claude plugin install omms@omms` for Claude Code

### Requirement: Setup is safe to run twice

`setup` SHALL run no install command and change no file for a host that already has OMMS. It SHALL change nothing for a host that is absent. When every host found is already set up, it SHALL say so, SHALL NOT ask the question, and SHALL exit 0.

#### Scenario: Run twice

- **WHEN** `setup` has already installed OMMS into every host found and the user runs it again
- **THEN** it SHALL report each host as already set up
- **AND** it SHALL run no install command and change no file

### Requirement: Setup prints the next step for each host

After the run, `setup` SHALL print one result line and the next step for each host: restart OpenCode and run `opencode service restart`; restart Pi; or start a new Claude Code session. When Claude Code capture is not ready, the Claude Code next step SHALL say that capture needs the external API and give the Settings page link to the External API card. A host that `setup` did not change SHALL get no restart or new-session step.

#### Scenario: Claude Code without an external API

- **WHEN** `setup` installs the Claude Code plugin and the external API is not configured
- **THEN** the Claude Code next step SHALL name the external API and give the Settings link

#### Scenario: Pi installed

- **WHEN** `setup` installs OMMS into Pi
- **THEN** the Pi next step SHALL say to restart Pi

#### Scenario: Pi already set up

- **WHEN** `setup` installs OMMS into OpenCode and Pi was already set up
- **THEN** the Pi result line SHALL say it was already set up
- **AND** `setup` SHALL NOT tell the user to restart Pi

### Requirement: Setup reports failures per host

A host whose command fails SHALL NOT stop the other hosts. `setup` SHALL print each failure in plain words with the command to run by hand. It SHALL exit 0 when every found host is set up or was already set up, and 1 when a host step failed or no host was found. When no host is found it SHALL change nothing and print where to get each host.

#### Scenario: One host fails

- **WHEN** `pi install npm:om-memory-system` exits with an error and OpenCode is also found
- **THEN** `setup` SHALL still set up OpenCode
- **AND** it SHALL print the Pi error with the command to run by hand, and exit 1

#### Scenario: No host found

- **WHEN** none of the three hosts is found
- **THEN** `setup` SHALL change nothing, print where to get each host, and exit 1

### Requirement: Setup asks before it changes a host

`setup` SHALL ask one yes-or-no question after the plan and SHALL change nothing unless the answer is yes. The default answer SHALL be no. `--yes` SHALL skip the question. `--dry-run` SHALL print the plan and the exact command that applies it, and exit 0 with no question and no change. When standard input is not an interactive terminal and `--yes` is not given, `setup` SHALL print the plan and a hint to run again with `--yes`, change nothing, and exit 1.

#### Scenario: User says no

- **WHEN** the user answers no, or presses Enter, at the question
- **THEN** `setup` SHALL run no host command, change no file, and exit 0

#### Scenario: Script without a terminal

- **WHEN** `setup` runs with standard input from a pipe and no `--yes`
- **THEN** it SHALL print the plan and the `--yes` hint, change nothing, and exit 1

#### Scenario: Unattended run

- **WHEN** `setup --yes` runs
- **THEN** it SHALL install into each host found without a question

### Requirement: Setup adds the OpenCode cli.json entry to an existing file

When OpenCode is found and its global `cli.json` exists (under `$XDG_CONFIG_HOME/opencode/` when set, otherwise `~/.config/opencode/`), `setup` SHALL add the string `om-memory-system` to its `plugins` array when no entry names that package in any version. It SHALL keep every other key, entry, comment and the formatting, add a `plugins` key when there is none, and write the file atomically. The plan SHALL name the file before the question.

#### Scenario: Existing cli.json without OMMS

- **WHEN** `cli.json` holds `{"theme": "dark", "plugins": ["other-plugin"]}`
- **THEN** after `setup` it SHALL hold `"theme": "dark"` and `"plugins": ["other-plugin", "om-memory-system"]`

#### Scenario: Entry with a version

- **WHEN** `cli.json` lists `om-memory-system@6.4.0`
- **THEN** `setup` SHALL leave the file unchanged and report the entry as present

### Requirement: Setup writes cli.json safely

`setup` SHALL read and merge `cli.json` again just before it writes, so a change made after the plan is kept. When `cli.json` is a symbolic link, it SHALL write to the file the link points to, so the link stays a link. The file SHALL keep its permissions.

#### Scenario: cli.json is a symbolic link

- **WHEN** `cli.json` is a symbolic link to a file in a dotfiles folder
- **THEN** after `setup` the link SHALL still be a link, and the file it points to SHALL hold the entry

#### Scenario: cli.json changed while setup runs

- **WHEN** another program adds a key to `cli.json` after the plan is printed and before `setup` writes
- **THEN** after `setup` the file SHALL hold that key and the entry

### Requirement: Setup never creates or repairs cli.json

When `cli.json` does not exist, `setup` SHALL NOT create it, and SHALL print the manual step: start OpenCode once, then run `setup` again. The step SHALL NOT tell the user to create the file. When the file cannot be parsed, or its `plugins` value is not an array, `setup` SHALL change nothing and SHALL print the manual step.

#### Scenario: No cli.json

- **WHEN** OpenCode is found and `cli.json` does not exist
- **THEN** `setup` SHALL NOT create `cli.json`
- **AND** it SHALL print that OpenCode auto-update needs the entry, with the manual step

#### Scenario: Broken cli.json

- **WHEN** `cli.json` holds text that is not JSON
- **THEN** `setup` SHALL leave the file unchanged and print the manual step

### Requirement: Doctor prints one row per check with a fix

The terminal command SHALL offer `doctor`, which also works as `npx om-memory-system@latest doctor`. It SHALL print one row per check with a status of pass, warn, fail or skipped, the reason in plain words, and a fix for each row that is not pass. A model test that only the host can run, because the host uses its own session model, SHALL be skipped with a reason that says so and no fix. It SHALL exit 0 when no row fails and 1 otherwise. No row and no error SHALL contain an API key.

#### Scenario: Everything works

- **WHEN** every check passes
- **THEN** `doctor` SHALL print only pass rows and exit 0

#### Scenario: Missing external API setting

- **WHEN** the external API lacks a model, an API URL or an API key
- **THEN** the model row SHALL name each missing setting in plain words, such as "The external API is missing: model, API URL, API key.", and SHALL NOT show a config key name

#### Scenario: No model test ran

- **WHEN** the web app ran no model test, because `--skip-model-test` was given or every test was skipped
- **THEN** `doctor` SHALL NOT print the note that a test prompt was sent

#### Scenario: Default Pi or OpenCode user

- **WHEN** Pi or OpenCode uses its own session model and every other check passes
- **THEN** its model test row SHALL be skipped with no fix, every other row SHALL pass, and `doctor` SHALL exit 0

#### Scenario: One check fails

- **WHEN** one check fails
- **THEN** that row SHALL show the reason and a fix, and `doctor` SHALL exit 1

### Requirement: Setup and doctor write only OMMS records

In `setup`, a change means a host command or a host file. `doctor` SHALL change no host file and no OMMS setting. Like every terminal command, `setup` and `doctor` MAY record their own copy in the OMMS runtime record (`~/.omms/runtime.json` and the launcher `~/.omms/bin/omms-launch.mjs`). On a computer with no OMMS config, they MAY create the config template (`~/.config/omms/omms.jsonc`).

#### Scenario: Doctor on a set-up computer

- **WHEN** the user runs `doctor`
- **THEN** no host file and no OMMS setting SHALL change

#### Scenario: Doctor on a computer with no OMMS config

- **WHEN** the user runs `doctor --json` and no OMMS config exists
- **THEN** `doctor` MAY create the config template, and its message SHALL go to standard error, not standard output

### Requirement: Doctor checks Node and each host found

`doctor` SHALL check the Node version against the package minimum. For each host found it SHALL check the version against the host's minimum (OpenCode 2.0.22, Claude Code 2.1.295, Pi 0.86.1) and whether OMMS is registered. For OpenCode it SHALL check the `cli.json` entry. It SHALL print no row for a host that is not found.

#### Scenario: Pi only

- **WHEN** only Pi is installed and OMMS is registered with Pi
- **THEN** `doctor` SHALL print Pi rows and no OpenCode or Claude Code row

#### Scenario: Old host

- **WHEN** OpenCode 2.0.10 is found
- **THEN** the OpenCode version row SHALL fail and its fix SHALL say to update OpenCode to 2.0.22 or later

#### Scenario: Missing cli.json entry

- **WHEN** OpenCode is found and `cli.json` lacks the entry
- **THEN** the OpenCode auto-update row SHALL warn and its fix SHALL give the `setup` command or the manual step

### Requirement: Doctor checks the web app port

`doctor` SHALL check whether an OMMS web app answers on the configured port and SHALL name the port in the row. When another program answers on the port, the row SHALL fail, say so, and its fix SHALL say to stop that program or set `webServerPort` to a free port. When nothing answers, the fix SHALL give the command that starts the web app.

#### Scenario: Port held by another program

- **WHEN** a program that is not OMMS answers on the configured port
- **THEN** the web app row SHALL fail, name the port, and say that another program uses it

### Requirement: Doctor reuses the Settings health checks

`doctor` SHALL get the embedding, external API and per-host capture rows from the same health checks as the Settings page, through the running web app with the local token. It SHALL drop rows that belong to a host that is not found. When no OMMS web app answers, these rows SHALL be skipped with the reason and the fix to start the web app. Without `--skip-model-test`, `doctor` SHALL make at most one short external API call and SHALL say that it did.

#### Scenario: Claude Code without an external API

- **WHEN** Claude Code is found and the external API has no model
- **THEN** the Claude Code capture row SHALL fail with the reason that capture needs the external API
- **AND** its fix SHALL name the External API card on the Settings page

#### Scenario: Web app down

- **WHEN** no OMMS web app answers
- **THEN** the embedding, external API and capture rows SHALL be skipped with the start command as the fix

#### Scenario: No model call

- **WHEN** `doctor --skip-model-test` runs
- **THEN** it SHALL make no external API call

### Requirement: Doctor explains a health request that fails

When the OMMS web app answers but does not return the health rows (a timeout, a refused request or an error), `doctor` SHALL skip those rows with the reason in plain words and a fix that does not tell the user to start the web app. When a browser password is set, `doctor` SHALL send it as Basic Auth, as the Claude Code hook does, and SHALL never print it.

#### Scenario: Web app answers but its checks time out

- **WHEN** the OMMS web app answers on its port and the health request times out
- **THEN** the rows SHALL be skipped with a plain reason and no error class name
- **AND** the fix SHALL point to Run checks on the Settings page or to `--skip-model-test`, and SHALL NOT tell the user to start the web app

### Requirement: Doctor prints JSON on request

`doctor --json` SHALL print one JSON array of objects with `check`, `status`, `reason`, `fix` and `host` keys, and nothing else on standard output. Warnings SHALL go to standard error.

#### Scenario: JSON output

- **WHEN** `doctor --json` runs
- **THEN** standard output SHALL hold one JSON array and nothing else

### Requirement: Each host shows one first-run notice

Each host SHALL show one notice at its first session after this change, once per host per computer. The notice SHALL state what OMMS does on its own and how to turn each part off. A part that is already off in the config SHALL be left out. The record of shown notices SHALL live in the global storage folder, so a memory space switch does not show it again. A failure to read or write that record SHALL NOT block the session.

#### Scenario: First Pi session

- **WHEN** Pi starts a session and the Pi notice has not been shown on this computer
- **THEN** Pi SHALL show the notice once
- **AND** the next Pi session SHALL NOT show it

#### Scenario: Space switch

- **WHEN** the user switches the active memory space after the notices were shown
- **THEN** no host SHALL show the notice again

### Requirement: The first-run notice names three behaviours

The notice SHALL name the automatic history import, which makes model calls (off: set `"autoBackfill": false` in the global config, or pause it on the Settings page); the login item that starts the web app at sign-in, on OpenCode and Pi only (off: set `"webServerAutoStart": false`); and the one-time local embedding model download (avoid it: set an embedding API URL).

#### Scenario: History import already off

- **WHEN** the global config sets `"autoBackfill": false` and OpenCode shows its first-run notice
- **THEN** the notice SHALL NOT mention the history import

#### Scenario: Claude Code has no login item

- **WHEN** Claude Code shows its first-run notice
- **THEN** the notice SHALL NOT mention a login item

### Requirement: Each host shows the first-run notice in its own way

Pi SHALL show the notice as a Pi notification. OpenCode SHALL show it through its terminal interface, and SHALL write it to the OpenCode log while no terminal interface has shown it. Claude Code SHALL show it to the user at the first `SessionStart` in the hook answer, and SHALL NOT add it to the model's context. `setup` SHALL print the same text before it asks.

#### Scenario: Claude Code first session

- **WHEN** the first Claude Code `SessionStart` runs with a hook that can show user lines
- **THEN** the user SHALL see the notice and the model context SHALL NOT contain it

#### Scenario: OpenCode without a terminal interface

- **WHEN** OpenCode runs as `opencode serve` with no terminal interface
- **THEN** the notice SHALL appear in the OpenCode log
