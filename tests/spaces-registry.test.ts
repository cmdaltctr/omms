import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SPACE_ID,
  SpaceError,
  archiveSpace,
  createSpace,
  emptyRegistry,
  linkSpace,
  listSpaces,
  readRegistryFile,
  removeSpace,
  renameSpace,
  resolveSpaceFolder,
  spaceIdFromName,
  spaceLinks,
  switchSpace,
  unarchiveSpace,
  unlinkSpace,
} from "../src/services/spaces/registry.js";

const NOW = "2026-11-06T10:00:00.000Z";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof SpaceError) return error.code;
    throw error;
  }
  return undefined;
}

describe("spaceIdFromName", () => {
  it("turns an unsafe name into a safe id", () => {
    expect(spaceIdFromName("../Team B")).toBe("team-b");
  });

  it("collapses repeated separators and trims hyphens", () => {
    expect(spaceIdFromName("  --Client   work!! ")).toBe("client-work");
  });

  it("limits the id to 40 characters without a trailing hyphen", () => {
    const id = spaceIdFromName("a".repeat(39) + " b" + "c".repeat(20));
    expect(id.length).toBeLessThanOrEqual(40);
    expect(id.endsWith("-")).toBe(false);
  });

  it("returns an empty id when the name has no letters or digits", () => {
    expect(spaceIdFromName("!!!")).toBe("");
  });
});

