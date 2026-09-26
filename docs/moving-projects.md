# Moving projects and sharing memory

OMMS keeps one memory store per project. This page covers workspaces with several repositories, moved or renamed projects, and moving memories between machines. For a whole-machine move, see [Pi history import: Moving machines](pi-history-import.md#moving-machines).

## One memory for several nested repositories

By default a project is identified by its enclosing git repository, so every
physical git repo gets its own isolated memory store. That is wrong for
multi-repo workspaces — trees managed by Google [`repo`](https://gerrit.googlesource.com/git-repo/+/HEAD/Docs/manual-repo.md),
monorepos, or any layout where several nested git repositories belong to one
logical project — because each sub-repository would be siloed.

Drop an empty **`.omms-project`** marker file at the workspace root (the legacy
`.opencode-mem-project` marker is still honoured and gives the same project identity):

```
my-workspace/
├── .omms-project           ← workspace root
├── kernel/                 (own git repo)
├── userspace/              (own git repo)
└── tools/                  (own git repo)
```

Every session started anywhere underneath the marker then resolves onto that
root and shares one memory store, regardless of which sub-repo the working
directory lives in:

```sh
touch ~/my-workspace/.omms-project
```

The marker is looked up by walking up from the working directory that every
code path already passes in (the plugin's working directory, the web API's
`process.cwd()`), so identity is **directory-driven and process-independent**.
It does not rely on environment variables or a global config value, which
would be unreliable here: omms runs across multiple opencode processes
that share a single web server, and only some of those processes carry a
given env var. With the marker, the project root is always derived from where
the session actually runs.

The marker takes precedence over git detection. When it is present, the
sub-repo's own git remote is intentionally ignored (it would describe only one
nested repository). Without a marker, behavior is unchanged (git-based
identity).

## Moving or recovering project memories

omms keys project shards by a hash of the project identity. Moving a
repository (OS migration, path reorganization, switching from a Windows mount
to a native path) can therefore orphan the old shard under
`~/.omms/data/projects/` while a new empty shard is created for the
new path.

These are OpenCode `memory` tool calls with JSON arguments, not commands to
run in a terminal. The issue-style `memory migrate --from ...` notation maps
to `memory({ mode: "migrate", fromPath: "..." })`.

**1. Local move when you still know the old path**

Open OpenCode in the **new** project directory. The target project must not
already contain memories (migration aborts unchanged on conflict). Preview the
detected source, destination, and file actions before changing anything:

```typescript
memory({ mode: "migrate", fromPath: "/old/path/to/project", dryRun: true });
memory({ mode: "migrate", fromPath: "/old/path/to/project" });
```

For safety, migration refuses a source whose stored project directory still
exists. If you intentionally want to move an active source, inspect the dry-run
output first and then pass `allowLinkedSource: true`. Original source shard
files are retained as timestamped `*.pre-path-migrate-*.bak` backups.

**2. Old path is gone — discover the orphaned shard first**

```typescript
memory({ mode: "list-shards" });
memory({ mode: "migrate", fromHash: "fa645294d88bbae2" });
```

`list-shards` reports each project hash, stored `projectPath`, memory count,
and status (`current`, `linked`, `orphaned`, `missing-file`, `empty`, or
`ambiguous`). `fromHash` is the 16-character lowercase hexadecimal `scopeHash`
returned by this call. Prefer it when the old directory no longer exists or
multiple shards contain the same stored path, because git-based identities
cannot always be recomputed from a missing path.

**3. Cross-machine backup / restore**

```typescript
// on the source machine / old checkout
memory({ mode: "export", outputPath: "./memories.json" });

// on the destination machine / new checkout
memory({ mode: "import", inputPath: "./memories.json", dryRun: true });
memory({ mode: "import", inputPath: "./memories.json" });
```

Export writes a versioned JSON document without vectors. Import remaps the
memories onto the current project and recomputes embeddings with the currently
configured model. Import adds memories to an existing project, but duplicate
memory IDs abort the whole import before writing; this differs from `migrate`,
which requires an empty target.

Export files are plaintext and can contain memory content, user names/email
addresses, repository URLs, and absolute project paths. Store them like other
sensitive backups and delete them when no longer needed. Fully private entries
are omitted, and user profiles and prompt history are not included. The
document contains `schemaVersion: 1`; imports reject newer unsupported schema
versions rather than guessing.
