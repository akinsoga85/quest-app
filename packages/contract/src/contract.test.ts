import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  Api,
  ageFromBirthMonth,
  bracketFromAgeRange,
  parentInviteUrl,
  CoachReview,
  bracketForAge,
  coachReviewJsonSchema,
  isSkillOfZone,
  levelFor,
  levelledUp,
  modeFor,
  needsParentConsent,
  questRuleProblems,
  reviewGuardrailIssues,
  skillIdsFor,
  CoachClaim,
  SAFETY_THRESHOLDS,
  skillScore,
  decideScan,
  LESSONS,
  Lesson,
  lessonById,
  lessonsForSkill,
  lessonsForZone,
  MAKING_DAYS_PER_WEEK,
  MAKE_UPLOAD_WINDOW_HOURS,
  PHOTO,
  cropTo45,
  hasPrivateMetadata,
  jpegMetadata,
  makePath,
  resizeFor,
  stripJpegMetadata,
  ZONES,
  addDays,
  localDay,
  skillName,
  weekDays,
  weekStart,
  weeklyStreak,
  type QuestDraft,
  type QuestWeekDraft,
  weekRuleProblems,
} from "./index";

describe("age and mode", () => {
  it("brackets ages and stops under-13s", () => {
    expect(bracketForAge(12)).toBe("under_13");
    expect(bracketForAge(13)).toBe("13_15");
    expect(bracketForAge(16)).toBe("16_17");
    expect(bracketForAge(19)).toBe("18_19");
    expect(bracketForAge(20)).toBe("over_19");
  });

  it("Lean V1 puts everyone in Studio", () => {
    expect(modeFor({ country: "US", bracket: "16_17", wallsLive: false })).toBe("studio");
  });

  it("with walls live, Canadian 13–15s stay in Studio (R44)", () => {
    expect(modeFor({ country: "ca", bracket: "13_15", wallsLive: true })).toBe("studio");
    expect(modeFor({ country: "CA", bracket: "16_17", wallsLive: true })).toBe("walls");
    expect(modeFor({ country: "US", bracket: "13_15", wallsLive: true })).toBe("walls");
  });

  it("under-18s need parent consent", () => {
    expect(needsParentConsent("13_15")).toBe(true);
    expect(needsParentConsent("16_17")).toBe(true);
    expect(needsParentConsent("18_19")).toBe(false);
  });
});

describe("zones", () => {
  it("every zone has four skills", () => {
    for (const z of ["photography", "fashion", "art_crafts", "music", "words"] as const) {
      expect(skillIdsFor(z)).toHaveLength(4);
    }
    expect(isSkillOfZone("photography.light", "photography")).toBe(true);
    expect(isSkillOfZone("photography.light", "fashion")).toBe(false);
  });
});

describe("quest rules", () => {
  const ok: QuestDraft = {
    zone: "photography",
    title: "Shadows that tell a story",
    brief: "Find hard light (a window, a lamp, a streetlight) and photograph the shadow, not the thing.",
    minutes: 15,
    trainsSkill: "photography.light",
    tips: ["Side light makes longer shadows", "Get low and tilt up"],
  };

  it("passes a good quest", () => {
    expect(questRuleProblems(ok)).toEqual([]);
  });

  it("rejects quests that ask for faces or schools", () => {
    expect(questRuleProblems({ ...ok, brief: "Take a selfie in hard light from the window next to you." })).not.toEqual([]);
    expect(questRuleProblems({ ...ok, tips: ["Show your school sign"] })).not.toEqual([]);
  });

  it("requires fashion quests to be flat-lay", () => {
    const fashion: QuestDraft = { ...ok, zone: "fashion", trainsSkill: "fashion.colour", title: "Three pieces, one colour", brief: "Pick three pieces in one colour and arrange them so they work together." };
    expect(questRuleProblems(fashion)).toContain("fashion quests must be flat-lay (no one wears the outfit)");
    expect(questRuleProblems({ ...fashion, brief: fashion.brief + " Shoot it as a flat-lay." })).toEqual([]);
  });

  it("rejects a skill from another zone", () => {
    expect(questRuleProblems({ ...ok, trainsSkill: "fashion.colour" })).toHaveLength(1);
  });
});

