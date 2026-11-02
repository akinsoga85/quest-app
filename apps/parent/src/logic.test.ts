import { describe, expect, it } from "vitest";
import { CHEERS, bestZone, plusLine, questsLine, route, shortDay } from "./logic";

describe("parent page", () => {
  it("routes the consent link and everything else", () => {
    expect(route("/consent", "?t=abc")).toEqual({ page: "consent", token: "abc" });
    expect(route("/consent/", "?t=abc")).toEqual({ page: "consent", token: "abc" });
    expect(route("/consent", "")).toEqual({ page: "home" });
    expect(route("/", "")).toEqual({ page: "home" });
  });

  it("shows the teen's strongest zone and level", () => {
    const teen = { teenId: "t", handle: "BlueFox-482", coachOn: true, questsThisWeek: 5, zones: [{ zone: "fashion", points: 3 }, { zone: "photography", points: 30 }] };
    expect(bestZone(teen)).toEqual({ level: "Level 3", where: "in Photography" });
    expect(bestZone({ ...teen, zones: [] })).toBeNull();
    expect(questsLine(1)).toBe("quest made");
    expect(questsLine(5)).toBe("quests made");
  });

  it("says where Plus came from and until when", () => {
    expect(plusLine("2026-12-01T00:00:00Z", "web")).toBe("Plus is on until Dec 1, bought here.");
    expect(plusLine("2026-12-01T00:00:00Z", "app_store")).toBe("Plus is on until Dec 1, bought in the App Store.");
  });

  it("writes dates the short way", () => {
    expect(shortDay("2026-10-23")).toBe("Oct 23");
  });

  it("offers the five cheers and nothing else", () => {
    expect(CHEERS.map((c) => c.label)).toEqual(["Great light", "Great framing", "Great moment", "Clever idea", "Love this"]);
  });
});
