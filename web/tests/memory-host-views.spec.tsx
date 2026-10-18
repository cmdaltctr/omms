import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HostCard } from "../src/lib/components/memory/HostCard";
import { HostView } from "../src/lib/components/memory/HostView";
import { MemoryOverview } from "../src/lib/components/memory/MemoryOverview";
import { WriteHealthNotice } from "../src/lib/components/memory/WriteHealthStrip";
import { allSetUp, fakeStatuses, hosts } from "./fake-statuses";

it("shows the four cards in order, each linking to its own view", () => {
  const html = renderToStaticMarkup(
    <MemoryOverview statuses={fakeStatuses(allSetUp)} profilePreset={0} />
  );
  const links = [...html.matchAll(/href="(\/memory\/[a-z-]+)"/g)].map((match) => match[1]);
  expect(links).toEqual([
    "/memory/pi",
    "/memory/opencode",
    "/memory/claude-code",
    "/memory/shared",
  ]);
  const names = ["Pi", "OpenCode", "Claude Code", "Shared"].map((name) =>
    html.indexOf(`>${name}<`)
  );
  expect(names.every((index) => index > 0)).toBe(true);
  expect([...names].sort((a, b) => a - b)).toEqual(names);
  // Every card sits in the same grid cell shape.
  expect(html.match(/<li class="min-w-0">/g)).toHaveLength(4);
});

