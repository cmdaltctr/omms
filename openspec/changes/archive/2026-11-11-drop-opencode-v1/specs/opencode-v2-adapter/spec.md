## RENAMED Requirements

- FROM: `### Requirement: The package loads under OpenCode v2 and V1 from one entrypoint`
- TO: `### Requirement: The package loads under OpenCode v2 only`

- FROM: `### Requirement: OpenCode v2 does not depend on V1 agent configuration`
- TO: `### Requirement: OpenCode v2 registers no internal agent`

## MODIFIED Requirements

### Requirement: The package loads under OpenCode v2 only

The package's default export SHALL be a valid OpenCode v2 plugin definition with the stable `id` `omms` and a `setup` function. The package SHALL NOT expose a V1 `server` entry, as a property of the default export or as a `./server` package export. OpenCode V1 SHALL NOT be able to load OMMS.

#### Scenario: OpenCode v2 loads the package

- **WHEN** OpenCode v2 resolves the `omms` package from `plugins`
- **THEN** it SHALL activate a plugin with `id` `omms`
- **AND** it SHALL register the `memory` tool

#### Scenario: OpenCode V1 loads the package

- **WHEN** OpenCode V1 resolves the package from `plugin`
- **THEN** the default export SHALL have no `server` property
- **AND** `package.json` `exports` SHALL have no `./server` key

#### Scenario: The plugin unloads or reloads

- **WHEN** OpenCode v2 disables, reloads, or shuts down the plugin
- **THEN** the plugin SHALL stop its event subscription and release per-session retrieval state and storage handles

### Requirement: OpenCode v2 registers no internal agent

On OpenCode v2, the plugin SHALL NOT register an internal agent, a config transform for an agent, or an agent name in its internal requests. Internal structured-output calls for automatic capture and profile learning SHALL use v2 sessionless generation, which exposes no tools.

#### Scenario: Automatic capture runs on v2

- **WHEN** automatic capture or profile learning requests structured output on OpenCode v2
- **THEN** the request SHALL be served without creating a user-visible session or agent
- **AND** the model SHALL NOT be offered any tools for that request

#### Scenario: The agent list after setup

- **WHEN** OpenCode v2 lists its agents after OMMS setup
- **THEN** the list SHALL NOT contain an agent that OMMS added

### Requirement: OpenCode v2 restores session memories after compaction or resume through v2 hooks

Only when `compaction.enabled` is on, the plugin SHALL use OpenCode v2 session hooks to make a session's own captured memories available to its later requests after compaction, and after resume. A resumed session SHALL be the first prompt this process sees for a session whose history already holds an earlier user prompt. The plugin SHALL NOT send a prompt or synthetic message into the session to do so.

#### Scenario: A session is compacted

- **WHEN** OpenCode v2 compacts a session that has captured memories
- **THEN** subsequent model requests in that session SHALL include a bounded restored-session memory section, limited by `compaction.memoryLimit`
- **AND** no prompt, synthetic message, or queued turn SHALL be added to the session by the plugin

#### Scenario: A session is resumed

- **WHEN** the user opens an earlier OpenCode v2 session that has captured memories and sends a prompt
- **THEN** that prompt's model requests and the later ones SHALL include the restored-session memory section
- **AND** the restored section SHALL be loaded once for that resume

#### Scenario: A new session is not a resume

- **WHEN** the first prompt of a new session arrives
- **THEN** no restored-session memory section SHALL be added

#### Scenario: Compaction restore disabled

- **WHEN** `compaction.enabled` is false
- **THEN** no restored-session memory section SHALL be added after compaction or resume

#### Scenario: Compaction event arrives on the event stream

- **WHEN** a v2 compaction event is observed on the public event stream
- **THEN** the plugin SHALL NOT run a second restore for it
- **AND** it SHALL NOT send a prompt or synthetic message into the session

### Requirement: The memory tool is a direct tool on OpenCode v2

On OpenCode v2 the `memory` tool SHALL be registered on the provider's native tool list (not only inside the Code Mode catalog), so the model can see and call it directly as it can on Pi.

#### Scenario: A model request is built

- **WHEN** OpenCode v2 sends a model request in a session where omms is active
- **THEN** the request's tool list SHALL include `memory` as a directly callable tool

