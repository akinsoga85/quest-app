import { describe, expect, it } from "vitest";
import { dayChip, levelView, makesCount, skillBars } from "./logic";

describe("Studio and Levels", () => {
  it("labels makes by day", () => {
    expect(dayChip("2026-10-22", "2026-10-23")).toBe("Oct 22");
    expect(dayChip("2026-10-23", "2026-10-23")).toBe("Today");
    expect(makesCount(47)).toBe("47 makes · only you and your family see these");
    expect(makesCount(1)).toMatch(/^1 make ·/);
  });

  it("shows progress like the Figma Levels card", () => {
    const v = levelView(41);
    expect(v).toMatchObject({ level: 3, name: "Maker", progressPct: 80, progressText: "80% of the way to Level 4", nextText: "Level 4 earns a postcard." });
    expect(v.dots.map((d) => [d.name, d.reached, d.current])).toEqual([
      ["Spark", true, false],
      ["Explorer", true, false],
      ["Maker", true, true],
      ["Crafter", false, false],
      ["Master", false, false],
    ]);
    expect(levelView(200)).toMatchObject({ level: 5, nextText: null, progressText: "Top level. Keep making." });
  });

  it("lists the four skills, with no score until the coach has scored one", () => {
    const bars = skillBars({ zone: "photography", points: 0, skills: { "photography.light": 7 }, compare: null });
    expect(bars.map((b) => [b.name, b.score])).toEqual([
      ["Light", 7],
      ["Colour", null],
      ["Framing", null],
      ["Story", null],
    ]);
  });
});