it("offers Change icon on the three hosts only, and the all-hosts import with its cost note", () => {
  const html = renderToStaticMarkup(
    <MemoryOverview statuses={fakeStatuses(allSetUp)} profilePreset={0} />
  );
  expect(html.match(/aria-label="Change icon: /g)).toHaveLength(3);
  expect(html).not.toContain("Change icon: Shared");
  expect(html).toContain("Import all hosts");
  expect(html).toContain("can cost money");
  // The all-hosts form stays closed until asked for.
  expect(html).not.toContain("Import chat history");
});

it("turns a card amber and says why memories are not saved, in text", () => {
  const html = renderToStaticMarkup(
    <HostCard view="opencode" line="Imported" warning="Embedding server error (500)" />
  );
  expect(html).toContain("border-[var(--status-warning)]");
  expect(html).toContain("Memories not saved");
  expect(html).toContain("Embedding server error (500)");
  expect(html).not.toContain(">Imported<");
});

it("greys a card for a host that is not set up and says so", () => {
  const html = renderToStaticMarkup(
    <MemoryOverview statuses={fakeStatuses({ ...allSetUp, pi: false })} profilePreset={0} />
  );
  expect(html).toContain("opacity-70");
  expect(html).toContain("Not set up");
});

it("shows Not set up, not the write warning, on a host that is not set up while memories fail", () => {
  const html = renderToStaticMarkup(
    <HostCard view="pi" line="Not set up" warning={null} notSetUp />
  );
  expect(html).toContain("Not set up");
  expect(html).not.toContain("Memories not saved");
  expect(html).not.toContain("border-[var(--status-warning)]");
});

it("names the failing service, how to recover, and offers Check again", () => {
  const html = renderToStaticMarkup(
    <WriteHealthNotice reason="Embedding server error (500)" checking={false} onCheck={() => {}} />
  );
  expect(html).toContain('role="alert"');
  expect(html).toContain("Memories are not being saved.");
  expect(html).toContain("Embedding server error (500).");
  expect(
    renderToStaticMarkup(
      <WriteHealthNotice
        reason="Memory store cannot be opened."
        checking={false}
        onCheck={() => {}}
      />
    )
  ).not.toContain("opened..");
  expect(html).toContain("Check again");
  expect(html).not.toMatch(/Check again<\/button>.*disabled/);
  expect(
    renderToStaticMarkup(<WriteHealthNotice reason="x" checking onCheck={() => {}} />)
  ).toContain("disabled");
});

it("shows only the chosen host's sessions, folders and settings", () => {
  const html = renderToStaticMarkup(
    <HostView host="opencode" statuses={fakeStatuses(allSetUp)} profilePreset={0} />
  );
  expect(html).toContain("OpenCode: Unresolved directories");
  expect(html).not.toContain("Pi: Unresolved directories");
  expect(html).not.toContain("Claude Code: Unresolved directories");
  expect(html).toContain('id="host-unresolved"');
  expect(html).toContain("OpenCode settings");
  expect(html).not.toContain("Pi settings");
  expect(html).toContain('aria-label="OpenCode Backfill model"');
  // The sessions list is for this host alone.
  expect(html).toContain("Sessions");
  expect(html).not.toContain("Selected hosts");
  // Shared settings are not repeated in a host view.
  for (const shared of ["Reranker", "Keyword matching", "Profile learning", ">Saved maps<"]) {
    expect(html).not.toContain(shared);
  }
});

it("marks the host on screen in the switcher", () => {
  const html = renderToStaticMarkup(
    <HostView host="pi" statuses={fakeStatuses(allSetUp)} profilePreset={0} />
  );
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toMatch(
    /href="\/memory\/pi"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/memory\/pi"/
  );
});

it("replaces the sessions and settings with a setup note for a host that is not set up", () => {
  const html = renderToStaticMarkup(
    <HostView host="pi" statuses={fakeStatuses({ ...allSetUp, pi: false })} profilePreset={0} />
  );
  expect(html).toContain("This host is not set up on this machine.");
  expect(html).toContain("How to set up");
  expect(html).toContain("docs/pi-adapter.md");
  expect(html).toContain("did not find this host");
  expect(html).not.toContain('id="host-unresolved"');
  expect(html).not.toContain("Pi settings");
});

it("draws every avatar kind in the same square frame, with images filling it from the centre", async () => {
  const { HostAvatar } = await import("../src/lib/components/memory/HostAvatar");
  const frames = [
    renderToStaticMarkup(<HostAvatar host="pi" look={{ kind: "default" }} />),
    renderToStaticMarkup(<HostAvatar host="pi" look={{ kind: "icon", icon: "terminal" }} />),
    renderToStaticMarkup(
      <HostAvatar host="pi" look={{ kind: "image", image: "data:image/png;base64,AAAA" }} />
    ),
    renderToStaticMarkup(<HostAvatar host="pi" look={{ kind: "icon", icon: "not-an-icon" }} />),
  ];
  for (const html of frames) {
    expect(html).toContain("size-10");
    expect(html).toContain("overflow-hidden");
    expect(html).toContain("rounded-[10px]");
    expect(html).toContain('aria-hidden="true"');
  }
  expect(frames[2]).toContain("object-cover");
  expect(frames[2]).toContain('alt=""');
  // A name the picker does not know shows the default monogram instead of nothing.
  expect(frames[3]).toContain(">Pi<");
  expect(frames[1]).toContain("lucide-terminal");
});

it("gives each host its own monogram so the defaults are told apart", async () => {
  const { HostAvatar } = await import("../src/lib/components/memory/HostAvatar");
  const marks = hosts.map((host) =>
    renderToStaticMarkup(<HostAvatar host={host} look={{ kind: "default" }} />).replace(
      /<[^>]+>/g,
      ""
    )
  );
  expect(marks).toEqual(["Pi", "OC", "CC"]);
});

it("opens every folder row in a host view so its folder field is visible, and keeps them closed in a list of many hosts", async () => {
  const { DirectoryMapHost } = await import("../src/lib/components/settings/DirectoryMapHost");
  const rows = [
    { directory: "/private/tmp/oc-mem-phase1/project", sessions: 7, suggestion: null },
    { directory: "/Users/me/Open Design/x", sessions: 13, suggestion: null },
  ];
  const render = (open: boolean) =>
    renderToStaticMarkup(
      <DirectoryMapHost
        host="opencode"
        rows={rows}
        decisions={{}}
        busy={false}
        open={open}
        onDecide={() => {}}
        onResolve={() => {}}
        onIgnore={() => {}}
      />
    );
  // One outer disclosure plus one per row.
  expect(render(true).match(/<details[^>]* open/g)).toHaveLength(3);
  expect(render(false).match(/<details[^>]* open/g)).toBeNull();
  expect(render(true)).toContain(
    'aria-label="/private/tmp/oc-mem-phase1/project Target directory"'
  );
});
