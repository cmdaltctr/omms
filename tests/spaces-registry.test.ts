import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SPACE_ID,
  DEFAULT_SPACE_NAME,
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
  it("refuses a duplicate name without regard to case and names the existing space", () => {
    const { registry } = createSpace(emptyRegistry(), "Experiments", NOW);
    expect(codeOf(() => createSpace(registry, "experiments", NOW))).toBe("name-taken");
    try {
      createSpace(registry, "experiments", NOW);
    } catch (error) {
      expect((error as Error).message).toContain("Experiments");
    }
  });

  it("refuses the Default name without regard to case", () => {
    expect(codeOf(() => createSpace(emptyRegistry(), "default", NOW))).toBe("name-taken");
    expect(codeOf(() => createSpace(emptyRegistry(), "DEFAULT", NOW))).toBe("name-taken");
  });

  it("refuses an empty or too long name and accepts a name without letters or digits", () => {
    expect(codeOf(() => createSpace(emptyRegistry(), "   ", NOW))).toBe("invalid-name");
    expect(codeOf(() => createSpace(emptyRegistry(), "x".repeat(61), NOW))).toBe("invalid-name");
    expect(createSpace(emptyRegistry(), "!!!", NOW).space.id).toMatch(/^space-[a-z0-9]{10}$/);
  });
});

