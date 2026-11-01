import { describe, expect, it } from "vitest";
import { colors, contrastRatio, MIN_FONT_SIZE, minTouch, type, zoneColors } from "./index";

describe("contrast (WCAG AA)", () => {
  const surfaces = { bg: colors.bg, surface: colors.surface, surface2: colors.surface2 };

  for (const [surfaceName, surface] of Object.entries(surfaces)) {
    for (const textName of ["text", "text2", "muted"] as const) {
      it(`${textName} on ${surfaceName} is at least 4.5:1`, () => {
        expect(contrastRatio(colors[textName], surface)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("button text on lime is at least 4.5:1", () => {
    expect(contrastRatio(colors.limeInk, colors.lime)).toBeGreaterThanOrEqual(4.5);
  });

  it("lime and zone colours used as text on bg are at least 4.5:1", () => {
    for (const c of [colors.lime, colors.danger, ...Object.values(zoneColors)]) {
      expect(contrastRatio(c, colors.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("type and touch", () => {
  it("no type token is below the minimum size", () => {
    for (const t of Object.values(type)) expect(t.size).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
  });

  it("tap targets meet each platform's minimum", () => {
    expect(minTouch("ios")).toBe(44);
    expect(minTouch("android")).toBe(48);
  });
});
