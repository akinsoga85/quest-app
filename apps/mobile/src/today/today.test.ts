import type { Today, TodayZone } from "@quest/contract";
import { describe, expect, it } from "vitest";
import {
  cleanTimeZone,
  dayHeading,
  findQuest,
  firstOpenQuest,
  questMeta,
  splitZones,
  streakLabel,
  weekAccessibilityLabel,
  weekCaption,
  weekRow,
  zoneLine,
} from "./logic";

const quest = (zone: "photography" | "fashion" | "art_crafts", id: string) => ({
  id,
  zone,
  title: `A ${zone} quest`,
  brief: "A brief long enough to pass the contract's checks.",
  minutes: 15,
  trainsSkill: zone === "photography" ? "photography.light" : zone === "fashion" ? "fashion.colour" : "art_crafts.line",
  tips: [],
});

const zones: TodayZone[] = [
  { zone: "photography", points: 30, madeToday: true, quest: quest("photography", "00000000-0000-4000-8000-000000000001"), make: { id: "00000000-0000-4000-8000-0000000000a1", status: "reviewed" } },
  { zone: "fashion", points: 12, madeToday: false, quest: quest("fashion", "00000000-0000-4000-8000-000000000002"), make: null },
  { zone: "art_crafts", points: 0, madeToday: false, quest: null, make: null },
];

const today: Today = {
  day: "2026-10-23",
  timezone: "Europe/London",
  zones,
  week: { start: "2026-10-19", madeDays: ["2026-10-20", "2026-10-22"] },
  streakWeeks: 6,
};

describe("Today screen", () => {
  it("heads the screen with the local day", () => {
    expect(dayHeading("2026-10-23")).toBe("Friday, Oct 23");
    expect(dayHeading("2027-01-01")).toBe("Friday, Jan 1");
  });

  it("shows the week Monday first, with made days, today and days to come", () => {
    const dots = weekRow(today);
    expect(dots.map((d) => d.letter).join("")).toBe("MTWTFSS");
    expect(dots.filter((d) => d.made).map((d) => d.name)).toEqual(["Tuesday", "Thursday"]);
    expect(dots.find((d) => d.isToday)?.day).toBe("2026-10-23");
    expect(dots.filter((d) => d.isFuture).length).toBe(2);
    expect(weekAccessibilityLabel(dots)).toBe("This week you made something on 2 days: Tuesday, Thursday.");
  });

  it("explains the gentle streak in plain words", () => {
    expect(streakLabel(6)).toBe("6 weeks");
    expect(streakLabel(1)).toBe("1 week");
    expect(streakLabel(0)).toBe("New streak");
    expect(weekCaption(2, 6)).toBe("Make on 1 more day this week to keep your streak going.");
    expect(weekCaption(0, 0)).toBe("Make on 3 more days this week to start a streak.");
    expect(weekCaption(4, 2)).toBe("This week counts towards your streak.");
  });

  it("gives the big card to the first quest still to do", () => {
    const { main, rest } = splitZones(zones);
    expect(main?.zone).toBe("fashion");
    expect(rest.map((z) => z.zone)).toEqual(["photography", "art_crafts"]);
    expect(firstOpenQuest(today)?.zone).toBe("fashion");
    expect(splitZones(zones.map((z) => ({ ...z, madeToday: true }))).main).toBeNull();
    expect(firstOpenQuest(null)).toBeNull();
  });

  it("labels quests and zones like the Figma cards", () => {
    expect(questMeta(zones[0]!.quest!)).toBe("Daily quest · about 15 min · trains Light");
    expect(zoneLine("photography", 30)).toBe("Photography · Level 3");
    expect(zoneLine("fashion", 12)).toBe("Fashion · Level 2 · flat-lay");
    expect(findQuest(today, "00000000-0000-4000-8000-000000000002")?.zone).toBe("fashion");
    expect(findQuest(today, "nope")).toBeNull();
  });

  it("sends the server only real time zone names", () => {
    expect(cleanTimeZone("America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos_Aires");
    expect(cleanTimeZone("UTC")).toBe("UTC");
    expect(cleanTimeZone("GMT+05:30")).toBe("UTC");
    expect(cleanTimeZone("Etc/GMT-3")).toBe("UTC");
    expect(cleanTimeZone(null)).toBe("UTC");
    expect(cleanTimeZone("")).toBe("UTC");
  });
});