describe("coach review", () => {
  const good: CoachReview = {
    worked:
      "The blind throws clean diagonal stripes across the wall, and keeping the window itself out of the frame makes the shadow the subject.",
    tryNext: "Next time, get lower and tilt up so the stripes run in from a corner of the frame.",
    why: "Diagonals that start at an edge pull the eye through the picture.",
    question: "What would change if something moved through the light?",
    skillPoints: [{ skill: "photography.light", points: 1 }],
    lessonId: "photo.leading-lines",
    confidence: 0.86,
  };

  it("accepts the house-voice example", () => {
    expect(CoachReview.parse(good)).toEqual(good);
    expect(reviewGuardrailIssues(good)).toEqual([]);
  });

  it("flags appearance, comparison and generic praise", () => {
    const bad = { ...good, worked: good.worked + " You look great and this is better than other teens. Great job" };
    const rules = reviewGuardrailIssues(bad).map((i) => i.rule);
    expect(rules).toEqual(expect.arrayContaining(["appearance", "comparison", "generic_praise"]));
  });

  it("flags reviews that are too short", () => {
    const short = { ...good, worked: "Nice clean stripes on the wall.", tryNext: "Get lower next time, tilt up.", why: "Pulls the eye.", question: null };
    expect(reviewGuardrailIssues(short).map((i) => i.rule)).toContain("length");
  });

  it("exports a JSON schema for structured output", () => {
    expect(coachReviewJsonSchema).toMatchObject({ type: "object" });
  });
});

describe("levels", () => {
  it("maps points to levels", () => {
    expect(levelFor(0)).toMatchObject({ level: 1, name: "Spark", nextAt: 10 });
    expect(levelFor(25)).toMatchObject({ level: 3, name: "Maker" });
    expect(levelFor(41).progress).toBeCloseTo(0.8);
    expect(levelFor(999)).toMatchObject({ level: 5, nextAt: null, progress: 1 });
  });

  it("detects a level-up", () => {
    expect(levelledUp(44, 45)).toBe(true);
    expect(levelledUp(45, 46)).toBe(false);
  });
});

describe("api", () => {
  it("every function names an owning package", () => {
    for (const def of Object.values(Api)) expect(def.owner).toMatch(/^A\d+$/);
  });

  it("validates a review response", () => {
    const out = Api["review.forMake"].output.parse({ state: "pending" });
    expect(out.state).toBe("pending");
  });
});

describe("A1 done-when: ages 12, 14, 16, 18 and 19 in Canada and the US", () => {
  const cases = [
    { age: 12, bracket: "under_13" },
    { age: 14, bracket: "13_15" },
    { age: 16, bracket: "16_17" },
    { age: 18, bracket: "18_19" },
    { age: 19, bracket: "18_19" },
  ] as const;

  for (const country of ["CA", "US"]) {
    for (const { age, bracket } of cases) {
      it(`${country}, age ${age}`, () => {
        expect(bracketForAge(age)).toBe(bracket);
        if (bracket === "under_13") return; // stopped: no account, nothing kept
        expect(needsParentConsent(bracket)).toBe(age < 18);
        // Lean V1: everyone in Studio.
        expect(modeFor({ country, bracket, wallsLive: false })).toBe("studio");
        // With walls: only Canadian 13–15s stay in Studio.
        expect(modeFor({ country, bracket, wallsLive: true })).toBe(country === "CA" && age < 16 ? "studio" : "walls");
      });
    }
  }
});

describe("birth month and year", () => {
  const today = new Date(Date.UTC(2026, 10, 1)); // 1 Nov 2026

  it("counts a birthday later this year or this month as not yet reached", () => {
    expect(ageFromBirthMonth(2013, 12, today)).toBe(12);
    expect(ageFromBirthMonth(2013, 11, today)).toBe(12); // same month: day unknown, take the younger age
    expect(ageFromBirthMonth(2013, 10, today)).toBe(13);
    expect(ageFromBirthMonth(2007, 1, today)).toBe(19);
    expect(ageFromBirthMonth(2006, 10, today)).toBe(20);
  });

  it("stops a child who turns 13 later this month", () => {
    expect(bracketForAge(ageFromBirthMonth(2013, 11, today))).toBe("under_13");
  });
});

describe("store age ranges (thresholds 13, 16, 18)", () => {
  it("maps the ranges each store reports", () => {
    expect(bracketFromAgeRange(null, 12)).toBe("under_13");
    expect(bracketFromAgeRange(0, 12)).toBe("under_13");
    expect(bracketFromAgeRange(13, 15)).toBe("13_15");
    expect(bracketFromAgeRange(16, 17)).toBe("16_17");
    expect(bracketFromAgeRange(18, null)).toBe("adult_unbounded");
    expect(bracketFromAgeRange(18, 19)).toBe("18_19");
  });

  it("takes the youngest bracket when a range spans two", () => {
    expect(bracketFromAgeRange(13, 17)).toBe("13_15");
    expect(bracketFromAgeRange(10, 14)).toBe("under_13");
  });

  it("treats an empty answer as unknown, so the app asks instead", () => {
    expect(bracketFromAgeRange(null, null)).toBe("unknown");
    expect(bracketFromAgeRange(null, 15)).toBe("unknown");
  });
});

