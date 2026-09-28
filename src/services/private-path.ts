import { execFileSync } from "node:child_process";
import { chmodSync } from "node:fs";

const WINDOWS_USER_ONLY_ACL = `$ErrorActionPreference = 'Stop'
$path = $env:OMMS_PRIVATE_PATH
$isDirectory = [System.IO.Directory]::Exists($path)
$acl = if ($isDirectory) {
  [System.IO.Directory]::GetAccessControl($path)
} else {
  [System.IO.File]::GetAccessControl($path)
}
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier])
if ($owner.Value -ne $currentUser.Value) {
  throw 'Path has a different owner'
}
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.Access)) {
  [void]$acl.RemoveAccessRuleSpecific($rule)
}
$inheritance = if ($isDirectory) {
  [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
} else {
  [System.Security.AccessControl.InheritanceFlags]::None
}
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
  $currentUser,
  [System.Security.AccessControl.FileSystemRights]::FullControl,
  $inheritance,
  [System.Security.AccessControl.PropagationFlags]::None,
  [System.Security.AccessControl.AccessControlType]::Allow
)
$acl.AddAccessRule($rule)
if ($isDirectory) {
  [System.IO.Directory]::SetAccessControl($path, $acl)
} else {
  [System.IO.File]::SetAccessControl($path, $acl)
}`;

type WindowsAclRunner = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number; windowsHide: boolean; stdio: "ignore" }
) => void;

/**
 * Restrict a path to the current user: `chmod` on macOS and Linux, and on
 * Windows an access list with inheritance removed and one full-control rule
 * for the owner, who must be the current user.
 */
export function restrictToCurrentUser(
  path: string,
  mode: number,
  platform = process.platform,
  run: WindowsAclRunner = execFileSync
): void {
  if (platform !== "win32") {
    chmodSync(path, mode);
    return;
  }
  run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_USER_ONLY_ACL], {
    env: { ...process.env, OMMS_PRIVATE_PATH: path },
    timeout: 10_000,
    windowsHide: true,
    stdio: "ignore",
  });
}