## ADDED Requirements

### Requirement: Every OpenCode behaviour uses the v2 plugin API

The plugin SHALL register its tools, its import command, its skills and its session hooks through the OpenCode v2 plugin context. It SHALL NOT define, wrap or call V1 plugin hooks. Each capability the plugin had on OpenCode v2 before this change SHALL keep working.

#### Scenario: The memory and skills tools run

- **WHEN** the model calls `memory` or `skills` on OpenCode v2
- **THEN** the tool SHALL run the shared operation and return the same result as before this change for the same arguments

#### Scenario: The import command runs

- **WHEN** the user runs `/memory-import-opencode-history` on OpenCode v2
- **THEN** the import SHALL run and its report SHALL be added to the session as a synthetic message

#### Scenario: The package skills load

- **WHEN** an OpenCode v2 session starts
- **THEN** the skill list SHALL contain `omms-memory` and `omms-remember` from the installed package

### Requirement: OpenCode code calls the v2 context directly

OMMS OpenCode code SHALL read sessions, messages and models and SHALL request generations through the v2 plugin context. It SHALL NOT wrap the v2 context in a V1 SDK client shape. The package SHALL NOT depend on `@opencode-ai/plugin` or `@opencode-ai/sdk`.

#### Scenario: Structured output for capture or profile learning

- **WHEN** automatic capture or profile learning requests structured output on OpenCode v2
- **THEN** the plugin SHALL make one v2 sessionless text generation request and parse its JSON reply
- **AND** it SHALL NOT create, prompt, abort or delete a session for that request

#### Scenario: Capture reads a conversation

- **WHEN** automatic capture or profile learning reads a session's conversation on OpenCode v2
- **THEN** it SHALL read the v2 session messages and treat user, synthetic and assistant messages, including assistant text and tool items, as it did before this change

#### Scenario: Settings lists OpenCode models

- **WHEN** the web Settings page asks for the OpenCode model list while the plugin runs
- **THEN** the list SHALL come from the v2 model list, grouped by provider

#### Scenario: Package dependencies

- **WHEN** the published `package.json` is read
- **THEN** its `dependencies` SHALL NOT contain `@opencode-ai/plugin` or `@opencode-ai/sdk`

### Requirement: OpenCode capture runs from the v2 event stream

The plugin SHALL start automatic capture, skill-turn recording and profile learning from session events that it reads through the v2 event subscription. It SHALL wait 10 seconds after a session goes idle before it starts this work, as it did before this change. It SHALL skip sessions that OMMS created for its own model calls.

#### Scenario: A session goes idle

- **WHEN** a user session goes idle and capture is on
- **THEN** capture SHALL run for that session after 10 seconds
- **AND** profile learning and the cleanup check SHALL run after capture

#### Scenario: Skill learning only

- **WHEN** a session goes idle, capture is off and `skillLearning` is on
- **THEN** the turn SHALL be recorded for skill learning
- **AND** no memory capture or profile learning SHALL run

#### Scenario: A session is created

- **WHEN** a user session is created and capture is on
- **THEN** the capture retry drain SHALL start for OpenCode

#### Scenario: An OMMS internal session

- **WHEN** an idle or created event names a session that OMMS created for its own model calls
- **THEN** no capture, retry drain or profile learning SHALL start for it

### Requirement: OpenCode records the session model through the v2 context hook

When live capture follows the session model (`opencodeModel` is `"inherit"`), the plugin SHALL store the model of each model request on the recorded prompt row from the v2 `context` hook, after it records the admitted prompts.

#### Scenario: The host model is inherit

- **WHEN** `opencodeModel` is `"inherit"` and a model request runs
- **THEN** the recorded prompt row SHALL hold that request's provider and model id

#### Scenario: A fixed host model

- **WHEN** `opencodeProvider` and `opencodeModel` name a fixed model
- **THEN** the plugin SHALL NOT change the prompt row's model

#### Scenario: A call has no prompt model

- **WHEN** `opencodeModel` is `"inherit"` and profile learning or another call has no prompt model, after a model request ran
- **THEN** the call SHALL use the latest model request's provider and model
- **AND** it SHALL do so when OpenCode's `model.json` does not exist