describe("parent invite", () => {
  it("links to the consent page with the token", () => {
    const token = "a".repeat(64);
    expect(parentInviteUrl("https://parents.example.com", token)).toBe(`https://parents.example.com/consent?t=${token}`);
  });

  it("names a Postgres function for every A1 entry", () => {
    for (const def of Object.values(Api)) if (def.owner === "A1") expect("rpc" in def && def.rpc).toMatch(/^[a-z_]+$/);
  });
});

describe("A2: local days, weeks and the gentle streak", () => {
  it("finds the local day across midnight, daylight saving and half-hour zones", () => {
    expect(localDay(new Date("2025-11-02T06:59:59Z"), "America/Los_Angeles")).toBe("2025-11-01");
    expect(localDay(new Date("2025-11-02T07:00:00Z"), "America/Los_Angeles")).toBe("2025-11-02");
    // Clocks went back at 2am that morning, so the next midnight is an hour later in UTC.
    expect(localDay(new Date("2025-11-03T07:59:59Z"), "America/Los_Angeles")).toBe("2025-11-02");
    expect(localDay(new Date("2025-11-03T08:00:00Z"), "America/Los_Angeles")).toBe("2025-11-03");
    expect(localDay(new Date("2025-11-02T18:29:59Z"), "Asia/Kolkata")).toBe("2025-11-02");
    expect(localDay(new Date("2025-11-02T18:30:00Z"), "Asia/Kolkata")).toBe("2025-11-03");
    expect(localDay(new Date("2025-11-02T11:00:00Z"), "Pacific/Kiritimati")).toBe("2025-11-03");
    expect(localDay(new Date("2025-11-02T11:00:00Z"), "Pacific/Pago_Pago")).toBe("2025-11-02");
  });

  it("adds days and starts weeks on Monday", () => {
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(weekStart("2025-11-03")).toBe("2025-11-03"); // Monday
    expect(weekStart("2025-11-09")).toBe("2025-11-03"); // Sunday
    expect(weekStart("2026-01-01")).toBe("2025-12-29"); // across a year
    expect(weekDays("2025-11-05")).toEqual(["2025-11-03", "2025-11-04", "2025-11-05", "2025-11-06", "2025-11-07", "2025-11-08", "2025-11-09"]);
    expect(() => addDays("Nov 3", 1)).toThrow();
  });

  it("counts weeks with 3 or more making days", () => {
    const wk1 = ["2025-10-06", "2025-10-08", "2025-10-12"];
    const wk2 = ["2025-10-13", "2025-10-14", "2025-10-14", "2025-10-16"];
    expect(MAKING_DAYS_PER_WEEK).toBe(3);
    expect(weeklyStreak([], "2025-10-20")).toBe(0);
    expect(weeklyStreak(wk1, "2025-10-12")).toBe(1);
    expect(weeklyStreak([...wk1, ...wk2], "2025-10-19")).toBe(2);
    // An unfinished week never breaks it; a finished one with 2 days does.
    expect(weeklyStreak([...wk1, ...wk2], "2025-10-26")).toBe(2);
    expect(weeklyStreak([...wk1, ...wk2, "2025-10-21", "2025-10-23"], "2025-10-27")).toBe(0);
    // Two makes on one day count once.
    expect(weeklyStreak(["2025-10-13", "2025-10-13", "2025-10-14"], "2025-10-19")).toBe(0);
    // Days after today are ignored.
    expect(weeklyStreak([...wk1, "2025-10-13", "2025-10-14", "2025-10-15"], "2025-10-14")).toBe(1);
  });

  it("validates the Today payload", () => {
    const today = {
      day: "2025-11-05",
      timezone: "Pacific/Auckland",
      zones: [
        {
          zone: "photography",
          points: 12,
          madeToday: false,
          make: null,
          quest: {
            id: "8c6f1f5e-7f1d-4c2a-9a39-1c1b2f0b6a11",
            zone: "photography",
            title: "Shadows that tell a story",
            brief: "Find hard light and photograph the shadow, not the thing.",
            minutes: 15,
            trainsSkill: "photography.light",
            tips: ["Side light makes longer shadows"],
          },
        },
        { zone: "fashion", points: 0, madeToday: false, quest: null, make: null },
      ],
      week: { start: "2025-11-03", madeDays: ["2025-11-03"] },
      streakWeeks: 6,
    };
    expect(Api["today.get"].output.parse(today)).toEqual(today);
    expect(() => Api["today.get"].output.parse({ ...today, zones: [...today.zones, ...today.zones] })).toThrow();
    expect(Api["zones.set"].input.safeParse({ zones: [] }).success).toBe(false);
    expect(Api["zones.set"].input.safeParse({ zones: ["photography", "fashion", "art_crafts", "music"] }).success).toBe(false);
    expect(Api["zones.set"].input.safeParse({ zones: ["photography"] }).success).toBe(true);
  });

  it("names skills and describes zones for the picker", () => {
    expect(skillName("photography.light")).toBe("Light");
    expect(skillName("words.word_choice")).toBe("Word choice");
    for (const z of Object.values(ZONES)) expect(z.blurb.length).toBeGreaterThan(5);
  });
});

