import { expect, it } from "bun:test";
import { tooltipShift } from "../src/lib/components/ui/tooltip.tsx";

// A 200px bubble (half 100) with an 8px gap.
it("leaves a bubble that fits where it is", () => {
  expect(tooltipShift({ centre: 500, half: 100, left: 0, right: 1000, gap: 8 })).toBe(0);
});

it("slides a bubble right when it would pass the left edge of its column", () => {
  // The column starts at 256 (beside the sidebar); the anchor sits 20px inside it.
  expect(tooltipShift({ centre: 276, half: 100, left: 256, right: 1280, gap: 8 })).toBe(88);
});

it("slides a bubble left when it would pass the right edge", () => {
  expect(tooltipShift({ centre: 1250, half: 100, left: 256, right: 1280, gap: 8 })).toBe(-78);
});

it("centres in a column narrower than the bubble instead of throwing it off", () => {
  expect(tooltipShift({ centre: 300, half: 100, left: 256, right: 400, gap: 8 })).toBe(328 - 300);
});