describe("readRegistryFile", () => {
  function withFile(content: string | undefined, run: (path: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), "omms-spaces-"));
    try {
      const path = join(dir, "spaces.json");
      if (content !== undefined) writeFileSync(path, content);
      run(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("treats a missing file as Default only and active", () => {
    withFile(undefined, (path) => {
      const result = readRegistryFile(path);
      expect(result.problem).toBeUndefined();
      expect(result.registry.activeSpaceId).toBe(DEFAULT_SPACE_ID);
      expect(listSpaces(result.registry).map((s) => s.id)).toEqual([DEFAULT_SPACE_ID]);
    });
  });

  it("falls back to Default and reports a problem for invalid JSON", () => {
    withFile("{not json", (path) => {
      const result = readRegistryFile(path);
      expect(result.registry.activeSpaceId).toBe(DEFAULT_SPACE_ID);
      expect(result.problem).toContain("spaces.json");
    });
  });

  it("falls back to Default for a file with the wrong shape", () => {
    withFile(JSON.stringify({ version: 1, activeSpaceId: 5, spaces: "x" }), (path) => {
      const result = readRegistryFile(path);
      expect(result.problem).toBeDefined();
      expect(result.registry.activeSpaceId).toBe(DEFAULT_SPACE_ID);
    });
  });

  it("falls back to Default when the active space is not in the list", () => {
    withFile(JSON.stringify({ version: 1, activeSpaceId: "ghost", spaces: [] }), (path) => {
      const result = readRegistryFile(path);
      expect(result.problem).toContain("ghost");
      expect(result.registry.activeSpaceId).toBe(DEFAULT_SPACE_ID);
    });
  });

  it("reads a valid registry", () => {
    const file = {
      version: 1,
      activeSpaceId: "experiments",
      spaces: [{ id: "experiments", name: "Experiments", createdAt: NOW, archived: false }],
    };
    withFile(JSON.stringify(file), (path) => {
      const result = readRegistryFile(path);
      expect(result.problem).toBeUndefined();
      expect(result.registry.activeSpaceId).toBe("experiments");
      expect(listSpaces(result.registry).map((s) => s.name)).toEqual(["Default", "Experiments"]);
    });
  });
});

describe("createSpace", () => {
  it("derives the id from the name", () => {
    const { registry, space } = createSpace(emptyRegistry(), "../Team B", NOW);
    expect(space.id).toBe("team-b");
    expect(space.name).toBe("../Team B");
    expect(listSpaces(registry).some((s) => s.id === "team-b")).toBe(true);
  });

  it("refuses a duplicate name without regard to case and names the existing space", () => {
    const { registry } = createSpace(emptyRegistry(), "Experiments", NOW);
    expect(codeOf(() => createSpace(registry, "experiments", NOW))).toBe("name-taken");
    try {
      createSpace(registry, "experiments", NOW);
    } catch (error) {
      expect((error as Error).message).toContain("Experiments");
    }
  });

  it("refuses the reserved Default name and id", () => {
    expect(codeOf(() => createSpace(emptyRegistry(), "default", NOW))).toBe("name-taken");
    expect(codeOf(() => createSpace(emptyRegistry(), "DEFAULT!", NOW))).toBe("reserved");
  });

  it("refuses two names that give the same id", () => {
    const { registry } = createSpace(emptyRegistry(), "Team B", NOW);
    expect(codeOf(() => createSpace(registry, "Team-B", NOW))).toBe("id-taken");
  });

  it("refuses an empty or too long name", () => {
    expect(codeOf(() => createSpace(emptyRegistry(), "   ", NOW))).toBe("invalid-name");
    expect(codeOf(() => createSpace(emptyRegistry(), "x".repeat(61), NOW))).toBe("invalid-name");
    expect(codeOf(() => createSpace(emptyRegistry(), "!!!", NOW))).toBe("invalid-name");
  });
});

describe("archive, unarchive and switch", () => {
  const base = () => createSpace(emptyRegistry(), "Experiments", NOW).registry;

  it("archives and unarchives a space", () => {
    const archived = archiveSpace(base(), "experiments");
    expect(listSpaces(archived).find((s) => s.id === "experiments")?.archived).toBe(true);
    const back = unarchiveSpace(archived, "experiments");
    expect(listSpaces(back).find((s) => s.id === "experiments")?.archived).toBe(false);
  });

  it("refuses to archive Default or the active space", () => {
    expect(codeOf(() => archiveSpace(base(), DEFAULT_SPACE_ID))).toBe("protected");
    const active = switchSpace(base(), "experiments");
    expect(codeOf(() => archiveSpace(active, "experiments"))).toBe("active");
  });

  it("refuses to switch to an archived or unknown space and lists valid targets", () => {
    const archived = archiveSpace(base(), "experiments");
    expect(codeOf(() => switchSpace(archived, "experiments"))).toBe("archived");
    expect(codeOf(() => switchSpace(base(), "nope"))).toBe("unknown");
    try {
      switchSpace(archived, "nope");
    } catch (error) {
      expect((error as Error).message).toContain("default");
      expect((error as Error).message).not.toContain("experiments");
    }
  });

  it("switches by id or by name without regard to case", () => {
    expect(switchSpace(base(), "Experiments").activeSpaceId).toBe("experiments");
    expect(switchSpace(base(), "EXPERIMENTS").activeSpaceId).toBe("experiments");
    expect(switchSpace(switchSpace(base(), "experiments"), "default").activeSpaceId).toBe(
      DEFAULT_SPACE_ID
    );
  });
});

describe("archive date", () => {
  const base = () => createSpace(emptyRegistry(), "Experiments", NOW).registry;
  const later = "2026-11-07T08:30:00.000Z";

  it("records when a space was archived and clears it on unarchive", () => {
    const archived = archiveSpace(base(), "experiments", later);
    expect(listSpaces(archived).find((s) => s.id === "experiments")?.archivedAt).toBe(later);
    const back = unarchiveSpace(archived, "experiments");
    expect(listSpaces(back).find((s) => s.id === "experiments")?.archivedAt).toBeUndefined();
  });

  it("reads an archived entry without a date, as an older file has it", () => {
    const dir = mkdtempSync(join(tmpdir(), "omms-spaces-"));
    try {
      const path = join(dir, "spaces.json");
      writeFileSync(
        path,
        JSON.stringify({
          version: 1,
          activeSpaceId: "default",
          spaces: [{ id: "old", name: "Old", createdAt: NOW, archived: true }],
        })
      );
      const read = readRegistryFile(path);
      expect(read.problem).toBeUndefined();
      expect(listSpaces(read.registry)[1]!.archivedAt).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the date when the file is read again and refuses a date that is not text", () => {
    const dir = mkdtempSync(join(tmpdir(), "omms-spaces-"));
    try {
      const path = join(dir, "spaces.json");
      const entry = { id: "old", name: "Old", createdAt: NOW, archived: true, archivedAt: later };
      writeFileSync(
        path,
        JSON.stringify({ version: 1, activeSpaceId: "default", spaces: [entry] })
      );
      expect(listSpaces(readRegistryFile(path).registry)[1]!.archivedAt).toBe(later);
      writeFileSync(
        path,
        JSON.stringify({
          version: 1,
          activeSpaceId: "default",
          spaces: [{ ...entry, archivedAt: 5 }],
        })
      );
      expect(readRegistryFile(path).problem).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("links in the registry file", () => {
  function withFile(content: string, run: (path: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), "omms-spaces-"));
    try {
      const path = join(dir, "spaces.json");
      writeFileSync(path, content);
      run(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("reads an older file without links as valid and treats the space as unlinked", () => {
    withFile(
      JSON.stringify({
        version: 1,
        activeSpaceId: "default",
        spaces: [{ id: "old", name: "Old", createdAt: NOW, archived: false }],
      }),
      (path) => {
        const read = readRegistryFile(path);
        expect(read.problem).toBeUndefined();
        expect(listSpaces(read.registry)[1]!.links).toBeUndefined();
      }
    );
  });

  it("reads an entry that carries links", () => {
    withFile(
      JSON.stringify({
        version: 1,
        activeSpaceId: "default",
        spaces: [
          {
            id: "old",
            name: "Old",
            createdAt: NOW,
            archived: false,
            links: ["default", "second"],
          },
          { id: "second", name: "Second", createdAt: NOW, archived: false },
        ],
      }),
      (path) => {
        const read = readRegistryFile(path);
        expect(read.problem).toBeUndefined();
        expect(listSpaces(read.registry)[1]!.links).toEqual(["default", "second"]);
      }
    );
  });

  it("rejects an entry whose links field is not an array", () => {
    withFile(
      JSON.stringify({
        version: 1,
        activeSpaceId: "default",
        spaces: [{ id: "old", name: "Old", createdAt: NOW, archived: false, links: "default" }],
      }),
      (path) => {
        expect(readRegistryFile(path).problem).toBeDefined();
      }
    );
  });

  it("rejects an entry whose links hold a value that is not text", () => {
    withFile(
      JSON.stringify({
        version: 1,
        activeSpaceId: "default",
        spaces: [{ id: "old", name: "Old", createdAt: NOW, archived: false, links: ["second", 5] }],
      }),
      (path) => {
        expect(readRegistryFile(path).problem).toBeDefined();
      }
    );
  });
});

describe("renameSpace", () => {
  it("changes the name and keeps the id", () => {
    const { registry } = createSpace(emptyRegistry(), "Experiments", NOW);
    const renamed = renameSpace(registry, "experiments", "Lab");
    const space = listSpaces(renamed).find((s) => s.id === "experiments");
    expect(space?.name).toBe("Lab");
  });

  it("refuses a name that another space uses and refuses to rename Default", () => {
    const first = createSpace(emptyRegistry(), "A", NOW).registry;
    const { registry } = createSpace(first, "B", NOW);
    expect(codeOf(() => renameSpace(registry, "b", "a"))).toBe("name-taken");
    expect(codeOf(() => renameSpace(registry, DEFAULT_SPACE_ID, "Home"))).toBe("protected");
  });
});

describe("linkSpace", () => {
  const base = () => {
    let registry = createSpace(emptyRegistry(), "Experiments", NOW).registry;
    registry = createSpace(registry, "Client work", NOW).registry;
    return createSpace(registry, "Third", NOW).registry;
  };
  const entry = (registry: ReturnType<typeof base>, id: string) =>
    registry.spaces.find((s) => s.id === id);

  it("adds a one-way link on the linking space only", () => {
    const linked = linkSpace(base(), "experiments", "default");
    expect(entry(linked, "experiments")?.links).toEqual(["default"]);
    expect(spaceLinks(linked, "experiments")).toEqual([
      { id: "default", name: "Default", available: true },
    ]);
    expect(spaceLinks(linked, "default")).toEqual([]);
  });

  it("refuses a self-link and a repeat link", () => {
    const registry = base();
    expect(codeOf(() => linkSpace(registry, "experiments", "Experiments"))).toBe("protected");
    const linked = linkSpace(registry, "experiments", "default");
    expect(codeOf(() => linkSpace(linked, "experiments", "Default"))).toBe("name-taken");
    expect(entry(linked, "experiments")?.links).toEqual(["default"]);
  });

  it("refuses a link to a space that does not exist and a link held by Default", () => {
    expect(codeOf(() => linkSpace(base(), "experiments", "nope"))).toBe("unknown");
    expect(codeOf(() => linkSpace(base(), DEFAULT_SPACE_ID, "experiments"))).toBe("protected");
  });

  it("does not copy the links of the linked space", () => {
    let registry = linkSpace(base(), "client-work", "third");
    registry = linkSpace(registry, "experiments", "client-work");
    expect(entry(registry, "experiments")?.links).toEqual(["client-work"]);
  });
});

describe("unlinkSpace", () => {
  const base = () => {
    let registry = createSpace(emptyRegistry(), "Experiments", NOW).registry;
    registry = createSpace(registry, "Third", NOW).registry;
    const linked = linkSpace(registry, "experiments", "default");
    return linkSpace(linked, "experiments", "third");
  };
  const entry = (registry: ReturnType<typeof base>, id: string) =>
    registry.spaces.find((s) => s.id === id);

  it("removes one link and keeps the others", () => {
    const unlinked = unlinkSpace(base(), "experiments", "default");
    expect(entry(unlinked, "experiments")?.links).toEqual(["third"]);
    expect(codeOf(() => unlinkSpace(unlinked, "experiments", "nope"))).toBe("unknown");
  });

  it("removes the last link and leaves no empty links field", () => {
    let registry = unlinkSpace(base(), "experiments", "default");
    registry = unlinkSpace(registry, "experiments", "third");
    expect(entry(registry, "experiments")?.links).toBeUndefined();
  });

  it("unlinks by id a linked space that is gone from the registry", () => {
    let registry = removeSpace(base(), "third");
    expect(entry(registry, "experiments")?.links).toEqual(["default", "third"]);
    registry = unlinkSpace(registry, "experiments", "third");
    expect(entry(registry, "experiments")?.links).toEqual(["default"]);
  });
});

describe("link availability", () => {
  const base = () => {
    let registry = createSpace(emptyRegistry(), "Experiments", NOW).registry;
    registry = createSpace(registry, "Third", NOW).registry;
    return linkSpace(registry, "experiments", "third");
  };

  it("reads an archived linked space as unavailable and keeps the link", () => {
    const registry = archiveSpace(base(), "third", NOW);
    expect(registry.spaces.find((s) => s.id === "experiments")?.links).toEqual(["third"]);
    expect(spaceLinks(registry, "experiments")).toEqual([
      { id: "third", name: "Third", available: false },
    ]);
  });

  it("reads a removed linked space as unavailable with the id as name", () => {
    const registry = removeSpace(base(), "third");
    expect(registry.spaces.find((s) => s.id === "experiments")?.links).toEqual(["third"]);
    expect(spaceLinks(registry, "experiments")).toEqual([
      { id: "third", name: "third", available: false },
    ]);
  });
});

describe("resolveSpaceFolder", () => {
  const paths = { globalStoragePath: "/home/u/.omms/data", spacesRoot: "/home/u/.omms/spaces" };

  it("maps Default to the global storage path", () => {
    expect(resolveSpaceFolder(DEFAULT_SPACE_ID, paths)).toBe("/home/u/.omms/data");
  });

  it("maps another space to its own folder under the spaces root", () => {
    expect(resolveSpaceFolder("team-b", paths)).toBe(join(paths.spacesRoot, "team-b"));
  });

  it("refuses an id that could leave the spaces root", () => {
    expect(() => resolveSpaceFolder("../etc", paths)).toThrow();
  });
});
