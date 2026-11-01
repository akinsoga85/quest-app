import { DataExport, DeletionRequest } from "@quest/contract";
import { describe, expect, it } from "vitest";
import { DELETE_FOOTNOTE, clockLabel, deletionLine, exportFileName, photoPaths, providerLabel, withPhotoLinks } from "./logic";

describe("Settings (H20a)", () => {
  it("shows drop times on a 12-hour clock", () => {
    expect(["20:00", "17:30", "00:05", "12:00"].map(clockLabel)).toEqual(["8:00 pm", "5:30 pm", "12:05 am", "12:00 pm"]);
  });

  it("names the sign-in provider", () => {
    expect(providerLabel({ provider: "apple" })).toBe("Apple");
    expect(providerLabel({ providers: ["google"] })).toBe("Google");
    expect(providerLabel(undefined)).toBe("—");
  });

  it("explains a waiting deletion and the promise", () => {
    const req = DeletionRequest.parse({ requestId: "8c6f1f5e-7f1d-4c2a-9a39-1c1b2f0b6a11", deletesAfter: "2026-11-08T15:00:00Z", completesBy: "2026-12-01T15:00:00Z" });
    expect(deletionLine(req)).toMatch(/^Your account will be deleted after Nov \d+\. Changed your mind\?/);
    expect(DELETE_FOOTNOTE).toContain("within 30 days");
  });
});

describe("Download my work", () => {
  const data = DataExport.parse({
    kind: "teen",
    exportedAt: "2026-11-01T10:00:00Z",
    profile: { handle: "BlueFox-482" },
    makes: [
      { id: "a", quest: "Shadow play", storagePath: "t/a.jpg" },
      { id: "b", quest: "Mirror", storagePath: "t/b.jpg" },
    ],
  });

  it("names the file after the handle and the day", () => {
    expect(exportFileName("BlueFox-482", data.exportedAt)).toBe("quest-BlueFox-482-2026-11-01.json");
    expect(exportFileName("../../x", data.exportedAt)).toBe("quest-x-2026-11-01.json");
  });

  it("swaps storage paths for photo links that last a week", () => {
    expect(photoPaths(data)).toEqual(["t/a.jpg", "t/b.jpg"]);
    const out = withPhotoLinks(data, { "t/a.jpg": "https://x/a" });
    expect(out.makes).toEqual([
      { id: "a", quest: "Shadow play", photo: "https://x/a" },
      { id: "b", quest: "Mirror", photo: null },
    ]);
    expect(out.photoLinksExpire).toBe("2026-11-08T10:00:00.000Z");
    expect(JSON.stringify(out)).not.toContain("storagePath");
  });
});
