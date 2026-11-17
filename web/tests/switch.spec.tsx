import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Switch } from "../src/lib/components/ui/switch.tsx";

const tag = (html: string) => html.match(/<button[^>]*>/)![0];

it("renders a native button with role switch and aria-checked", () => {
  const off = tag(
    renderToStaticMarkup(<Switch id="s" checked={false} onCheckedChange={() => {}} />)
  );
  expect(off).toContain('role="switch"');
  expect(off).toContain('type="button"');
  expect(off).toContain('aria-checked="false"');
  expect(off).toContain('id="s"');
  const on = tag(renderToStaticMarkup(<Switch checked onCheckedChange={() => {}} />));
  expect(on).toContain('aria-checked="true"');
  expect(on).toContain('data-state="checked"');
});

it("flips the value on click, which a native button also gets from Space and Enter", () => {
  const seen: boolean[] = [];
  const turnOn = Switch({ checked: false, onCheckedChange: (value) => seen.push(value) }) as {
    props: { onClick: () => void };
  };
  turnOn.props.onClick();
  const turnOff = Switch({ checked: true, onCheckedChange: (value) => seen.push(value) }) as {
    props: { onClick: () => void };
  };
  turnOff.props.onClick();
  expect(seen).toEqual([true, false]);
});

it("keeps a disabled switch disabled and passes aria props through", () => {
  const html = tag(
    renderToStaticMarkup(
      <Switch checked disabled aria-describedby="help" onCheckedChange={() => {}} />
    )
  );
  expect(html).toContain("disabled");
  expect(html).toContain('aria-describedby="help"');
});

it("has a focus ring and mirrors its thumb in right-to-left layouts", () => {
  const html = renderToStaticMarkup(<Switch checked onCheckedChange={() => {}} />);
  expect(html).toContain("focus-visible:ring-2");
  expect(html).toContain("rtl:");
});