describe("A3: photos", () => {
  const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
  // A segment: FF, marker, 2-byte length, payload.
  const seg = (marker: number, payload: string) => {
    const body = new TextEncoder().encode(payload);
    return new Uint8Array([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]);
  };
  const insertAfterSoi = (jpeg: Uint8Array, ...segs: Uint8Array[]) => new Uint8Array([0xff, 0xd8, ...segs.flatMap((s) => [...s]), ...jpeg.subarray(2)]);

  it("crops to a centred 4:5 and never upscales", () => {
    expect(cropTo45(4032, 3024)).toEqual({ originX: 806, originY: 0, width: 2419, height: 3024 }); // landscape
    expect(cropTo45(3024, 4032)).toEqual({ originX: 0, originY: 126, width: 3024, height: 3780 }); // 3:4 portrait
    expect(cropTo45(1080, 1350)).toEqual({ originX: 0, originY: 0, width: 1080, height: 1350 }); // already 4:5
    expect(cropTo45(1000, 2000)).toEqual({ originX: 0, originY: 375, width: 1000, height: 1250 });
    expect(resizeFor({ width: 3024, height: 3780 })).toEqual({ width: 1280, height: PHOTO.longEdge });
    expect(resizeFor({ width: 800, height: 1000 })).toEqual({ width: 800, height: 1000 });
    expect(() => cropTo45(0, 10)).toThrow();
  });

  it("A3 done when: no upload keeps location data (camera-style EXIF, XMP and comments)", () => {
    for (const name of ["gps.jpg", "gps-progressive.jpg"]) {
      const original = fixture(name);
      expect(jpegMetadata(original)).toMatchObject({ exif: true, gps: true });
      const clean = stripJpegMetadata(original);
      expect(jpegMetadata(clean)).toEqual({ exif: false, gps: false, xmp: false, iptc: false, comment: false, trailing: false });
      expect(hasPrivateMetadata(jpegMetadata(clean))).toBe(false);
      expect([...clean.subarray(0, 2)]).toEqual([0xff, 0xd8]);
      expect([...clean.subarray(-2)]).toEqual([0xff, 0xd9]);
      expect(stripJpegMetadata(clean)).toEqual(clean); // nothing left to remove
      expect(new TextDecoder("latin1").decode(clean)).not.toMatch(/PhoneMaker|PhoneModel|Example St|GPS/);
    }
    expect(jpegMetadata(fixture("gps.jpg"))).toMatchObject({ xmp: true, comment: true });
  });

  it("keeps the colour profile, drops other app data and anything after the picture", () => {
    const base = stripJpegMetadata(fixture("gps.jpg"));
    const withExtras = new Uint8Array([
      ...insertAfterSoi(base, seg(0xe2, "ICC_PROFILE\0\x01\x01profile"), seg(0xe2, "MPF\0secondary"), seg(0xed, "Photoshop 3.0\0iptc"), seg(0xe9, "vendor")),
      ...[0x00, 0x11, 0x22, 0xff, 0xd8, 0xff, 0xd9], // a second picture tacked on the end
    ]);
    const r = jpegMetadata(withExtras);
    expect(r).toMatchObject({ iptc: true, trailing: true });
    const clean = stripJpegMetadata(withExtras);
    expect(jpegMetadata(clean)).toMatchObject({ iptc: false, trailing: false });
    const text = new TextDecoder("latin1").decode(clean);
    expect(text).toContain("ICC_PROFILE");
    expect(text).not.toMatch(/MPF|Photoshop|vendor/);
    expect(clean.length).toBe(base.length + seg(0xe2, "ICC_PROFILE\0\x01\x01profile").length);
  });

  it("refuses anything that isn't a whole JPEG", () => {
    const good = fixture("gps.jpg");
    expect(() => stripJpegMetadata(new TextEncoder().encode("not a photo"))).toThrow(/not a JPEG/);
    expect(() => stripJpegMetadata(good.subarray(0, 300))).toThrow();
    expect(() => stripJpegMetadata(good.subarray(0, good.length - 2))).toThrow(/end-of-image/);
  });

  it("puts each photo in the teen's own folder, and records it through make.record", () => {
    expect(makePath("t-1", "m-2")).toBe("t-1/m-2.jpg");
    expect(MAKE_UPLOAD_WINDOW_HOURS).toBe(48);
    const ok = { makeId: "8c6f1f5e-7f1d-4c2a-9a39-1c1b2f0b6a11", questId: "8c6f1f5e-7f1d-4c2a-9a39-1c1b2f0b6a12", capturedAt: "2026-11-01T08:00:00-07:00" };
    expect(Api["make.record"].input.safeParse(ok).success).toBe(true);
    expect(Api["make.record"].input.safeParse({ ...ok, capturedAt: "yesterday" }).success).toBe(false);
  });
});

