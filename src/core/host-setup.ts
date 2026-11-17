// Types for the `setup` and `doctor` terminal commands. Each host adapter exports
// one `HostSetup`; the CLI lists them. This file holds types only and imports nothing.

export type HostId = "opencode" | "pi" | "claude-code";

/** What a host setup object may read from the machine. A test passes scratch values. */
export interface HostSetupDeps {
  env: Record<string, string | undefined>;
  home: string;
  platform: NodeJS.Platform;
  /** The host's binary as found on this machine, or null when it is absent. */
  program: string | null;
  /** File text, or null when the file is missing or unreadable. */
  readFile(path: string): string | null;
  /** Runs one program synchronously with captured output. Never throws. */
  run(command: string, args: string[]): { status: number | null; stdout: string; stderr: string };
}

/** One install command as an argument list. The CLI runs it without a shell string. */
export interface SetupStep {
  /** Plain words for the plan, for example "Add the plugin to OpenCode". */
  label: string;
  command: string;
  args: string[];
}

/** What `nextStep` knows about one host after detection. */
export interface HostFacts {
  id: HostId;
  /** Version found in `<binary> --version`, or null. */
  version: string | null;
  /** True when OMMS is already registered with the host. */
  registered: boolean;
  /** True when this `setup` run changed the host. An unchanged host needs no restart. */
  changed: boolean;
  /** True unless Claude Code capture needs the external API. Other hosts pass true. */
  captureReady: boolean;
  /** Link to the External API card on the Settings page. */
  settingsUrl: string;
}

/** A host file `setup` may change and `doctor` checks. */
export interface SetupFileCheck {
  /** Row name in `doctor`, for example "OpenCode auto-update". */
  check: string;
  path: string;
  /** `add`: `setup` will add the entry. `missing` and `broken`: only a manual step helps. */
  state: "present" | "add" | "missing" | "broken";
  /** Plain words. Empty when the state is `present`. */
  reason: string;
  /** Plain words. Empty when the state is `present`. */
  fix: string;
  /** Writes the entry atomically. Throws unless the state is `add`. */
  apply(): void;
}

export interface HostSetup {
  id: HostId;
  /** Display name, for example "Claude Code". */
  name: string;
  /** Where to get the host, for the "no host found" message. */
  homepage: string;
  /** Program name to look up, for example "opencode". */
  binary: string;
  /** Folders to search after `PATH`, from the home folder. */
  extraFolders(home: string): string[];
  /** Lowest version that has every OMMS feature, as `x.y.z`. */
  minVersion: string;
  /** True when the host installs the web app login item (`webServerAutoStart`). */
  loginItem: boolean;
  /** Read-only. True when OMMS is already registered with this host. */
  registered(deps: HostSetupDeps): boolean;
  /** The commands that install OMMS. An empty list when nothing is left to run. */
  installSteps(deps: HostSetupDeps): SetupStep[];
  /** One plain sentence: what to do after the install. Empty when nothing is left to do. */
  nextStep(facts: HostFacts): string;
  /** Read-only. Host files `setup` may change and `doctor` checks. */
  fileChecks?(deps: HostSetupDeps): SetupFileCheck[];
}

export type DoctorStatus = "pass" | "warn" | "fail" | "skipped";

/** One `doctor` row. `fix` is an empty string for a pass. `host` is null for a row about the machine. */
export interface DoctorRow {
  check: string;
  status: DoctorStatus;
  reason: string;
  fix: string;
  host: HostId | null;
}
