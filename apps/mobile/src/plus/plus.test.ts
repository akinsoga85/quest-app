import type { PlusStatus } from "@quest/contract";
import { describe, expect, it } from "vitest";
import { manageLine, plusRow, plusView, renewalTerms, storeHasPlus } from "./logic";

const base: PlusStatus = { active: false, included: false, until: null, source: null, canBuyInApp: false, needsParent: false };

describe("Plus in the app", () => {
  it("shows 13–15s it's included, and never offers it for sale", () => {
    const s = { ...base, active: true, included: true };
    expect(plusView(s)).toBe("included");
    expect(plusRow(s)).toEqual({ value: "Included free", opens: true });
  });

  it("sells to 16+, and asks 16–17s to link a parent first", () => {
    expect(plusView({ ...base, canBuyInApp: true })).toBe("buy");
    expect(plusView({ ...base, needsParent: true })).toBe("needs_parent");
    expect(plusRow({ ...base, needsParent: true })?.value).toBe("Get Plus");
    expect(plusRow(base)).toBeNull();
    expect(plusRow(null)).toBeNull();
  });

  it("shows paid Plus and where it's managed, never where to buy", () => {
    const s = { ...base, active: true, until: "2026-12-01T12:00:00Z", source: "app_store" as const };
    expect(plusView(s)).toBe("active");
    expect(plusRow(s)?.value).toMatch(/^On until (Nov 30|Dec 1)$/);
    expect(manageLine(s)).toMatch(/phone's subscriptions/);
    expect(manageLine({ ...s, source: "web" })).toBe("Your parent manages Plus.");
  });

  it("states the renewal terms the stores ask for", () => {
    const t = renewalTerms("$7.99", "ios");
    expect(t).toContain("$7.99 a month");
    expect(t).toMatch(/renews every month until you cancel/);
    expect(t).toMatch(/at least 24 hours before it renews/);
    expect(renewalTerms("7,99 €", "android")).toContain("Google Play account");
  });

  it("reads Plus from the store's entitlements", () => {
    expect(storeHasPlus({ plus: {} })).toBe(true);
    expect(storeHasPlus({ other: {} })).toBe(false);
    expect(storeHasPlus(undefined)).toBe(false);
  });
});
