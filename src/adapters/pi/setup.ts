import { join } from "node:path";
import type { HostSetup } from "../../core/host-setup.js";
import { PI_INSTALL_ARGS, readPiSettings } from "./self-update.js";

// How `setup` and `doctor` see Pi. Registration is read from Pi's own
// `settings.json`; `setup` installs through `pi install`.

const SOURCE = "npm:om-memory-system";

/** True when Pi's settings list the OMMS package, with or without a version. */
export function piPackageListed(settingsText: string | null): boolean {
  if (settingsText === null) return false;
  let packages: unknown;
  try {
    packages = (JSON.parse(settingsText) as { packages?: unknown }).packages;
  } catch {
    return false;
  }
  if (!Array.isArray(packages)) return false;
  return packages.some((entry: unknown) => {
    const source =
      typeof entry === "string" ? entry : (entry as { source?: unknown } | null)?.source;
    return typeof source === "string" && (source === SOURCE || source.startsWith(`${SOURCE}@`));
  });
}

export const piSetup: HostSetup = {
  id: "pi",
  name: "Pi",
  homepage: "https://www.npmjs.com/package/@earendil-works/pi-coding-agent",
  binary: "pi",
  extraFolders: (home) => [join(home, ".pi", "agent", "bin")],
  minVersion: "0.86.1",
  loginItem: true,
  registered: (deps) => piPackageListed(readPiSettings(deps.env, deps.home, deps.readFile)),
  installSteps: () => [
    { label: "Install the OMMS package in Pi", command: "pi", args: PI_INSTALL_ARGS },
  ],
  nextStep: (facts) => (facts.changed ? "Restart Pi." : ""),
};