describe("A4: coach reviews and lessons", () => {
  it("has one starter lesson for every skill in the live zones", () => {
    for (const [zone, z] of Object.entries(ZONES)) {
      if (z.status !== "live") continue;
      for (const skill of skillIdsFor(zone as keyof typeof ZONES)) {
        const lessons = lessonsForSkill(skill);
        expect(lessons, skill).toHaveLength(1);
        expect(lessons[0]!.id.startsWith(`${skill}.`)).toBe(true);
        expect(lessons[0]!.zone).toBe(zone);
      }
    }
    for (const l of LESSONS) expect(Lesson.parse(l)).toEqual(l);
    expect(lessonById("photography.framing.leading-lines")?.title).toBe("Leading lines");
    expect(lessonById("nope")).toBeNull();
    expect(lessonsForZone("fashion")).toHaveLength(4);
  });

  it("describes every state of a make's review", () => {
    const parse = (v: unknown) => Api["review.forMake"].output.parse(v);
    expect(parse({ state: "no_consent" }).state).toBe("no_consent");
    expect(parse({ state: "retake", reason: "Too blurry to see the shadows." }).state).toBe("retake");
    expect(parse({ state: "unavailable", lessonId: null }).state).toBe("unavailable");
    expect(parse({ state: "held" }).state).toBe("held");
    const ready = parse({
      state: "ready",
      reviewId: "8c6f1f5e-7f1d-4c2a-9a39-1c1b2f0b6a11",
      helpful: null,
      review: {
        worked: "The blind throws clean diagonal stripes across the wall.",
        tryNext: "Get lower and tilt up so the stripes run in from a corner.",
        why: "Diagonals pull the eye through.",
        question: null,
        skillPoints: [{ skill: "photography.light", points: 1 }],
        lessonId: "photography.framing.leading-lines",
        confidence: 0.8,
      },
    });
    expect(ready.state).toBe("ready");
    expect(() => parse({ state: "ready" })).toThrow();
  });

  it("gives the coach nothing without consent", () => {
    expect(CoachClaim.parse({ consent: false })).toEqual({ consent: false });
    expect(CoachClaim.parse(null)).toBeNull();
    expect(() => CoachClaim.parse({ consent: false, context: {} })).not.toThrow(); // extra keys are dropped…
    expect(CoachClaim.parse({ consent: false, context: {} })).toEqual({ consent: false }); // …so no context leaks through
  });
});

