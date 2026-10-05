/** Exercise reviewed maps and retained drafts against the synthetic preview only. */
export async function checkDirectoryMaps() {
  const probe = await fetch("/api/health");
  if (probe.headers.get("X-OMMS-Visual-Fixture") !== "synthetic-only")
    throw new Error("Use the synthetic preview");
  const section = document.querySelector<HTMLElement>("#directory-maps")!;
  const hosts = [...section.querySelectorAll<HTMLDetailsElement>(":scope > details")];
  const checks: string[] = [];
  const assert = (condition: boolean, name: string) => {
    if (!condition) throw new Error(name);
    checks.push(name);
  };
  const wait = async (condition: () => boolean) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (condition()) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Preview state did not settle");
  };
  const button = (root: Element, label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent?.trim() === label
    )!;
  const selected = (host: HTMLElement) =>
    [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter(
      (input) => input.checked
    ).length;
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
  const target = async (row: HTMLDetailsElement, value: string) => {
    row.open = true;
    const input = row.querySelector<HTMLInputElement>("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(() => input.value === value);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };
  assert(
    hosts.every((host) => !host.open),
    "Hosts initially collapsed"
  );
  hosts[0].open = true;
  hosts[1].open = true;
  const rows = [...hosts[0].querySelectorAll<HTMLDetailsElement>("details")];
  assert(
    rows.length === 32 && rows.every((row) => !row.open),
    "Long list starts with compact rows"
  );
  await target(rows[0], "");
  await target(rows[1], "/synthetic/manually-edited-target");
  const other = hosts[1].querySelectorAll<HTMLDetailsElement>("details")[1];
  await target(other, "/synthetic/retained-draft");
  button(section, "Remove").click();
  button(hosts[0], "Select all with targets").click();
  await wait(() => selected(hosts[0]) === 31);
  assert(selected(hosts[0]) === 31, "Selection preserves an explicitly cleared target");
  const opener = button(hosts[0], "Smart resolve directories");
  opener.focus();
  opener.click();
  await wait(() => !!dialog());
  assert(
    dialog()!.textContent!.includes("Proposed maps: 31"),
    "Review includes already selected maps"
  );
  assert(
    dialog()!.textContent!.includes("Unmapped rows: 2"),
    "Cleared and no-directory rows stay unmapped"
  );
  assert(
    dialog()!.textContent!.includes("/synthetic/manually-edited-target"),
    "Review keeps a manual target"
  );
  button(dialog()!, "Cancel").click();
  await wait(() => !dialog());
  await wait(() => document.activeElement === opener);
  assert(selected(hosts[0]) === 31, "Cancel changes no drafts and returns focus");
  const savedBefore = await fetch("/api/settings").then((response) => response.json());
  assert(
    savedBefore.settings.importPathMaps.value.length === 1,
    "Opening and cancelling saves nothing"
  );
  const originalFetch = window.fetch;
  let patches = 0;
  window.fetch = async (input, init) => {
    if (String(input) === "/api/settings" && init?.method === "PATCH") {
      patches++;
      if (patches === 1) return Response.json({ error: "Synthetic save failure" }, { status: 400 });
    }
    return originalFetch(input, init);
  };
  try {
    opener.focus();
    opener.click();
    await wait(() => !!dialog());
    button(dialog()!, "Confirm").click();
    await wait(() => !!dialog()?.querySelector('[role="alert"]'));
    assert(!!dialog() && patches === 1, "Failed save retains the review with an accessible error");
    button(dialog()!, "Confirm").click();
    await wait(() => !dialog() && section.textContent!.includes("Saved. Maps apply"));
    assert(patches === 2, "Explicit retry sends one additional save");
  } finally {
    window.fetch = originalFetch;
  }
  const saved = await fetch("/api/settings").then((response) => response.json());
  assert(
    saved.settings.importPathMaps.value.length === 32,
    "Only reviewed maps and existing saved maps persist"
  );
  assert(
    section.textContent!.includes("/synthetic/retained-draft"),
    "Other host target draft survives refresh"
  );
  assert(!!button(section, "Keep"), "Unrelated pending removal survives refresh");
  assert(
    !saved.settings.importPathMaps.value.some(
      (map: { from: string }) => map.from === "/synthetic/other-draft"
    ),
    "Other host draft remains unsaved"
  );
  hosts[2].open = true;
  button(hosts[2], "Smart resolve directories").click();
  await wait(() => !!dialog());
  assert(button(dialog()!, "Confirm").disabled, "No-target review disables Confirm");
  button(dialog()!, "Cancel").click();
  await wait(() => !dialog());
  return { checks, patches };
}
