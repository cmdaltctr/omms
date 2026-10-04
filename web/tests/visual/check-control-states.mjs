/**
 * Browser-only control-state evidence for the synthetic Vite fixture.
 *
 * Required environment:
 *   PUPPETEER_MODULE=/absolute/path/to/puppeteer-core/lib/puppeteer/puppeteer-core.js
 *   CHROME_EXECUTABLE=/absolute/path/to/Chrome
 *   PUPPETEER_USER_DATA_DIR=/absolute/path/to/isolated-browser-profile
 * Optional: VISUAL_BASE_URL, VISUAL_OUTPUT_PATH
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const baseUrl = process.env.VISUAL_BASE_URL ?? "http://127.0.0.1:5179";
const outputPath = resolve(
  process.env.VISUAL_OUTPUT_PATH ?? "docs/design-preview/control-states.json"
);
const driverPath = process.env.PUPPETEER_MODULE;
const executablePath = process.env.CHROME_EXECUTABLE;
const userDataDir = process.env.PUPPETEER_USER_DATA_DIR;

if (!driverPath || !executablePath || !userDataDir) {
  throw new Error(
    "Set PUPPETEER_MODULE, CHROME_EXECUTABLE, and PUPPETEER_USER_DATA_DIR before running this evidence runner."
  );
}

const { default: puppeteer } = await import(pathToFileURL(driverPath).href);
const fixtureOrigin = new URL(baseUrl).origin;
const results = [];
const failures = [];

function pass(name, details) {
  results.push({ name, status: "pass", details });
}

function fail(name, error) {
  const details = { message: error instanceof Error ? error.message : String(error) };
  results.push({ name, status: "fail", details });
  failures.push({ name, ...details });
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function check(name, action) {
  try {
    pass(name, await action());
  } catch (error) {
    fail(name, error);
  }
}

async function mountControls(page) {
  await page.evaluate(async () => {
    const module = await import("/tests/visual/control-samples.tsx");
    module.mountControlSamples();
  });
  await page.waitForSelector("[data-preview-controls]");
}

async function snapshot(page, selector) {
  return page.$eval(selector, (node) => {
    const rect = node.getBoundingClientRect();
    return {
      text: node.textContent?.trim(),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      colour: getComputedStyle(node).color,
      background: getComputedStyle(node).backgroundColor,
      active: node.matches(":active"),
    };
  });
}

function sameRect(left, right) {
  return ["x", "y", "width", "height"].every((key) => Math.abs(left[key] - right[key]) < 0.01);
}

async function contrastInfo(page, selector, property) {
  return page.$eval(
    selector,
    (node, propertyName) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      const colour = (value) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      };
      const composite = (front, back) => {
        const alpha = front[3] / 255;
        return front
          .slice(0, 3)
          .map((channel, index) => channel * alpha + back[index] * (1 - alpha))
          .concat(255);
      };
      const background = (element) => {
        const own = colour(getComputedStyle(element).backgroundColor);
        return composite(
          own,
          element.parentElement ? background(element.parentElement) : [255, 255, 255, 255]
        );
      };
      const luminance = (rgb) =>
        rgb
          .slice(0, 3)
          .map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const contrast = (left, right) => {
        const [high, low] = [luminance(left), luminance(right)].sort((a, b) => b - a);
        return (high + 0.05) / (low + 0.05);
      };
      const style = getComputedStyle(node);
      const value =
        propertyName === "ring" ? style.getPropertyValue("--ring") : style[propertyName];
      const backdrop = background(node.parentElement ?? document.body);
      return { value, backdrop, ratio: contrast(composite(colour(value), backdrop), backdrop) };
    },
    property
  );
}

async function loadTheme(page, theme) {
  await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle0" });
  await page.evaluate(
    (nextTheme) => document.documentElement.classList.toggle("dark", nextTheme === "dark"),
    theme
  );
  await mountControls(page);
}

let browser;
try {
  browser = await puppeteer.launch({
    headless: true,
    executablePath,
    userDataDir,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  const page = await browser.newPage();
  await page.bringToFront();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === fixtureOrigin) void request.continue();
    else void request.abort("blockedbyclient");
  });

  for (const theme of ["light", "dark"]) {
    await loadTheme(page, theme);
    await check(`${theme}: control dimensions`, async () => {
      const sizes = await page.evaluate(() =>
        Object.fromEntries(
          ["default", "sm", "lg", "xs"].map((size) => [
            size,
            document
              .querySelector(`[data-preview-id="button-size-${size}"]`)
              .getBoundingClientRect().height,
          ])
        )
      );
      const fields = await page.$$eval("[data-preview-id^='input-'], [role=combobox]", (nodes) =>
        nodes.map((node) => node.getBoundingClientRect().height)
      );
      expect(
        sizes.default === 36 && sizes.sm === 32 && sizes.lg === 40 && sizes.xs === 24,
        `button heights were ${JSON.stringify(sizes)}`
      );
      expect(
        fields.every((height) => height === 36),
        `field heights were ${JSON.stringify(fields)}`
      );
      return { sizes, fields };
    });

    await check(`${theme}: hover and pressed preserve layout`, async () => {
      const selector = '[data-preview-id="button-outline"]';
      const before = await snapshot(page, selector);
      const box = await (await page.$(selector)).boundingBox();
      expect(box, "button did not have a visible bounding box");
      const hitTest = await page.evaluate(
        (targetSelector, point) => {
          const target = document.querySelector(targetSelector);
          return document
            .elementsFromPoint(point.x, point.y)
            .some((node) => target?.contains(node) || node.contains(target));
        },
        selector,
        { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      );
      expect(hitTest, "button centre is covered by another layer before mouse down");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const hovered = await snapshot(page, selector);
      await page.mouse.down();
      await new Promise((resolve) => setTimeout(resolve, 16));
      const pressed = await snapshot(page, selector);
      await page.mouse.up();
      expect(pressed.active, "mouse down did not put the button in :active state");
      expect(
        sameRect(before.rect, hovered.rect) && sameRect(before.rect, pressed.rect),
        "hover or pressed state changed the button rectangle"
      );
      expect(
        before.text === hovered.text && before.text === pressed.text,
        "hover or pressed state changed the button label"
      );
      return { before, hovered, pressed };
    });

    await check(
      `${theme}: destructive sample hover and pressed keep destructive semantics`,
      async () => {
        const selector = '[data-preview-id="button-destructive"]';
        const before = await snapshot(page, selector);
        const tokens = await page.$eval(selector, (_node) => {
          const resolve = (name) => {
            const probe = document.createElement("span");
            probe.style.color = `var(${name})`;
            document.body.append(probe);
            const value = getComputedStyle(probe).color;
            probe.remove();
            return value;
          };
          return {
            destructiveLabel: resolve("--destructive-label"),
            primaryLabel: resolve("--primary-label"),
          };
        });
        const box = await (await page.$(selector)).boundingBox();
        expect(box, "destructive sample did not have a visible bounding box");
        const hitTest = await page.evaluate(
          (targetSelector, point) => {
            const target = document.querySelector(targetSelector);
            return document
              .elementsFromPoint(point.x, point.y)
              .some((node) => target?.contains(node) || node.contains(target));
          },
          selector,
          { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        );
        expect(hitTest, "destructive sample centre is covered by another layer before mouse down");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        const hovered = await snapshot(page, selector);
        await page.mouse.down();
        const pressed = await snapshot(page, selector);
        await page.mouse.up();
        expect(pressed.active, "mouse down did not put the destructive sample in :active state");
        expect(
          before.colour === tokens.destructiveLabel &&
            hovered.colour === tokens.destructiveLabel &&
            pressed.colour === tokens.destructiveLabel,
          `destructive label colour changed: ${JSON.stringify({ before, hovered, pressed, tokens })}`
        );
        expect(
          tokens.destructiveLabel !== tokens.primaryLabel,
          "destructive label token matches the primary label token"
        );
        expect(
          sameRect(before.rect, hovered.rect) && sameRect(before.rect, pressed.rect),
          "hover or pressed state changed the destructive sample rectangle"
        );
        expect(
          before.text === hovered.text && before.text === pressed.text,
          "hover or pressed state changed the destructive sample label"
        );
        return { before, hovered, pressed, tokens, hitTest };
      }
    );

    await check(`${theme}: Tab focus shows a 3:1 ring`, async () => {
      const selector = '[data-preview-id="button-default"]';
      await page.evaluate(() => {
        document.body.tabIndex = 0;
        document.body.focus();
      });
      await page.keyboard.press("Tab");
      const focused = await page.$eval(selector, (node) => node.matches(":focus-visible"));
      expect(focused, "Tab navigation did not put the default button in :focus-visible state");
      const ring = await contrastInfo(page, selector, "ring");
      expect(ring.ratio >= 3, `focus ring contrast was ${ring.ratio.toFixed(2)}:1`);
      return { ring };
    });

    await check(`${theme}: invalid fields maintain 3:1 boundary and ring`, async () => {
      const records = [];
      for (const selector of [
        '[data-preview-id="input-invalid"]',
        '[data-preview-id="textarea-invalid"]',
      ]) {
        const boundary = await contrastInfo(page, selector, "borderColor");
        await page.focus(selector);
        const ring = await contrastInfo(page, selector, "ring");
        expect(
          boundary.ratio >= 3,
          `${selector} boundary contrast was ${boundary.ratio.toFixed(2)}:1`
        );
        expect(ring.ratio >= 3, `${selector} ring contrast was ${ring.ratio.toFixed(2)}:1`);
        records.push({ selector, boundary, ring });
      }
      return records;
    });

    await check(`${theme}: keyboard select and checkbox contracts`, async () => {
      const select = '[aria-label="Synthetic select"]';
      await page.focus(select);
      await page.keyboard.press("Enter");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      const selectState = await page.$eval('[data-preview-id="select-state"]', (node) =>
        node.textContent?.trim()
      );
      expect(
        selectState === "Last value: beta; changes: 1",
        `unexpected select state: ${selectState}`
      );
      await page.focus('[data-preview-id="checkbox"]');
      await page.keyboard.press("Space");
      const checked = await page.$eval('[data-preview-id="checkbox"]', (node) =>
        node.getAttribute("data-state")
      );
      expect(checked === "checked", `checkbox data-state was ${checked}`);
      return { selectState, checked };
    });

    await check(`${theme}: disabled native controls cannot activate`, async () => {
      const disabled = await page.$$eval("[disabled]", (nodes) =>
        nodes
          .filter((node) => node.closest("[data-preview-controls]"))
          .map((node) => ({
            tag: node.tagName,
            disabled: node.matches(":disabled"),
            before: node.getAttribute("data-state"),
          }))
      );
      for (const selector of [
        '[data-preview-id="button-disabled-invalid"]',
        '[data-preview-id="input-disabled"]',
        '[data-preview-id="textarea-disabled"]',
      ]) {
        await page.click(selector).catch(() => undefined);
      }
      const after = await page.$$eval("[disabled]", (nodes) =>
        nodes
          .filter((node) => node.closest("[data-preview-controls]"))
          .map((node) => node.getAttribute("data-state"))
      );
      expect(
        disabled.length === 3 && disabled.every((item) => item.disabled),
        `disabled controls were ${JSON.stringify(disabled)}`
      );
      expect(
        after.every((value, index) => value === disabled[index].before),
        "a disabled control changed state after a click"
      );
      return { disabled, after };
    });

    await check(
      `${theme}: tooltip stays visible inside the edge gap on hover and focus`,
      async () => {
        await page.$eval('[data-preview-id="tooltip-trigger"]', (node) => {
          const wrapper = node.parentElement;
          wrapper.style.position = "fixed";
          wrapper.style.left = "0";
          wrapper.style.top = "90px";
        });
        const selector = '[data-preview-id="tooltip-trigger"]';
        await page.mouse.move(1200, 800);
        await page.hover(selector);
        await new Promise((resolve) => setTimeout(resolve, 200));
        const hover = await page.$eval('[role="tooltip"]', (node) => {
          const rect = node.getBoundingClientRect();
          return {
            opacity: getComputedStyle(node).opacity,
            left: rect.left,
            right: rect.right,
            viewport: innerWidth,
          };
        });
        await page.focus(selector);
        await new Promise((resolve) => setTimeout(resolve, 200));
        const focus = await page.$eval('[role="tooltip"]', (node) => ({
          opacity: getComputedStyle(node).opacity,
        }));
        expect(
          Number(hover.opacity) > 0 && Number(focus.opacity) > 0,
          `tooltip opacity was hover=${hover.opacity}, focus=${focus.opacity}`
        );
        // CSS transforms position the bubble on fractional pixels. Keep the 8px design gap,
        // allowing only the measured quarter-pixel rounding from its centred translation.
        const edgeGap = 8;
        const measurementTolerance = 0.25;
        expect(
          hover.left >= edgeGap - measurementTolerance &&
            hover.right <= hover.viewport - edgeGap + measurementTolerance,
          `tooltip escaped edge gap: ${JSON.stringify(hover)}`
        );
        return { hover, focus, edgeGap, measurementTolerance };
      }
    );

    await check(`${theme}: settings raw neutral action keeps its colour on hover`, async () => {
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll("button")].some(
            (node) =>
              !node.closest("[data-preview-controls]") &&
              /clear|delete|remove|reset/i.test(node.textContent ?? "")
          ),
        { timeout: 5000 }
      );
      const details = await page.evaluate(() => {
        const candidate = [...document.querySelectorAll("button")].find(
          (node) =>
            !node.closest("[data-preview-controls]") &&
            /clear|delete|remove|reset/i.test(node.textContent ?? "")
        );
        if (!candidate) return null;
        return {
          candidate: getComputedStyle(candidate).color,
          text: candidate.textContent?.trim(),
        };
      });
      expect(
        details,
        "no real settings destructive raw button was available in the synthetic fixture"
      );
      // Puppeteer needs a concrete element, while the candidate selection stays inside the fixture DOM.
      const handle = await page.evaluateHandle(() =>
        [...document.querySelectorAll("button")].find(
          (node) =>
            !node.closest("[data-preview-controls]") &&
            /clear|delete|remove|reset/i.test(node.textContent ?? "")
        )
      );
      await handle.asElement().hover();
      const hovered = await handle.asElement().evaluate((node) => getComputedStyle(node).color);
      expect(
        details.candidate === hovered,
        `raw action colour changed on hover ${JSON.stringify({ ...details, hovered })}`
      );
      return { ...details, hovered };
    });
  }

  await check("reduced motion removes touched control transitions and animations", async () => {
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await loadTheme(page, "light");
    const reduced = await page.evaluate(() => ({
      matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
      controls: [
        ...document.querySelectorAll(
          "[data-preview-controls] button, [data-preview-controls] input, [data-preview-controls] textarea, [data-preview-controls] [role=combobox]"
        ),
      ].map((node) => {
        const style = getComputedStyle(node);
        return {
          id: node.getAttribute("data-preview-id"),
          transitionDuration: style.transitionDuration,
          animationDuration: style.animationDuration,
        };
      }),
    }));
    const durations = reduced.controls
      .flatMap((control) => [control.transitionDuration, control.animationDuration])
      .flatMap((value) => value.split(","))
      .map((value) => Number.parseFloat(value) || 0);
    expect(reduced.matches, "reduced-motion media query did not match");
    expect(
      durations.every((duration) => duration <= 0.01),
      `touched transition or animation duration remained above 0.01ms: ${JSON.stringify(reduced.controls)}`
    );
    return reduced;
  });
} finally {
  await browser?.close();
  const report = {
    method:
      "fresh isolated headless Chrome via Puppeteer, real pointer and keyboard input, fixture-origin request allowlist",
    baseUrl,
    generatedAt: new Date().toISOString(),
    counts: {
      total: results.length,
      passed: results.filter((result) => result.status === "pass").length,
      failed: failures.length,
    },
    results,
    failures,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}

if (failures.length) process.exitCode = 1;
