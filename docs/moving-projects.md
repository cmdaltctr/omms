# Moving projects and sharing memory

OMMS keeps one memory store per project. This page covers:

- workspaces with several repositories
- projects you moved or renamed
- moving memories between machines

For a move to a new machine, see
[Pi history import: Moving machines](pi-history-import.md#moving-machines).

## One memory for several nested repositories

By default, OMMS identifies a project by its enclosing git repository. Each git
repository gets its own separate memory store.

This does not suit a workspace where several nested git repositories form one
project. Examples are trees managed by Google
[`repo`](https://gerrit.googlesource.com/git-repo/+/HEAD/Docs/manual-repo.md)
and some monorepos. Each sub-repository would get its own memory.

To share one memory, put an empty **`.omms-project`** marker file at the
workspace root. The legacy `.opencode-mem-project` marker still works and gives
the same project identity.

```
my-workspace/
├── .omms-project           ← workspace root
├── kernel/                 (own git repo)
├── userspace/              (own git repo)
└── tools/                  (own git repo)
```

```sh
touch ~/my-workspace/.omms-project
```

Every session started anywhere under the marker then uses that root and shares
one memory store. It does not matter which sub-repository you work in.

How OMMS finds the marker:

- It walks up from the working directory it already receives. That is the
  plugin's working directory, or `process.cwd()` for the web API.
- So the identity depends only on the directory, not on the process.
- It does not use environment variables or a global config value. Several
  OpenCode processes share one web server, and only some of them would carry
  a given environment variable.

The marker takes priority over git detection. With a marker, OMMS ignores the
sub-repository's own git remote, because it describes only one nested
repository. Without a marker, OMMS uses git-based identity as before.

## Moving or recovering project memories

OMMS names each project shard (memory database file) by a hash of the project
identity. When you move a repository, the old shard under
`~/.omms/data/projects/` can be left behind, and OMMS creates a new empty
shard for the new path. This can happen after an OS migration, a folder
reorganisation, or a switch from a Windows mount to a native path.

The examples below are `memory` tool calls with JSON arguments. They are not
terminal commands. The notation `memory migrate --from ...` means
`memory({ mode: "migrate", fromPath: "..." })`.

### 1. Local move when you know the old path

1. Open OpenCode in the **new** project directory.
2. Check that the new project has no memories yet. Migration stops, with no
   changes, if it does.
3. Preview the source, destination and file actions with `dryRun: true`.
4. Run the migration without `dryRun`.

```typescript
memory({ mode: "migrate", fromPath: "/old/path/to/project", dryRun: true });
memory({ mode: "migrate", fromPath: "/old/path/to/project" });
```

- For safety, migration refuses a source whose stored project directory still
  exists.
- To move an active source on purpose, check the dry-run output first. Then
  pass `allowLinkedSource: true`.
- OMMS keeps the original source shard files as timestamped
  `*.pre-path-migrate-*.bak` backups.

### 2. The old path is gone

1. List the shards to find the orphaned one.
2. Migrate it by its hash.

```typescript
memory({ mode: "list-shards" });
memory({ mode: "migrate", fromHash: "fa645294d88bbae2" });
```

- `list-shards` reports each project hash, the stored `projectPath`, the
  memory count, and a status. The status is `current`, `linked`, `orphaned`,
  `missing-file`, `empty` or `ambiguous`.
- `fromHash` is the 16-character lowercase hexadecimal `scopeHash` from that
  list.
- Use `fromHash` when the old directory no longer exists. Also use it when
  several shards have the same stored path. OMMS cannot always work out a
  git-based identity from a missing path.

### 3. Backup and restore across machines

```typescript
// on the source machine or old checkout
memory({ mode: "export", outputPath: "./memories.json" });

// on the destination machine or new checkout
memory({ mode: "import", inputPath: "./memories.json", dryRun: true });
memory({ mode: "import", inputPath: "./memories.json" });
```

- Export writes a versioned JSON document without vectors.
- Import moves the memories onto the current project. It computes new
  embeddings with the model that is set now.
- Import adds memories to a project that already has some. But if any memory
  ID is already there, the whole import stops before it writes anything.
  `migrate` is different: it needs an empty target.
- The document contains `schemaVersion: 1`. Import refuses newer schema
  versions it does not support, instead of guessing.
- Fully private entries are left out. User profiles and prompt history are not
  included.

> **Keep export files safe.** They are plain text. They can contain memory
> content, user names, email addresses, repository URLs and absolute project
> paths. Store them like other sensitive backups, and delete them when you no
> longer need them.
