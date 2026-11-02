import { describe, expect, it } from "vitest";
import { parseAuthCallback } from "../lib/authCallback";
import { birthYearsFor, closedUntil, isClosed } from "./ageGate";
import { interpretAndroidAccess, interpretRange, iosSupported, recheckBracket, recheckDue } from "./ageSignalLogic";
import { onboardingStep, type OnboardingState } from "./flow";

describe("store age signal", () => {
  it("never trusts iOS before 26, where every answer reads 18+", () => {
    expect(iosSupported("18.6")).toBe(false);
    expect(iosSupported("25.1")).toBe(false);
    expect(iosSupported("26.0")).toBe(true);
    expect(iosSupported(26.2)).toBe(true);
  });

  it("turns store ranges into brackets", () => {
    expect(interpretRange({ lowerBound: 13, upperBound: 15 })).toEqual({ kind: "verdict", verdict: "13_15" });
    expect(interpretRange({ lowerBound: null, upperBound: 12 })).toEqual({ kind: "verdict", verdict: "under_13" });
    expect(interpretRange({ lowerBound: 18, upperBound: null })).toEqual({ kind: "verdict", verdict: "adult_unbounded" });
  });

  it("falls back to asking when the store shares nothing", () => {
    expect(interpretRange({ lowerBound: null, upperBound: null })).toEqual({ kind: "unavailable" });
    expect(interpretRange(null)).toEqual({ kind: "unavailable" });
  });

  it("follows Play Age Signals' sharing status on Android", () => {
    expect(interpretAndroidAccess("SHARED")).toBe("ask_range");
    expect(interpretAndroidAccess("NOT_SHARED")).toEqual({ kind: "unavailable" });
    expect(interpretAndroidAccess("VERIFICATION_REQUIRED")).toEqual({ kind: "verification_required" });
    expect(interpretAndroidAccess(null)).toEqual({ kind: "unavailable" });
  });
});

describe("onboarding flow", () => {
  const base: OnboardingState = { loading: false, signedIn: true, teen: null, parentLinked: false, waitingForParent: false, hasZones: true };

  it("asks for zones last, after the parent step", () => {
    const teen = { ageBracket: "13_15" } as const;
    expect(onboardingStep({ ...base, teen, hasZones: false })).toBe("parent");
    expect(onboardingStep({ ...base, teen, waitingForParent: true, hasZones: false })).toBe("zones");
    expect(onboardingStep({ ...base, teen: { ageBracket: "18_19" }, hasZones: false })).toBe("zones");
    expect(onboardingStep({ ...base, teen: { ageBracket: "18_19" }, hasZones: true })).toBe("done");
  });

  it("goes sign in, age, parent, done", () => {
    expect(onboardingStep({ ...base, loading: true })).toBe("loading");
    expect(onboardingStep({ ...base, signedIn: false })).toBe("welcome");
    expect(onboardingStep(base)).toBe("age");
    expect(onboardingStep({ ...base, teen: { ageBracket: "13_15" } })).toBe("parent");
    expect(onboardingStep({ ...base, teen: { ageBracket: "16_17" }, parentLinked: true })).toBe("done");
  });

  it("lets under-18s start making while they wait for a parent", () => {
    expect(onboardingStep({ ...base, teen: { ageBracket: "13_15" }, waitingForParent: true })).toBe("done");
  });

  it("doesn't ask 18–19s for a parent", () => {
    expect(onboardingStep({ ...base, teen: { ageBracket: "18_19" } })).toBe("done");
  });
});

describe("under-13 lock", () => {
  const now = Date.UTC(2026, 10, 1, 12);

  it("stays closed for a day on this phone", () => {
    const until = String(closedUntil(now));
    expect(isClosed(until, now)).toBe(true);
    expect(isClosed(until, now + 23 * 3_600_000)).toBe(true);
    expect(isClosed(until, now + 25 * 3_600_000)).toBe(false);
    expect(isClosed(null, now)).toBe(false);
    expect(isClosed("garbage", now)).toBe(false);
  });

  it("offers years for ages 11 to 21", () => {
    const years = birthYearsFor(new Date(now));
    expect(years[0]).toBe(2015);
    expect(years.at(-1)).toBe(2005);
    expect(years).toHaveLength(11);
  });
});

describe("browser sign-in callback", () => {
  it("reads the code", () => {
    expect(parseAuthCallback("quest://auth/callback?code=abc123")).toEqual({ kind: "code", code: "abc123" });
  });

  it("reads an error, preferring the description", () => {
    expect(parseAuthCallback("quest://auth/callback?error=access_denied&error_description=User+cancelled")).toEqual({
      kind: "error",
      message: "User cancelled",
    });
    expect(parseAuthCallback("quest://auth/callback#error=server_error")).toEqual({ kind: "error", message: "server_error" });
  });

  it("returns none for a bare redirect", () => {
    expect(parseAuthCallback("quest://auth/callback")).toEqual({ kind: "none" });
  });
});

describe("asking the store's age range again", () => {
  it("is due every 6 months, only for teens the store placed", () => {
    const checked = "2026-05-01T10:00:00Z";
    expect(recheckDue("store", checked, new Date("2026-10-31T10:00:00Z"), 6)).toBe(false);
    expect(recheckDue("store", checked, new Date("2026-11-01T10:00:00Z"), 6)).toBe(true);
    expect(recheckDue("self_declared", checked, new Date("2030-01-01T00:00:00Z"), 6)).toBe(false);
  });
});

describe("what a re-check reports", () => {
  it("keeps teens in 18–19 after 20, and moves a 16–17 the store now calls 18+ into 18–19", () => {
    expect(recheckBracket({ kind: "verdict", verdict: "adult_unbounded" })).toBe("18_19");
    expect(recheckBracket({ kind: "verdict", verdict: "over_19" })).toBe("18_19");
    expect(recheckBracket({ kind: "verdict", verdict: "16_17" })).toBe("16_17");
    expect(recheckBracket({ kind: "verdict", verdict: "under_13" })).toBeNull();
    expect(recheckBracket({ kind: "unavailable" })).toBeNull();
  });
});
