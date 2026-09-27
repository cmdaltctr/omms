import { expect, it } from "bun:test";
import { pathForView, resolveAppPath, ROUTES, viewFromPath } from "../web/src/lib/routes.js";

it("loads the settings view directly and marks it as a route", () => {
  expect(ROUTES.settings).toBe("/settings");
  expect(resolveAppPath("/settings")).toBe("/settings");
  expect(viewFromPath("/settings")).toBe("settings");
  expect(pathForView("settings")).toBe("/settings");
});
