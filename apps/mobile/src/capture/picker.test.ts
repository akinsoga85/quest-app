import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const launch = vi.fn();
vi.mock("expo-image-picker", () => ({ launchImageLibraryAsync: launch }));

const appJson = JSON.parse(readFileSync(new URL("../../app.json", import.meta.url), "utf8")).expo;
const plugin = (name: string) => {
  const p = (appJson.plugins as (string | [string, Record<string, unknown>])[]).find((x) => (Array.isArray(x) ? x[0] : x) === name);
  return Array.isArray(p) ? p[1] : undefined;
};

describe("A3 done when: the system photo picker on Android", () => {
  beforeEach(() => launch.mockReset());

  it("opens the system picker for one photo, never the legacy file picker", async () => {
    const { pickFromLibrary } = await import("./picker");
    launch.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///picked.jpg", width: 3000, height: 4000 }] });
    expect(await pickFromLibrary()).toBe("file:///picked.jpg");
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ["images"], legacy: false, allowsMultipleSelection: false, exif: false }));
    launch.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickFromLibrary()).toBeNull();
  });

  it("blocks broad photo, file, microphone and location permissions on Android", () => {
    const blocked: string[] = appJson.android.blockedPermissions;
    for (const p of [
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.ACCESS_MEDIA_LOCATION",
      "android.permission.RECORD_AUDIO",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
    ]) {
      expect(blocked).toContain(p);
    }
    expect(blocked).not.toContain("android.permission.CAMERA"); // the in-app camera needs it
    expect(plugin("expo-image-picker")).toMatchObject({ microphonePermission: false });
    expect(plugin("expo-camera")).toMatchObject({ microphonePermission: false, recordAudioAndroid: false, barcodeScannerEnabled: false });
  });

  it("never asks for location on iPhone either", () => {
    const plist = JSON.stringify(appJson.ios.infoPlist ?? {});
    expect(plist).not.toMatch(/NSLocation/);
  });
});
