/**
 * The one list of hosts and each host's identity facts. Plain data with no
 * imports, so every layer and the web app (through `$shared/hosts`) can read it.
 * Per-host history code lives in `src/importer/host-importers.ts`.
 */

/** Every supported host, in the key order of every API object and list. */
export const HOSTS = ["pi", "opencode", "claude-code"] as const;

export type MemoryHost = (typeof HOSTS)[number];

export interface HostInfo {
  /** Display name in messages, reports and the web app. Not translated. */
  label: string;
  /** Article before the label, as in "An OpenCode import is already running". */
  article: "A" | "An";
  /** Name in the `import-<name>-history` commands. */
  commandName: string;
  /** The host can lend its session model to imports and backfill. */
  sessionModel: boolean;
  /** The host has in-session slash commands. */
  sessionCommands: boolean;
  /** Global config key of the backfill model; null means the external API only. */
  backfillModelKey: "piBackfillModel" | "opencodeBackfillModel" | null;
  /** History source option and its line in the import usage text. */
  sourceOption: { flag: "--root" | "--db"; usage: string };
}

export const HOST_INFO: Record<MemoryHost, HostInfo> = {
  pi: {
    label: "Pi",
    article: "A",
    commandName: "pi",
    sessionModel: true,
    sessionCommands: true,
    backfillModelKey: "piBackfillModel",
    sourceOption: {
      flag: "--root",
      usage: "  --root <dir>              Pi session root (default ~/.pi/agent/sessions)",
    },
  },
  opencode: {
    label: "OpenCode",
    article: "An",
    commandName: "opencode",
    sessionModel: true,
    sessionCommands: true,
    backfillModelKey: "opencodeBackfillModel",
    sourceOption: {
      flag: "--db",
      usage:
        "  --db <path>               OpenCode database (default ~/.local/share/opencode/opencode.db)",
    },
  },
  // Claude Code hooks cannot call a session model and have no session commands.
  "claude-code": {
    label: "Claude Code",
    article: "A",
    commandName: "claude",
    sessionModel: false,
    sessionCommands: false,
    backfillModelKey: null,
    sourceOption: {
      flag: "--root",
      usage:
        "  --root <dir>              Claude Code transcripts folder (default ~/.claude/projects)",
    },
  },
};

/** True when the value is a supported host id. */
export function isMemoryHost(value: unknown): value is MemoryHost {
  return typeof value === "string" && (HOSTS as readonly string[]).includes(value);
}

/** The host's display name in messages and reports. */
export function hostLabel(host: MemoryHost): string {
  return HOST_INFO[host].label;
}

/** Every host label in list order, as in "Pi, OpenCode or Claude Code" for `" or "`. */
export function hostLabelList(lastSeparator: ", " | " or " | ", or "): string {
  const labels = HOSTS.map(hostLabel);
  return `${labels.slice(0, -1).join(", ")}${lastSeparator}${labels.at(-1)}`;
}

/** The refusal for an unknown host, such as "Choose Pi, OpenCode, or Claude Code". */
export function hostChoiceMessage(): string {
  return `Choose ${hostLabelList(", or ")}`;
}