describe("A5: the safety decision", () => {
  it("blocks any hash match, whatever the classifier says", () => {
    expect(decideScan({ hashMatches: ["test-1"], labels: {} })).toEqual({ result: "block", reasons: ["hash_match:test-1"] });
    expect(decideScan({ hashMatches: ["a", "b"], labels: { sexual: 0 } }).result).toBe("block");
  });

  it("blocks clearly sexual content and holds borderline photos for a person", () => {
    expect(decideScan({ hashMatches: [], labels: { sexual: 0.85 } }).result).toBe("block");
    expect(decideScan({ hashMatches: [], labels: { nudity: 0.35 } })).toEqual({ result: "human_review", reasons: ["nudity:0.35"] });
    expect(decideScan({ hashMatches: [], labels: { nudity: 0.1, violence: 0.2 } })).toEqual({ result: "pass", reasons: [] });
  });

  it("always sends self-harm signs to a person, never just blocks them", () => {
    expect(decideScan({ hashMatches: [], labels: { self_harm: 0.99 } }).result).toBe("human_review");
    expect(SAFETY_THRESHOLDS.self_harm.block).toBeNull();
  });

  it("keeps the strongest result and every reason", () => {
    expect(decideScan({ hashMatches: [], labels: { weapon: 0.6, sexual: 0.9 } })).toEqual({ result: "block", reasons: ["sexual:0.90", "weapon:0.60"] });
  });

  it("isn't something the app can call", () => {
    expect(Object.keys(Api)).not.toContain("make.submit");
  });
});

describe("A6: quest week rules", () => {
  const skills = ["photography.light", "photography.colour", "photography.framing", "photography.story"];
  const good: QuestWeekDraft = {
    zone: "photography",
    weekOf: "2026-11-09", // a Monday
    quests: skills.concat(skills.slice(0, 3)).map((trainsSkill, i) => ({
      zone: "photography" as const,
      title: `Window light ${i + 1}`,
      brief: "Find one thing at home and photograph it in window light from a low angle.",
      minutes: 10,
      trainsSkill,
      tips: [],
    })),
  };

  it("passes a good week", () => {
    expect(weekRuleProblems(good)).toEqual([]);
  });

  it("needs every skill trained, no repeats, and a Monday start", () => {
    const allLight = { ...good, quests: good.quests.map((q) => ({ ...q, trainsSkill: "photography.light" })) };
    expect(weekRuleProblems(allLight).join("|")).toMatch(/no quest this week trains photography.colour/);
    const twice = { ...good, quests: good.quests.map((q, i) => (i === 1 ? { ...q, title: good.quests[0]!.title } : q)) };
    expect(weekRuleProblems(twice).join("|")).toMatch(/appears twice/);
    expect(weekRuleProblems(good, ["window light 3"]).join("|")).toMatch(/ran in a recent week/);
    expect(weekRuleProblems({ ...good, weekOf: "2026-11-10" }).join("|")).toMatch(/Monday/);
    expect(weekRuleProblems({ ...good, quests: good.quests.slice(0, 6) }).length).toBeGreaterThan(0);
  });

  it("refuses quests that send teens somewhere or to something unsafe", () => {
    const risky = (brief: string) => questRuleProblems({ ...good.quests[0]!, brief });
    expect(risky("Climb onto the roof and shoot the sunset over the street below.").join("|")).toMatch(/unsafe/);
    expect(risky("Light a candle in a dark room and photograph the flame up close.").join("|")).toMatch(/unsafe/);
    expect(risky("Ask a stranger at the bus stop if you can photograph their bag.").join("|")).toMatch(/unsafe/);
    expect(risky("Photograph a shadow on your bedroom wall in the morning light.")).toEqual([]);
  });
});

describe("A7: points, skill scores and postcards", () => {
  it("scores a skill 1–10 from its last 10 coach scores", () => {
    expect(skillScore([])).toBeNull();
    expect(skillScore([2])).toBe(10);
    expect(skillScore([0, 0])).toBe(1);
    expect(skillScore([1])).toBe(6);
    expect(skillScore([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0])).toBe(10); // only the newest 10 count
  });

  it("validates what the Levels and Studio screens read", () => {
    const zone = Api["levels.get"].output.parse([
      { zone: "photography", points: 30, skills: { "photography.light": 7, "photography.story": null }, compare: null },
    ]);
    expect(levelFor(zone[0]!.points).name).toBe("Maker");
    expect(() => Api["levels.get"].output.parse([{ zone: "photography", points: 3, skills: { x: 11 }, compare: null }])).toThrow();
    expect(Api["postcards.new"].output.parse([{ id: "8c6f1f5e-7f1d-4c2a-9a39-1c1b2f0b6a11", zone: "photography", level: 2, makeId: null }])).toHaveLength(1);
    expect(() => Api["postcards.new"].output.parse([{ id: "8c6f1f5e-7f1d-4c2a-9a39-1c1b2f0b6a11", zone: "photography", level: 1, makeId: null }])).toThrow();
  });
});
