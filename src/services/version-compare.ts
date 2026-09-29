const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

interface Parsed {
  core: number[];
  pre: string[];
}

function parse(version: string): Parsed | null {
  const match = SEMVER.exec(version.trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split(".") : [],
  };
}

function comparePart(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b));
  // A numeric part is older than a text part.
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Compare two versions in SemVer order. Returns a negative number when `a` is older,
 * a positive number when `a` is newer, `0` when equal, and `null` when either
 * version cannot be parsed, such as `unknown`.
 */
export function compareVersions(a: string, b: string): number | null {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) {
    const diff = left.core[i]! - right.core[i]!;
    if (diff) return Math.sign(diff);
  }
  // A release is newer than any of its prereleases.
  if (!left.pre.length || !right.pre.length) return right.pre.length - left.pre.length;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const l = left.pre[i];
    const r = right.pre[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const diff = comparePart(l, r);
    if (diff) return diff;
  }
  return 0;
}

/** True only when `a` is provably older than `b`. An unplaceable version is never older. */
export function isOlderVersion(a: string, b: string): boolean {
  const order = compareVersions(a, b);
  return order !== null && order < 0;
}
