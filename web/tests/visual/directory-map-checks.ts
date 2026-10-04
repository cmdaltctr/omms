/** Exercise directory-map drafts against the synthetic Vite fixture only. */
export async function checkDirectoryMaps() {
  if (location.origin !== "http://127.0.0.1:5179") throw new Error("Use the synthetic preview");
  const section = document.querySelector<HTMLElement>("#directory-maps")!;
  const hosts = [...section.querySelectorAll<HTMLDetailsElement>(":scope > details")];
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const checks: string[] = [];
  const assert = (condition: boolean, name: string) => {
    if (!condition) throw new Error(name);
    checks.push(name);
  };
  const click = async (host: HTMLDetailsElement, label: string) => {
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent?.trim() === label
    )!;
    button.click();
    await tick();
  };
  const setTarget = async (row: HTMLDetailsElement, value: string) => {
    row.querySelector("summary")!.click();
    const input = row.querySelector<HTMLInputElement>("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
  };
  const selected = (host: HTMLDetailsElement) =>
    [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter(
      (input) => input.checked
    ).length;
  assert(!hosts.some((host) => host.open), "Hosts initially collapsed");
  hosts[0].querySelector("summary")!.click();
  assert(hosts[0].open && !hosts[1].open && !hosts[2].open, "Pi expanded independently");
  const rows = [...hosts[0].querySelectorAll<HTMLDetailsElement>("details")];
  assert(rows.length === 32 && rows.every((row) => !row.open), "Long list has compact closed rows");
  await setTarget(rows[0], "");
  await setTarget(rows[1], "/synthetic/manually-edited-target");
  await click(hosts[0], "Select all with targets");
  assert(selected(hosts[0]) === 31, "Bulk excludes empty target and includes manual target");
  assert(
    !hosts[1].querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked,
    "Emptied shared source remains unselected"
  );
  await click(hosts[0], "Clear selection");
  assert(
    selected(hosts[0]) === 0 &&
      rows[1].querySelector<HTMLInputElement>("input")!.value ===
        "/synthetic/manually-edited-target",
    "Clear keeps target text"
  );
  rows[1].querySelector("summary")!.click();
  hosts[0].querySelector("summary")!.click();
  await tick();
  hosts[0].querySelector("summary")!.click();
  rows[1].querySelector("summary")!.click();
  await tick();
  assert(
    rows[1].querySelector<HTMLInputElement>("input")!.value === "/synthetic/manually-edited-target",
    "Draft survives host and row collapse"
  );
  await click(hosts[0], "Select all with targets");
  rows[1].querySelector("summary")!.click();
  hosts[0].querySelector("summary")!.click();
  hosts[0].querySelector("summary")!.click();
  rows[1].querySelector("summary")!.click();
  await tick();
  assert(selected(hosts[0]) === 31, "Selections survive disclosure toggles");
  await click(hosts[0], "Smart resolve directories");
  await click(hosts[0], "Smart resolve directories");
  assert(
    hosts[0].querySelector('[role="status"]')!.textContent!.includes("Already selected: 32"),
    "Repeated Smart resolve explains existing selection"
  );
  assert(
    hosts[1].querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked,
    "Shared source selection updates OpenCode"
  );
  hosts[2].querySelector("summary")!.click();
  await click(hosts[2], "Smart resolve directories");
  assert(
    hosts[2]
      .querySelector('[role="status"]')!
      .textContent!.includes("Choose targets for rows without suggestions."),
    "Missing suggestions explain manual targets"
  );
  const saved = await fetch("/api/settings").then((response) => response.json());
  assert(saved.settings.importPathMaps.value.length === 1, "Draft actions have not saved config");
  const save = [...section.querySelectorAll<HTMLButtonElement>(":scope > button")].find(
    (button) => button.textContent === "Save maps"
  )!;
  hosts.forEach((host) => {
    host.open = false;
  });
  save.scrollIntoView();
  assert(
    save.getBoundingClientRect().height > 0 && !save.disabled,
    "Save maps reachable with every host closed"
  );
  return { checks, selected: selected(hosts[0]) };
}