describe("createSpace with random ids", () => {
  it("gives a new space a random id, whatever the name", () => {
    const { registry, space } = createSpace(emptyRegistry(), "../Team B", NOW);
    expect(space.id).toMatch(/^space-[a-z0-9]{10}$/);
    expect(space.name).toBe("../Team B");
    expect(listSpaces(registry).some((s) => s.id === space.id)).toBe(true);
  });

  it("frees a renamed space's old name", () => {
    const { registry, space } = createSpace(emptyRegistry(), "Work", NOW);
    const renamed = renameSpace(registry, space.id, "Tech");
    const again = createSpace(renamed, "Work", NOW);
    expect(again.space.name).toBe("Work");
    expect(again.space.id).toMatch(/^space-[a-z0-9]{10}$/);
    expect(again.space.id).not.toBe(space.id);
    const tech = listSpaces(again.registry).find((s) => s.name === "Tech");
    expect(tech?.id).toBe(space.id);
  });

  it("keeps the id of a space that the registry already holds", () => {
    const dir = mkdtempSync(join(tmpdir(), "omms-spaces-"));
    try {
      const path = join(dir, "spaces.json");
      writeFileSync(
        path,
        JSON.stringify({
          version: 1,
          activeSpaceId: "default",
          spaces: [{ id: "work", name: "Work", createdAt: NOW, archived: false }],
        })
      );
      const read = readRegistryFile(path);
      const next = createSpace(read.registry, "Lab", NOW);
      expect(listSpaces(next.registry).find((s) => s.name === "Work")?.id).toBe("work");
      expect(listSpaces(read.registry)).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("redraws a drawn id that is already taken", () => {
    const { registry } = createSpace(emptyRegistry(), "First", NOW);
    const firstId = registry.spaces[0]!.id;
    const draws = [firstId, "space-aaaaaaaaaa"];
    const second = createSpace(registry, "Second", NOW, { drawId: () => draws.shift()! });
    expect(second.space.id).toBe("space-aaaaaaaaaa");
    expect(listSpaces(second.registry).some((s) => s.id === firstId)).toBe(true);
  });

  it("redraws a drawn id whose folder already exists on disk", () => {
    const draws = ["space-bbbbbbbbbb", "space-cccccccccc"];
    const { space } = createSpace(emptyRegistry(), "Lab", NOW, {
      drawId: () => draws.shift()!,
      avoidIds: ["space-bbbbbbbbbb"],
    });
    expect(space.id).toBe("space-cccccccccc");
  });
});

describe("archive, unarchive and switch", () => {
  const base = () => {
    const created = createSpace(emptyRegistry(), "Experiments", NOW);
    return { registry: created.registry, id: created.space.id };
  };

  it("archives and unarchives a space", () => {
    const { registry, id } = base();
    const archived = archiveSpace(registry, id);
    expect(listSpaces(archived).find((s) => s.id === id)?.archived).toBe(true);
    const back = unarchiveSpace(archived, id);
    expect(listSpaces(back).find((s) => s.id === id)?.archived).toBe(false);
  });

  it("refuses to archive Default or the active space", () => {
    expect(codeOf(() => archiveSpace(base().registry, DEFAULT_SPACE_ID))).toBe("protected");
    const { registry, id } = base();
    const active = switchSpace(registry, id);
    expect(codeOf(() => archiveSpace(active, id))).toBe("active");
  });

  it("refuses to switch to an archived or unknown space and lists valid targets", () => {
    const { registry, id } = base();
    const archived = archiveSpace(registry, id);
    expect(codeOf(() => switchSpace(archived, id))).toBe("archived");
    expect(codeOf(() => switchSpace(registry, "nope"))).toBe("unknown");
    try {
      switchSpace(archived, "nope");
    } catch (error) {
      expect((error as Error).message).toContain(
        "Spaces that can become active: Default (default)."
      );
      expect((error as Error).message).not.toContain(id);
    }
  });

  it("switches by id or by name without regard to case", () => {
    const { registry, id } = base();
    expect(switchSpace(registry, "Experiments").activeSpaceId).toBe(id);
    expect(switchSpace(registry, "EXPERIMENTS").activeSpaceId).toBe(id);
    expect(switchSpace(switchSpace(registry, id), "default").activeSpaceId).toBe(DEFAULT_SPACE_ID);
  });
});

describe("archive date", () => {
  const base = () => {
    const created = createSpace(emptyRegistry(), "Experiments", NOW);
    return { registry: created.registry, id: created.space.id };
  };
  const later = "2026-11-07T08:30:00.000Z";

  it("records when a space was archived and clears it on unarchive", () => {
    const { registry, id } = base();
    const archived = archiveSpace(registry, id, later);
    expect(listSpaces(archived).find((s) => s.id === id)?.archivedAt).toBe(later);
    const back = unarchiveSpace(archived, id);
    expect(listSpaces(back).find((s) => s.id === id)?.archivedAt).toBeUndefined();
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
    const { registry, space } = createSpace(emptyRegistry(), "Experiments", NOW);
    const renamed = renameSpace(registry, space.id, "Lab");
    const entry = listSpaces(renamed).find((s) => s.id === space.id);
    expect(entry?.name).toBe("Lab");
  });

  it("refuses a name that another space uses", () => {
    const first = createSpace(emptyRegistry(), "A", NOW).registry;
    const { registry } = createSpace(first, "B", NOW);
    expect(codeOf(() => renameSpace(registry, "b", "a"))).toBe("name-taken");
  });

  it("renames Default through a top-level defaultName and lists it first", () => {
    const { registry } = createSpace(emptyRegistry(), "Experiments", NOW);
    const renamed = renameSpace(registry, DEFAULT_SPACE_ID, "Main");
    expect(renamed.defaultName).toBe("Main");
    expect(renamed.spaces).toEqual(registry.spaces);
    const first = listSpaces(renamed)[0]!;
    expect(first.id).toBe(DEFAULT_SPACE_ID);
    expect(first.name).toBe("Main");
  });

  it("drops defaultName when Default is renamed back to Default, whatever the case", () => {
    const renamed = renameSpace(emptyRegistry(), DEFAULT_SPACE_ID, "Main");
    expect("defaultName" in renamed).toBe(true);
    expect("defaultName" in renameSpace(renamed, DEFAULT_SPACE_ID, "Default")).toBe(false);
    expect("defaultName" in renameSpace(renamed, DEFAULT_SPACE_ID, "default")).toBe(false);
    expect(listSpaces(renameSpace(renamed, DEFAULT_SPACE_ID, "Default"))[0]!.name).toBe(
      DEFAULT_SPACE_NAME
    );
  });

  it("refuses a Default name that another space uses and names that space", () => {
    const { registry } = createSpace(emptyRegistry(), "Experiments", NOW);
    expect(codeOf(() => renameSpace(registry, DEFAULT_SPACE_ID, "experiments"))).toBe("name-taken");
    try {
      renameSpace(registry, DEFAULT_SPACE_ID, "experiments");
    } catch (error) {
      expect((error as Error).message).toContain("Experiments");
    }
  });

  it("checks the length of a Default name like any other name", () => {
    expect(codeOf(() => renameSpace(emptyRegistry(), DEFAULT_SPACE_ID, "   "))).toBe(
      "invalid-name"
    );
    expect(codeOf(() => renameSpace(emptyRegistry(), DEFAULT_SPACE_ID, "x".repeat(61)))).toBe(
      "invalid-name"
    );
    expect(renameSpace(emptyRegistry(), DEFAULT_SPACE_ID, "y".repeat(60)).defaultName).toBe(
      "y".repeat(60)
    );
  });

  it("refuses to rename another space to the custom Default name", () => {
    const renamed = renameSpace(emptyRegistry(), DEFAULT_SPACE_ID, "Main");
    const { registry } = createSpace(renamed, "Lab", NOW);
    expect(codeOf(() => renameSpace(registry, "lab", "main"))).toBe("name-taken");
  });
});

describe("linkSpace", () => {
  const base = () => {
    let current = createSpace(emptyRegistry(), "Experiments", NOW);
    const experiments = current.space.id;
    current = createSpace(current.registry, "Client work", NOW);
    const clientWork = current.space.id;
    current = createSpace(current.registry, "Third", NOW);
    return {
      registry: current.registry,
      ids: { experiments, clientWork, third: current.space.id },
    };
  };
  const entry = (registry: ReturnType<typeof base>["registry"], id: string) =>
    registry.spaces.find((s) => s.id === id);

  it("adds a one-way link on the linking space only", () => {
    const { registry, ids } = base();
    const linked = linkSpace(registry, ids.experiments, "default");
    expect(entry(linked, ids.experiments)?.links).toEqual(["default"]);
    expect(spaceLinks(linked, ids.experiments)).toEqual([
      { id: "default", name: "Default", available: true },
    ]);
    expect(spaceLinks(linked, "default")).toEqual([]);
  });

  it("refuses a self-link and a repeat link", () => {
    const { registry, ids } = base();
    expect(codeOf(() => linkSpace(registry, ids.experiments, "Experiments"))).toBe("protected");
    const linked = linkSpace(registry, ids.experiments, "default");
    expect(codeOf(() => linkSpace(linked, ids.experiments, "Default"))).toBe("name-taken");
    expect(entry(linked, ids.experiments)?.links).toEqual(["default"]);
  });

  it("refuses a link to a space that does not exist and a link held by Default", () => {
    const { registry, ids } = base();
    expect(codeOf(() => linkSpace(registry, ids.experiments, "nope"))).toBe("unknown");
    expect(codeOf(() => linkSpace(registry, DEFAULT_SPACE_ID, ids.experiments))).toBe("protected");
  });

  it("does not copy the links of the linked space", () => {
    const { registry, ids } = base();
    let linked = linkSpace(registry, ids.clientWork, ids.third);
    linked = linkSpace(linked, ids.experiments, ids.clientWork);
    expect(entry(linked, ids.experiments)?.links).toEqual([ids.clientWork]);
  });
});

describe("unlinkSpace", () => {
  const base = () => {
    let current = createSpace(emptyRegistry(), "Experiments", NOW);
    const experiments = current.space.id;
    current = createSpace(current.registry, "Third", NOW);
    const third = current.space.id;
    let registry = linkSpace(current.registry, experiments, "default");
    registry = linkSpace(registry, experiments, third);
    return { registry, ids: { experiments, third } };
  };
  const entry = (registry: ReturnType<typeof base>["registry"], id: string) =>
    registry.spaces.find((s) => s.id === id);

  it("removes one link and keeps the others", () => {
    const { registry, ids } = base();
    const unlinked = unlinkSpace(registry, ids.experiments, "default");
    expect(entry(unlinked, ids.experiments)?.links).toEqual([ids.third]);
    expect(codeOf(() => unlinkSpace(unlinked, ids.experiments, "nope"))).toBe("unknown");
  });

  it("removes the last link and leaves no empty links field", () => {
    const { registry, ids } = base();
    let current = unlinkSpace(registry, ids.experiments, "default");
    current = unlinkSpace(current, ids.experiments, ids.third);
    expect(entry(current, ids.experiments)?.links).toBeUndefined();
  });

  it("unlinks by id a linked space that is gone from the registry", () => {
    const { registry, ids } = base();
    let current = removeSpace(registry, ids.third);
    expect(entry(current, ids.experiments)?.links).toEqual(["default", ids.third]);
    current = unlinkSpace(current, ids.experiments, ids.third);
    expect(entry(current, ids.experiments)?.links).toEqual(["default"]);
  });
});

describe("link availability", () => {
  const base = () => {
    let current = createSpace(emptyRegistry(), "Experiments", NOW);
    const experiments = current.space.id;
    current = createSpace(current.registry, "Third", NOW);
    const third = current.space.id;
    return {
      registry: linkSpace(current.registry, experiments, third),
      ids: { experiments, third },
    };
  };

  it("reads an archived linked space as unavailable and keeps the link", () => {
    const { registry, ids } = base();
    const archived = archiveSpace(registry, ids.third, NOW);
    expect(archived.spaces.find((s) => s.id === ids.experiments)?.links).toEqual([ids.third]);
    expect(spaceLinks(archived, ids.experiments)).toEqual([
      { id: ids.third, name: "Third", available: false },
    ]);
  });

  it("reads a removed linked space as unavailable with the id as name", () => {
    const { registry, ids } = base();
    const removed = removeSpace(registry, ids.third);
    expect(removed.spaces.find((s) => s.id === ids.experiments)?.links).toEqual([ids.third]);
    expect(spaceLinks(removed, ids.experiments)).toEqual([
      { id: ids.third, name: ids.third, available: false },
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
